// Video Streaming Server
//
// Embedded HTTP server that handles video streaming with proper Range request support.
// This is a workaround for Tauri's protocol memory buffering issues with large videos.
//
// Features:
// - Proper HTTP Range request handling for seeking (via tower-http ServeDir)
// - True streaming without buffering entire file in memory
// - Proxies remote video URLs with streaming
// - Access token authentication for security

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::{
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
};
use tower::ServiceExt;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
};

#[derive(Clone)]
pub struct VideoServerState {
    pub access_token: String,
    pub downloads_dir: PathBuf,
}

pub struct VideoServer {
    port: u16,
    access_token: String,
    downloads_dir: PathBuf,
}

impl VideoServer {
    pub fn new(downloads_dir: PathBuf) -> Self {
        // Generate random port between 10000-60000
        let port = 10000 + (rand::random::<u16>() % 50000);
        // Generate random access token
        let access_token: String = (0..32)
            .map(|_| {
                let idx = rand::random::<usize>() % 36;
                if idx < 10 {
                    (b'0' + idx as u8) as char
                } else {
                    (b'a' + (idx - 10) as u8) as char
                }
            })
            .collect();

        Self {
            port,
            access_token,
            downloads_dir,
        }
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn access_token(&self) -> &str {
        &self.access_token
    }

    pub async fn start(self) -> anyhow::Result<()> {
        let state = Arc::new(VideoServerState {
            access_token: self.access_token.clone(),
            downloads_dir: self.downloads_dir.clone(),
        });

        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        // Use tower-http's ServeDir for local files - it handles Range requests automatically
        let serve_dir = ServeDir::new(&self.downloads_dir)
            .precompressed_gzip()
            .precompressed_br();

        let app = Router::new()
            // Local file serving with automatic Range support
            .nest_service("/files", serve_dir)
            // Serve files from absolute paths (for custom download locations)
            .route("/absolute", get(serve_absolute_path))
            // Legacy local endpoint (redirects to /files)
            .route("/local/*path", get(serve_local_redirect))
            // Remote video proxy
            .route("/proxy", get(proxy_video))
            // HLS manifest rewriter (rewrites segment URLs to go through /proxy)
            .route("/hls", get(proxy_hls_manifest))
            // Add token validation middleware
            .layer(middleware::from_fn_with_state(state.clone(), validate_token))
            .layer(cors)
            .with_state(state);

        let addr = SocketAddr::from(([127, 0, 0, 1], self.port));
        log::debug!("Video server starting on port {}", self.port);

        let listener = tokio::net::TcpListener::bind(addr).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }
}

#[derive(serde::Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

// Middleware to validate access token
async fn validate_token(
    State(state): State<Arc<VideoServerState>>,
    Query(query): Query<TokenQuery>,
    request: Request<Body>,
    next: Next,
) -> Response {
    // Allow OPTIONS requests through for CORS preflight
    if request.method() == axum::http::Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range, Content-Type")
            .header(header::ACCESS_CONTROL_MAX_AGE, "86400")
            .body(Body::empty())
            .unwrap();
    }

    // Check token
    if query.token.as_deref() != Some(&state.access_token) {
        return (StatusCode::FORBIDDEN, "Invalid access token").into_response();
    }

    next.run(request).await
}

// Redirect /local/* to /files/* for backwards compatibility
async fn serve_local_redirect(
    State(state): State<Arc<VideoServerState>>,
    axum::extract::Path(path): axum::extract::Path<String>,
    Query(query): Query<TokenQuery>,
    request: Request<Body>,
) -> Response {
    // Decode the path
    let decoded_path = urlencoding::decode(&path).unwrap_or_else(|_| path.clone().into());
    let file_path = state.downloads_dir.join(decoded_path.as_ref());

    log::debug!("Serving local file: {:?}", file_path);

    // Use ServeDir to serve the file with automatic Range support
    let serve_dir = ServeDir::new(&state.downloads_dir);

    // Create a new request for the file path
    let uri = format!("/{}?token={}", decoded_path, query.token.unwrap_or_default());
    let new_request = Request::builder()
        .method(request.method())
        .uri(&uri)
        .body(Body::empty())
        .unwrap();

    // Copy Range header if present
    let mut new_request = new_request;
    if let Some(range) = request.headers().get(header::RANGE) {
        new_request.headers_mut().insert(header::RANGE, range.clone());
    }

    match serve_dir.oneshot(new_request).await {
        Ok(response) => response.into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "File not found").into_response(),
    }
}

#[derive(serde::Deserialize)]
struct AbsolutePathQuery {
    #[allow(dead_code)]
    token: Option<String>,
    path: Option<String>,
}

// Serve a file from an absolute path (for custom download locations)
async fn serve_absolute_path(
    Query(query): Query<AbsolutePathQuery>,
    request: Request<Body>,
) -> Response {
    let file_path = match query.path {
        Some(p) => {
            // URL decode the path
            urlencoding::decode(&p)
                .map(|s| PathBuf::from(s.as_ref()))
                .unwrap_or_else(|_| PathBuf::from(&p))
        }
        None => return (StatusCode::BAD_REQUEST, "Missing path parameter").into_response(),
    };

    log::debug!("Serving absolute file: {:?}", file_path);

    // Check if file exists
    if !file_path.exists() {
        log::error!("File not found: {:?}", file_path);
        return (StatusCode::NOT_FOUND, "File not found").into_response();
    }

    // Get file metadata for content-length
    let metadata = match tokio::fs::metadata(&file_path).await {
        Ok(m) => m,
        Err(e) => {
            log::error!("Failed to get file metadata: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read file").into_response();
        }
    };

    let file_size = metadata.len();

    // Parse Range header
    let range = request.headers().get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| parse_range_header(s, file_size));

    // Open file
    let file = match tokio::fs::File::open(&file_path).await {
        Ok(f) => f,
        Err(e) => {
            log::error!("Failed to open file: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to open file").into_response();
        }
    };

    // Determine content type from extension
    let content_type = file_path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| match ext.to_lowercase().as_str() {
            "mp4" => "video/mp4",
            "mkv" => "video/x-matroska",
            "webm" => "video/webm",
            "avi" => "video/x-msvideo",
            _ => "application/octet-stream",
        })
        .unwrap_or("application/octet-stream");

    if let Some((start, end)) = range {
        // Partial content response
        use tokio::io::{AsyncReadExt, AsyncSeekExt};
        let mut file = file;

        // Seek to start position
        if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
            log::error!("Failed to seek file: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to seek file").into_response();
        }

        let length = end - start + 1;

        // Create a limited reader
        let reader = file.take(length);
        let stream = tokio_util::io::ReaderStream::new(reader);
        let body = Body::from_stream(stream);

        Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_LENGTH, length.to_string())
            .header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, file_size))
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(body)
            .unwrap()
    } else {
        // Full file response
        let stream = tokio_util::io::ReaderStream::new(file);
        let body = Body::from_stream(stream);

        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_LENGTH, file_size.to_string())
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(body)
            .unwrap()
    }
}

// Parse HTTP Range header
fn parse_range_header(range: &str, file_size: u64) -> Option<(u64, u64)> {
    if !range.starts_with("bytes=") {
        return None;
    }

    let range = &range[6..]; // Remove "bytes="
    let parts: Vec<&str> = range.split('-').collect();

    if parts.len() != 2 {
        return None;
    }

    let start: u64 = parts[0].parse().ok()?;
    let end: u64 = if parts[1].is_empty() {
        file_size - 1
    } else {
        parts[1].parse().ok()?
    };

    if start > end || end >= file_size {
        return None;
    }

    Some((start, end))
}

#[derive(serde::Deserialize)]
struct ProxyQuery {
    #[allow(dead_code)]
    token: Option<String>,
    url: Option<String>,
}

// Proxy remote video URLs with streaming and Range support
async fn proxy_video(
    Query(query): Query<ProxyQuery>,
    request: Request<Body>,
) -> Response {
    let url = match query.url {
        Some(u) => u,
        None => return (StatusCode::BAD_REQUEST, "Missing url parameter").into_response(),
    };

    log::debug!("Proxying video");

    // Build request to remote server
    // Follow redirects to get the actual video stream
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // 5 minute timeout for large files
        .redirect(reqwest::redirect::Policy::limited(10)) // Follow up to 10 redirects
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut remote_request = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0")
        .header("Referer", "https://allmanga.to")
        .header("Origin", "https://allmanga.to");

    // Forward Range header if present - this is critical for video seeking
    if let Some(range) = request.headers().get(header::RANGE) {
        if let Ok(range_str) = range.to_str() {
            remote_request = remote_request.header("Range", range_str);
        }
    }

    // Make request
    let response = match remote_request.send().await {
        Ok(r) => r,
        Err(e) => {
            log::error!("Proxy request failed: {}", e);
            return (StatusCode::BAD_GATEWAY, format!("Proxy error: {}", e)).into_response();
        }
    };

    let status = response.status();
    let response_headers = response.headers().clone();

    // Get content info from response headers
    let content_type = response_headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let content_length = response_headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    let content_range = response_headers
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let accept_ranges = response_headers
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Stream the response body directly without buffering
    // This is the key to handling large files
    let stream = response.bytes_stream();
    let body = Body::from_stream(stream);

    // Build response with appropriate headers
    let mut builder = Response::builder()
        .status(status.as_u16())
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Accept-Ranges, Content-Length");

    // Always indicate we support range requests
    if let Some(ranges) = accept_ranges {
        builder = builder.header(header::ACCEPT_RANGES, ranges);
    } else {
        builder = builder.header(header::ACCEPT_RANGES, "bytes");
    }

    if let Some(len) = content_length {
        builder = builder.header(header::CONTENT_LENGTH, len.to_string());
    }

    if let Some(range) = content_range {
        builder = builder.header(header::CONTENT_RANGE, range);
    }

    builder.body(body).unwrap()
}

#[derive(serde::Deserialize)]
struct HlsQuery {
    #[allow(dead_code)]
    token: Option<String>,
    url: Option<String>,
}

// Proxy and rewrite HLS manifest so segment URLs go through our /proxy endpoint.
// This enables Android's native MediaPlayer to play HLS streams that require
// Referer headers — our /proxy endpoint adds the required headers automatically.
async fn proxy_hls_manifest(
    State(_state): State<Arc<VideoServerState>>,
    Query(query): Query<HlsQuery>,
) -> Response {
    let url = match query.url {
        Some(u) => u,
        None => return (StatusCode::BAD_REQUEST, "Missing url parameter").into_response(),
    };

    let token = query.token.unwrap_or_default();

    log::debug!("Proxying HLS manifest");

    // Fetch the original m3u8 manifest
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let response = match client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0")
        .header("Referer", "https://allmanga.to")
        .header("Origin", "https://allmanga.to")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::error!("HLS manifest fetch failed: {}", e);
            return (StatusCode::BAD_GATEWAY, format!("HLS manifest fetch error: {}", e)).into_response();
        }
    };

    let manifest_text = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to read HLS manifest body: {}", e);
            return (StatusCode::BAD_GATEWAY, format!("Failed to read manifest: {}", e)).into_response();
        }
    };

    // Determine the base URL of the manifest for resolving relative URLs
    let base_url = if let Some(last_slash) = url.rfind('/') {
        format!("{}/", &url[..last_slash])
    } else {
        String::new()
    };

    // Rewrite each line: non-comment lines that are URLs get proxied
    let rewritten = manifest_text
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                // Check for URI= attributes in EXT-X-MAP or EXT-X-MEDIA tags
                if trimmed.contains("URI=\"") {
                    rewrite_uri_attribute(trimmed, &base_url, &token)
                } else {
                    line.to_string()
                }
            } else {
                // This is a URL line (segment or sub-playlist)
                let full_url = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                    trimmed.to_string()
                } else {
                    // Relative URL — resolve against manifest base
                    format!("{}{}", base_url, trimmed)
                };

                // Check if this is a sub-playlist (.m3u8) — route through /hls for recursive rewriting
                if full_url.contains(".m3u8") {
                    format!("/hls?token={}&url={}", token, urlencoding::encode(&full_url))
                } else {
                    // Segment file — route through /proxy
                    format!("/proxy?token={}&url={}", token, urlencoding::encode(&full_url))
                }
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from(rewritten))
        .unwrap()
}

/// Rewrite URI="..." attributes inside HLS tags (e.g., EXT-X-MAP, EXT-X-MEDIA)
fn rewrite_uri_attribute(line: &str, base_url: &str, token: &str) -> String {
    // Find URI="..." and rewrite the URL inside
    if let Some(start) = line.find("URI=\"") {
        let uri_start = start + 5; // skip URI="
        if let Some(end) = line[uri_start..].find('"') {
            let original_uri = &line[uri_start..uri_start + end];
            let full_url = if original_uri.starts_with("http://") || original_uri.starts_with("https://") {
                original_uri.to_string()
            } else {
                format!("{}{}", base_url, original_uri)
            };
            let proxied = format!("/proxy?token={}&url={}", token, urlencoding::encode(&full_url));
            return format!("{}URI=\"{}\"{}",
                &line[..start],
                proxied,
                &line[uri_start + end + 1..],
            );
        }
    }
    line.to_string()
}

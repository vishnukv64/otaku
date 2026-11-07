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
use futures_util::StreamExt;
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

use crate::downloads::obfuscation;

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

fn decrypt_obfuscated_chunk(mut chunk: Vec<u8>, offset: &mut u64) -> Vec<u8> {
    obfuscation::xor_transform(&mut chunk, *offset);
    *offset += chunk.len() as u64;
    chunk
}

// Serve a file from an absolute path (for custom download locations)
async fn serve_absolute_path(
    Query(query): Query<AbsolutePathQuery>,
    request: Request<Body>,
) -> Response {
    let token = query.token.clone().unwrap_or_default();
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
    // .otaku files are obfuscated media; old HLS downloads may contain TS bytes.
    let is_obfuscated = file_path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("otaku"))
        .unwrap_or(false);

    let mut content_type = file_path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| match ext.to_lowercase().as_str() {
            "mp4" | "otaku" => "video/mp4",
            "m3u8" => "application/vnd.apple.mpegurl",
            "ts" => "video/mp2t",
            "m4s" => "video/iso.segment",
            "mkv" => "video/x-matroska",
            "webm" => "video/webm",
            "avi" => "video/x-msvideo",
            _ => "application/octet-stream",
        })
        .unwrap_or("application/octet-stream");

    if is_obfuscated {
        content_type = sniff_obfuscated_file_type(&file_path).await;
    }

    if file_path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("m3u8"))
        .unwrap_or(false)
    {
        match tokio::fs::read_to_string(&file_path).await {
            Ok(text) => {
                let body = rewrite_local_hls_playlist(&text, &file_path, &token);
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, content_type)
                    .header(header::CONTENT_LENGTH, body.len().to_string())
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(Body::from(body))
                    .unwrap();
            }
            Err(e) => {
                log::error!("Failed to read HLS playlist: {}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read playlist").into_response();
            }
        }
    }

    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    if is_obfuscated {
        let mut file = file;
        let (start, length, is_range) = if let Some((s, e)) = range {
            (s, e - s + 1, true)
        } else {
            (0, file_size, false)
        };

        if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
            log::error!("Failed to seek file: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to seek file").into_response();
        }

        // Decrypt each streamed chunk at its absolute file offset. This keeps
        // startup memory bounded even when mpegts.js requests the full file.
        let mut decrypt_offset = start;
        let stream = tokio_util::io::ReaderStream::new(file.take(length)).map(move |result| {
            result.map(|chunk| decrypt_obfuscated_chunk(chunk.to_vec(), &mut decrypt_offset))
        });
        let body = Body::from_stream(stream);

        if is_range {
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CONTENT_LENGTH, length.to_string())
                .header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, start + length - 1, file_size))
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(body)
                .unwrap()
        } else {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CONTENT_LENGTH, file_size.to_string())
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(body)
                .unwrap()
        }
    } else if let Some((start, end)) = range {
        // Partial content response (unobfuscated / legacy .mp4)
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
        // Full file response (unobfuscated / legacy .mp4)
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

fn local_absolute_url(path: &std::path::Path, token: &str) -> String {
    format!(
        "/absolute?path={}&token={}",
        urlencoding::encode(&path.to_string_lossy()),
        urlencoding::encode(token)
    )
}

fn rewrite_hls_map_line(line: &str, playlist_dir: &std::path::Path, token: &str) -> String {
    let Some(uri_start) = line.find("URI=\"") else {
        return line.to_string();
    };
    let value_start = uri_start + 5;
    let Some(relative_end) = line[value_start..].find('"') else {
        return line.to_string();
    };
    let value_end = value_start + relative_end;
    let uri = &line[value_start..value_end];
    if uri.starts_with("http://") || uri.starts_with("https://") || uri.starts_with("/absolute?") {
        return line.to_string();
    }
    let rewritten = local_absolute_url(&playlist_dir.join(uri), token);
    format!("{}{}{}", &line[..value_start], rewritten, &line[value_end..])
}

fn rewrite_local_hls_playlist(text: &str, playlist_path: &std::path::Path, token: &str) -> String {
    let playlist_dir = playlist_path.parent().unwrap_or_else(|| std::path::Path::new(""));
    let mut out = String::new();

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.starts_with("#EXT-X-MAP") {
            out.push_str(&rewrite_hls_map_line(line, playlist_dir, token));
        } else if line.is_empty() || line.starts_with('#') || line.starts_with("http://") || line.starts_with("https://") {
            out.push_str(line);
        } else {
            out.push_str(&local_absolute_url(&playlist_dir.join(line), token));
        }
        out.push('\n');
    }

    out
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
    referrer: Option<String>,
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
    let referrer = query.referrer.as_deref().unwrap_or("https://allmanga.to");

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
        .header("Referer", referrer)
        .header("Origin", origin_from_referrer(referrer));

    // Forward Range header if present - this is critical for video seeking
    let mut has_range = false;
    if let Some(range) = request.headers().get(header::RANGE) {
        if let Ok(range_str) = range.to_str() {
            has_range = true;
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

    if !has_range && should_normalize_hls_segment(&url, &content_type) {
        let bytes = match response.bytes().await {
            Ok(b) => normalize_hls_segment(b.to_vec()),
            Err(e) => {
                log::error!("Proxy body read failed: {}", e);
                return (StatusCode::BAD_GATEWAY, format!("Proxy body read error: {}", e)).into_response();
            }
        };

        return Response::builder()
            .status(status.as_u16())
            .header(header::CONTENT_TYPE, "video/mp2t")
            .header(header::CONTENT_LENGTH, bytes.len().to_string())
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Accept-Ranges, Content-Length")
            .header(header::ACCEPT_RANGES, "bytes")
            .body(Body::from(bytes))
            .unwrap();
    }

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
    referrer: Option<String>,
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
    let referrer = query.referrer.as_deref().unwrap_or("https://allmanga.to");

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
        .header("Referer", referrer)
        .header("Origin", origin_from_referrer(referrer))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::error!("HLS manifest fetch failed: {}", e);
            return (StatusCode::BAD_GATEWAY, format!("HLS manifest fetch error: {}", e)).into_response();
        }
    };

    let status = response.status();
    if !status.is_success() {
        log::warn!("HLS manifest fetch returned {}", status);
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| format!("HLS manifest fetch returned {}", status));
        return Response::builder()
            .status(status.as_u16())
            .header(header::CONTENT_TYPE, "text/plain")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Body::from(body))
            .unwrap();
    }

    let manifest_text = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to read HLS manifest body: {}", e);
            return (StatusCode::BAD_GATEWAY, format!("Failed to read manifest: {}", e)).into_response();
        }
    };

    // Rewrite each line: non-comment lines that are URLs get proxied
    let rewritten = manifest_text
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                // Check for URI= attributes in EXT-X-MAP or EXT-X-MEDIA tags
                if trimmed.contains("URI=\"") {
                    rewrite_uri_attribute(trimmed, &url, &token, Some(referrer))
                } else {
                    line.to_string()
                }
            } else {
                // This is a URL line (segment or sub-playlist)
                let full_url = resolve_hls_url(&url, trimmed);

                // Check if this is a sub-playlist (.m3u8) — route through /hls for recursive rewriting
                if full_url.contains(".m3u8") {
                    proxied_path("hls", &token, &full_url, Some(referrer))
                } else {
                    // Segment file — route through /proxy
                    proxied_path("proxy", &token, &full_url, Some(referrer))
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
fn rewrite_uri_attribute(line: &str, manifest_url: &str, token: &str, referrer: Option<&str>) -> String {
    // Find URI="..." and rewrite the URL inside
    if let Some(start) = line.find("URI=\"") {
        let uri_start = start + 5; // skip URI="
        if let Some(end) = line[uri_start..].find('"') {
            let original_uri = &line[uri_start..uri_start + end];
            let full_url = resolve_hls_url(manifest_url, original_uri);
            let proxied = proxied_path("proxy", token, &full_url, referrer);
            return format!("{}URI=\"{}\"{}",
                &line[..start],
                proxied,
                &line[uri_start + end + 1..],
            );
        }
    }
    line.to_string()
}

/// Resolve a playlist entry against its manifest per RFC 3986, so absolute,
/// root-relative ("/seg.ts") and scheme-relative ("//cdn/seg.ts") entries
/// all land on the right host.
fn resolve_hls_url(manifest_url: &str, entry: &str) -> String {
    reqwest::Url::parse(manifest_url)
        .and_then(|base| base.join(entry))
        .map(String::from)
        .unwrap_or_else(|_| entry.to_string())
}

pub(crate) fn origin_from_referrer(referrer: &str) -> String {
    reqwest::Url::parse(referrer)
        .map(|url| url.origin().ascii_serialization())
        .unwrap_or_else(|_| "https://allmanga.to".to_string())
}

fn proxied_path(route: &str, token: &str, url: &str, referrer: Option<&str>) -> String {
    let referrer_param = referrer
        .map(|value| format!("&referrer={}", urlencoding::encode(value)))
        .unwrap_or_default();
    format!(
        "/{}?token={}&url={}{}",
        route,
        token,
        urlencoding::encode(url),
        referrer_param
    )
}

fn should_normalize_hls_segment(url: &str, content_type: &str) -> bool {
    let lower_url = url.to_ascii_lowercase();
    let lower_content_type = content_type.to_ascii_lowercase();
    lower_url.contains(".ts")
        || lower_url.contains("/seg-")
        || lower_content_type.starts_with("image/png")
}

fn normalize_hls_segment(bytes: Vec<u8>) -> Vec<u8> {
    if bytes.first() == Some(&0x47) {
        return bytes;
    }

    const PNG_SIGNATURE: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if !bytes.starts_with(PNG_SIGNATURE) {
        return bytes;
    }

    match bytes[PNG_SIGNATURE.len()..].iter().position(|byte| *byte == 0x47) {
        Some(relative_offset) => {
            let offset = PNG_SIGNATURE.len() + relative_offset;
            bytes[offset..].to_vec()
        }
        None => bytes,
    }
}

fn sniff_decrypted_video_type(header: &[u8]) -> &'static str {
    if header.first() == Some(&0x47) {
        return "video/mp2t";
    }
    if header.len() >= 8 && &header[4..8] == b"ftyp" {
        return "video/mp4";
    }
    "video/mp4"
}

pub(crate) async fn is_obfuscated_mpeg_ts_file(file_path: &std::path::Path) -> bool {
    file_path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("otaku"))
        .unwrap_or(false)
        && sniff_obfuscated_file_type(file_path).await == "video/mp2t"
}

async fn sniff_obfuscated_file_type(file_path: &std::path::Path) -> &'static str {
    use tokio::io::AsyncReadExt;

    let mut file = match tokio::fs::File::open(file_path).await {
        Ok(file) => file,
        Err(_) => return "video/mp4",
    };
    let mut header = [0u8; 16];
    let read = match file.read(&mut header).await {
        Ok(read) => read,
        Err(_) => return "video/mp4",
    };
    obfuscation::xor_transform(&mut header[..read], 0);
    sniff_decrypted_video_type(&header[..read])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_hls_segment_keeps_mpeg_ts_sync_byte_at_start() {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2];
        bytes.extend_from_slice(&[0x47, 0x40, 0x11, 0x10, 0x00]);

        let stripped = normalize_hls_segment(bytes);

        assert_eq!(stripped, vec![0x47, 0x40, 0x11, 0x10, 0x00]);
    }

    #[test]
    fn normalize_hls_segment_leaves_normal_ts_unchanged() {
        let bytes = vec![0x47, 0x40, 0x11, 0x10, 0x00];

        let stripped = normalize_hls_segment(bytes.clone());

        assert_eq!(stripped, bytes);
    }

    #[test]
    fn resolves_hls_entries_like_a_browser() {
        let m = "https://hls.test/manifest/abc/master.m3u8";
        assert_eq!(resolve_hls_url(m, "v1/playlist.m3u8"), "https://hls.test/manifest/abc/v1/playlist.m3u8");
        assert_eq!(resolve_hls_url(m, "//st1.cdn.test/a/000.jpg"), "https://st1.cdn.test/a/000.jpg");
        assert_eq!(resolve_hls_url(m, "/root/seg.ts"), "https://hls.test/root/seg.ts");
        assert_eq!(resolve_hls_url(m, "https://other.test/x.ts"), "https://other.test/x.ts");
    }

    #[test]
    fn should_normalize_anikoto_fake_segment_extensions() {
        assert!(should_normalize_hls_segment(
            "https://cdn.test/anime/id/hash/seg-1-f2-v1-a1.jpg",
            "image/jpeg"
        ));
        assert!(should_normalize_hls_segment(
            "https://cdn.test/anime/id/hash/seg-2-f2-v1-a1.html",
            "text/html"
        ));
    }

    #[test]
    fn sniff_obfuscated_video_type_detects_legacy_ts_downloads() {
        assert_eq!(sniff_decrypted_video_type(&[0x47, 0x40, 0x00, 0x10]), "video/mp2t");
        assert_eq!(sniff_decrypted_video_type(&[0, 0, 0, 32, b'f', b't', b'y', b'p']), "video/mp4");
    }

    #[test]
    fn decrypts_obfuscated_stream_chunks_with_continuous_key_offsets() {
        let original = b"a transport stream split across arbitrary response chunks";
        let mut encrypted = original.to_vec();
        obfuscation::xor_transform(&mut encrypted, 0);

        let mut offset = 0;
        let mut decrypted = decrypt_obfuscated_chunk(encrypted[..13].to_vec(), &mut offset);
        decrypted.extend(decrypt_obfuscated_chunk(encrypted[13..].to_vec(), &mut offset));

        assert_eq!(decrypted, original);
        assert_eq!(offset, original.len() as u64);
    }

    #[tokio::test]
    async fn streams_decrypted_obfuscated_files_for_full_and_range_requests() {
        let mut original = vec![0u8; 32 * 1024];
        for (index, byte) in original.iter_mut().enumerate() {
            *byte = (index % 251) as u8;
        }
        original[0] = 0x47;
        let mut encrypted = original.clone();
        obfuscation::xor_transform(&mut encrypted, 0);

        let path = std::env::temp_dir().join(format!(
            "otaku-obfuscated-stream-{}.otaku",
            std::process::id()
        ));
        tokio::fs::write(&path, encrypted).await.unwrap();
        let path_string = path.to_string_lossy().to_string();

        let response = serve_absolute_path(
            Query(AbsolutePathQuery {
                token: None,
                path: Some(path_string.clone()),
            }),
            Request::builder().body(Body::empty()).unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "video/mp2t");
        let full_body = axum::body::to_bytes(response.into_body(), original.len())
            .await
            .unwrap();
        assert_eq!(full_body.as_ref(), original.as_slice());

        let response = serve_absolute_path(
            Query(AbsolutePathQuery {
                token: None,
                path: Some(path_string),
            }),
            Request::builder()
                .header(header::RANGE, "bytes=123-9000")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        let range_body = axum::body::to_bytes(response.into_body(), 9000 - 123 + 1)
            .await
            .unwrap();
        assert_eq!(range_body.as_ref(), &original[123..=9000]);

        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn detects_obfuscated_mpeg_ts_files() {
        let mut bytes = vec![0x47, 0x40, 0x00, 0x10, 0x00, 0x00];
        obfuscation::xor_transform(&mut bytes, 0);

        let path = std::env::temp_dir().join(format!(
            "otaku-legacy-ts-{}.otaku",
            std::process::id()
        ));
        tokio::fs::write(&path, bytes).await.unwrap();

        assert!(is_obfuscated_mpeg_ts_file(&path).await);

        let _ = tokio::fs::remove_file(path).await;
    }
}

#[cfg(test)]
mod live_kaa_playback {
    use super::*;

    /// Walks a KAA stream through the real proxy the player uses:
    /// master -> variant -> first segment, each fetched from /hls or /proxy.
    #[tokio::test]
    #[ignore = "hits hls.krussdomi.com and its segment CDN"]
    async fn kaa_stream_plays_through_proxy() {
        let server = VideoServer::new(std::env::temp_dir());
        let (port, token) = (server.port(), server.access_token().to_string());
        tokio::spawn(server.start());
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let base = format!("http://127.0.0.1:{}", port);
        let master = "https://hls.krussdomi.com/manifest/67d0c07a169c31976b8d79b8/master.m3u8";
        let first = proxied_path("hls", &token, master, Some("https://krussdomi.com/"));

        let get = |path: String| {
            let url = format!("{}{}", base, path);
            async move {
                let r = reqwest::get(&url).await.unwrap();
                let status = r.status();
                (status, r.bytes().await.unwrap())
            }
        };
        let next = |body: &[u8]| {
            String::from_utf8_lossy(body).lines().find(|l| l.starts_with('/')).unwrap().to_string()
        };

        let (s, master_body) = get(first).await;
        assert!(s.is_success(), "master {}", s);
        let (s, variant_body) = get(next(&master_body)).await;
        assert!(s.is_success(), "variant {}", s);
        let (s, segment) = get(next(&variant_body)).await;
        println!("segment {} {} bytes, first byte {:#x}", s, segment.len(), segment[0]);
        assert!(s.is_success());
        assert_eq!(segment[0], 0x47, "expected MPEG-TS sync byte");
    }
}

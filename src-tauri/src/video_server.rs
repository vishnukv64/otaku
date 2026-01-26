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
            // Legacy local endpoint (redirects to /files)
            .route("/local/*path", get(serve_local_redirect))
            // Remote video proxy
            .route("/proxy", get(proxy_video))
            // Add token validation middleware
            .layer(middleware::from_fn_with_state(state.clone(), validate_token))
            .layer(cors)
            .with_state(state);

        let addr = SocketAddr::from(([127, 0, 0, 1], self.port));
        log::info!("Video server starting on http://127.0.0.1:{}", self.port);
        log::info!("Downloads directory: {:?}", self.downloads_dir);

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
        log::warn!("Invalid access token in request");
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

    log::info!("Serving local file: {:?}", file_path);

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
struct ProxyQuery {
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

    log::info!("Proxying video: {}", &url[..url.len().min(100)]);

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
            log::info!("Forwarding Range header: {}", range_str);
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

    log::info!("Remote response status: {}", status);

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

    if let Some(ref range) = content_range {
        log::info!("Content-Range: {}", range);
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

// Module declarations
mod cache;
mod commands;
mod database;
mod downloads;
mod extensions;
mod media;
mod trackers;
mod video_server;

use commands::AppState;
use database::Database;
use downloads::DownloadManager;
use video_server::VideoServer;
use tauri::Manager;
use std::sync::Arc;

/// Holds video server connection info
pub struct VideoServerInfo {
    pub port: u16,
    pub access_token: String,
}

impl VideoServerInfo {
    /// Get the base URL for local file streaming
    /// Uses tower-http ServeDir which handles Range requests automatically
    pub fn local_url(&self, filename: &str) -> String {
        format!(
            "http://127.0.0.1:{}/files/{}?token={}",
            self.port,
            urlencoding::encode(filename),
            self.access_token
        )
    }

    /// Get the proxy URL for remote video streaming
    /// Streams without buffering and forwards Range headers for seeking
    pub fn proxy_url(&self, remote_url: &str) -> String {
        format!(
            "http://127.0.0.1:{}/proxy?token={}&url={}",
            self.port,
            self.access_token,
            urlencoding::encode(remote_url)
        )
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Database and DownloadManager will be initialized in setup
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .register_asynchronous_uri_scheme_protocol("stream", |_app, request, responder| {
      // Custom protocol to stream videos through Rust backend with Range support
      use std::io::Read;

      let url_str = request.uri().to_string();
      let url = url_str.replace("stream://", "https://");

      // Get Range header if present (for seeking) - pass through as-is
      // The browser/HLS.js handles chunking appropriately
      let range_header = request.headers().get("range")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

      log::debug!("Stream: {} (Range: {:?})", &url[..url.len().min(50)], range_header);

      tauri::async_runtime::spawn(async move {
        // Build request with headers
        let mut req = ureq::get(&url)
          .set("Referer", "https://allmanga.to")
          .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0")
          .set("Origin", "https://allmanga.to");

        // Add Range header if present (don't limit the range - let the server handle it)
        if let Some(ref range) = range_header {
          req = req.set("Range", range);
        }

        match req.call() {
          Ok(response) => {
            let status = response.status();
            let content_type = response.header("Content-Type")
              .unwrap_or("application/octet-stream")
              .to_string();
            let content_length = response.header("Content-Length")
              .and_then(|v| v.parse::<u64>().ok());
            let content_range = response.header("Content-Range")
              .map(|v| v.to_string());

            log::debug!("Response: status={}, len={:?}", status, content_length);

            // Stream data in chunks - NO SIZE LIMIT for video playback
            // HLS.js handles chunked requests via Range headers, so each request
            // is typically a segment (a few MB) rather than the entire video
            const CHUNK_SIZE: usize = 256 * 1024; // 256KB read chunks for smooth streaming

            // Pre-allocate based on content length if known, otherwise start small
            let initial_capacity = content_length
              .map(|l| (l as usize).min(50 * 1024 * 1024)) // Cap initial allocation at 50MB
              .unwrap_or(CHUNK_SIZE);

            let mut bytes = Vec::with_capacity(initial_capacity);
            let mut reader = response.into_reader();
            let mut buffer = vec![0u8; CHUNK_SIZE];

            // Read the entire response - Range requests are already limited by the client
            loop {
              match reader.read(&mut buffer) {
                Ok(0) => break, // EOF
                Ok(n) => {
                  bytes.extend_from_slice(&buffer[..n]);

                  // Yield to prevent blocking every 1MB
                  if bytes.len() % (CHUNK_SIZE * 4) == 0 {
                    tokio::task::yield_now().await;
                  }
                }
                Err(e) => {
                  log::error!("Stream read error: {:?}", e);
                  break;
                }
              }
            }

            log::debug!("Streamed {} bytes", bytes.len());

            let mut response_builder = tauri::http::Response::builder()
              .status(if status == 206 { 206 } else { 200 })
              .header("Content-Type", content_type)
              .header("Access-Control-Allow-Origin", "*")
              .header("Accept-Ranges", "bytes")
              .header("Cache-Control", "public, max-age=3600");

            if let Some(len) = content_length {
              response_builder = response_builder.header("Content-Length", len.to_string());
            }

            if let Some(range) = content_range {
              response_builder = response_builder.header("Content-Range", range);
            }

            responder.respond(response_builder.body(bytes).unwrap());
          }
          Err(e) => {
            log::error!("Stream error: {:?}", e);
            responder.respond(
              tauri::http::Response::builder()
                .status(500)
                .body(format!("Error: {}", e).into_bytes())
                .unwrap()
            );
          }
        }
      });
    })
    .setup(|app| {
      // Always initialize logging (not just in debug mode)
      let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
      } else {
        log::LevelFilter::Info
      };

      let _ = app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log_level)
          .build(),
      );

      // Initialize database and download manager
      let app_handle = app.handle();

      // Get app data directory - use match instead of expect
      let app_dir = match app_handle.path().app_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
          log::error!("Failed to get app data directory: {}", e);
          // Fallback to home directory
          dirs::home_dir()
            .map(|h| h.join(".otaku"))
            .unwrap_or_else(|| std::path::PathBuf::from(".otaku"))
        }
      };

      // Create app directory if it doesn't exist
      if let Err(e) = std::fs::create_dir_all(&app_dir) {
        log::error!("Failed to create app directory: {}", e);
      }

      tauri::async_runtime::block_on(async move {
        // Create database path
        let db_path = app_dir.join("otaku.db");

        log::info!("Initializing database at {:?}", db_path);

        // Initialize database with proper error handling
        let database = match Database::new(db_path).await {
          Ok(db) => db,
          Err(e) => {
            log::error!("Failed to initialize database: {}", e);
            panic!("Database initialization failed: {}", e);
          }
        };

        let db_pool = Arc::new(database.pool().clone());

        // Add database to app state
        app_handle.manage(AppState::new(database));

        // Initialize download manager with database
        let downloads_dir = app_dir.join("downloads");
        if let Err(e) = std::fs::create_dir_all(&downloads_dir) {
          log::error!("Failed to create downloads directory: {}", e);
        }

        let download_manager = DownloadManager::new(downloads_dir.clone())
          .with_database(db_pool);

        // Load downloads from database (non-fatal if fails)
        if let Err(e) = download_manager.load_from_database().await {
          log::error!("Failed to load downloads from database: {}", e);
        }

        app_handle.manage(download_manager);

        // Start video streaming server (workaround for Tauri protocol memory issues)
        let video_server = VideoServer::new(downloads_dir);
        let video_server_info = VideoServerInfo {
            port: video_server.port(),
            access_token: video_server.access_token().to_string(),
        };

        app_handle.manage(video_server_info);

        // Spawn video server in background
        tokio::spawn(async move {
            if let Err(e) = video_server.start().await {
                log::error!("Video server error: {}", e);
            }
        });

        log::info!("Backend initialized successfully");
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::load_extension,
      commands::search_anime,
      commands::discover_anime,
      commands::get_recommendations,
      commands::get_tags,
      commands::get_anime_details,
      commands::get_video_sources,
      commands::list_extensions,
      commands::proxy_video_request,
      commands::proxy_hls_playlist,
      commands::start_download,
      commands::get_download_progress,
      commands::list_downloads,
      commands::cancel_download,
      commands::is_episode_downloaded,
      commands::get_episode_file_path,
      commands::get_total_storage_used,
      commands::get_downloads_directory,
      commands::open_downloads_folder,
      commands::remove_download,
      commands::delete_download,
      commands::delete_episode_download,
      commands::clear_completed_downloads,
      commands::clear_failed_downloads,
      // Watch History
      commands::save_watch_progress,
      commands::get_watch_progress,
      commands::get_latest_watch_progress_for_media,
      commands::get_continue_watching,
      // Library
      commands::add_to_library,
      commands::remove_from_library,
      commands::get_library_entry,
      commands::get_library_by_status,
      commands::get_library_with_media,
      commands::toggle_favorite,
      commands::is_in_library,
      // Media
      commands::save_media_details,
      commands::get_continue_watching_with_details,
      commands::get_downloads_with_media,
      // Data Management
      commands::clear_all_watch_history,
      commands::clear_library,
      commands::clear_all_data,
      commands::get_storage_usage,
      // Video Server
      commands::get_video_server_info,
      commands::get_local_video_url,
      commands::get_proxy_video_url,
      // System Stats
      commands::get_system_stats,
      // Logs
      commands::get_app_logs,
      commands::clear_app_logs,
      commands::get_log_file_path,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// Module declarations
mod cache;
mod commands;
mod database;
mod downloads;
mod extensions;
mod media;
mod trackers;

use commands::AppState;
use database::Database;
use downloads::DownloadManager;
use tauri::Manager;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Database and DownloadManager will be initialized in setup
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .register_asynchronous_uri_scheme_protocol("stream", |_app, request, responder| {
      // Custom protocol to stream videos through Rust backend with Range support
      use std::io::Read;

      let url_str = request.uri().to_string();
      let url = url_str.replace("stream://", "https://");

      // Get Range header if present (for seeking)
      let range_header = request.headers().get("range")
        .and_then(|v| v.to_str().ok())
        .map(|s| {
          // Limit chunk size to 5MB to prevent memory issues and improve responsiveness
          let original = s.to_string();
          if let Some(range_str) = original.strip_prefix("bytes=") {
            if let Some((start, end)) = range_str.split_once('-') {
              if let (Ok(start_byte), Ok(end_byte)) = (start.parse::<u64>(), end.parse::<u64>()) {
                let requested_size = end_byte - start_byte + 1;
                const MAX_CHUNK: u64 = 5 * 1024 * 1024; // 5MB chunks
                if requested_size > MAX_CHUNK {
                  let new_end = start_byte + MAX_CHUNK - 1;
                  log::debug!("Limiting chunk: {} -> {}", requested_size, MAX_CHUNK);
                  return format!("bytes={}-{}", start_byte, new_end);
                }
              }
            }
          }
          original
        });

      log::debug!("Stream: {} (Range: {:?})", &url[..url.len().min(50)], range_header);

      tauri::async_runtime::spawn(async move {
        // Build request with headers
        let mut req = ureq::get(&url)
          .set("Referer", "https://allmanga.to")
          .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0")
          .set("Origin", "https://allmanga.to");

        // Add Range header if present
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

            // Stream data in smaller chunks to avoid blocking and memory pressure
            const CHUNK_SIZE: usize = 256 * 1024; // 256KB chunks for smooth streaming
            const MAX_BUFFER: usize = 10 * 1024 * 1024; // 10MB absolute max

            let initial_capacity = content_length
              .map(|l| (l as usize).min(MAX_BUFFER))
              .unwrap_or(CHUNK_SIZE);

            let mut bytes = Vec::with_capacity(initial_capacity);
            let mut reader = response.into_reader();
            let mut buffer = vec![0u8; CHUNK_SIZE];

            // Read in chunks instead of all at once
            loop {
              // Safety check - prevent runaway memory usage
              if bytes.len() >= MAX_BUFFER {
                log::warn!("Reached max buffer size, truncating response");
                break;
              }

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
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Initialize database and download manager
      let app_handle = app.handle();
      tauri::async_runtime::block_on(async move {
        // Get app data directory
        let app_dir = app_handle
          .path()
          .app_data_dir()
          .expect("Failed to get app data directory");

        // Create database path
        let db_path = app_dir.join("otaku.db");

        log::info!("Initializing database at: {:?}", db_path);

        // Initialize database
        let database = Database::new(db_path)
          .await
          .expect("Failed to initialize database");

        let db_pool = Arc::new(database.pool().clone());

        // Add database to app state
        app_handle.manage(AppState::new(database));

        // Initialize download manager with database
        let downloads_dir = app_dir.join("downloads");
        std::fs::create_dir_all(&downloads_dir)
          .expect("Failed to create downloads directory");

        let download_manager = DownloadManager::new(downloads_dir)
          .with_database(db_pool);

        // Load downloads from database
        download_manager
          .load_from_database()
          .await
          .expect("Failed to load downloads from database");

        app_handle.manage(download_manager);

        log::info!("Database and download manager initialized");
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::load_extension,
      commands::search_anime,
      commands::discover_anime,
      commands::get_recommendations,
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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

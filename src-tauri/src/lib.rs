// Module declarations
mod cache;
mod commands;
mod database;
mod downloads;
mod extensions;
mod media;
mod trackers;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AppState::new())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::load_extension,
      commands::search_anime,
      commands::discover_anime,
      commands::get_anime_details,
      commands::get_video_sources,
      commands::list_extensions,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

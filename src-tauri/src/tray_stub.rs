// Mobile-target stub for the desktop-only tray/menu module.
//
// Tauri 2.x gates `tauri::menu`, `tauri::tray`, and `WebviewWindow::unminimize`
// behind `#[cfg(desktop)]`, so the real tray implementation in `tray.rs` can't
// compile for Android or iOS. lib.rs uses `cfg_attr(..., path = ...)` to swap
// this stub in on mobile.
//
// Only `update_downloads_count` is reachable from non-cfg-gated callers
// (the download manager calls it on every tick). Every other tray API
// (`build_tray`, `install_app_menu`, `restore_and_navigate`,
// `TrayLifecycleState`) is gated to desktop at the call site, so it doesn't
// need a stub here.

use tauri::AppHandle;

pub fn update_downloads_count(_app: &AppHandle, _active: usize) {}

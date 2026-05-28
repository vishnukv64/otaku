// Tray lifecycle module.
//
// Owns the menu-bar icon, its menu, the app-managed lifecycle state, and the
// `restore_and_navigate` helper that any surface (banner click, dock click,
// tray click, Reopen) calls to bring the app forward.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager};

/// Process-wide state that the tray, window-close handler, and notification
/// escalation all read or write.
#[derive(Default)]
pub struct TrayLifecycleState {
    /// True iff a real "quit" path (tray Quit item, Cmd+Q) is in flight.
    /// `on_window_event` checks this — if false, CloseRequested becomes a hide.
    pub quit_requested: AtomicBool,

    /// Route of the most-recent actionable native banner. Flushed by
    /// `restore_and_navigate` on next app activation.
    pub pending_deeplink: Mutex<Option<String>>,
}

/// Show + focus the main window and flush any pending deep-link.
///
/// Called from:
///   - tray icon left-click
///   - tray "Show / Hide" menu item
///   - `RunEvent::Reopen` (macOS dock-click)
///   - any future single-instance focus path
pub fn restore_and_navigate(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    let route_opt = app
        .try_state::<TrayLifecycleState>()
        .and_then(|s| s.pending_deeplink.lock().ok().and_then(|mut g| g.take()));

    if let Some(route) = route_opt {
        if let Err(e) = app.emit("deeplink", &route) {
            log::error!("Failed to emit deeplink event: {}", e);
        }
    }
}

/// Convenience used by command handlers / future code that wants to set the
/// quit flag and exit in one place.
#[allow(dead_code)]
pub fn request_quit(app: &AppHandle) {
    if let Some(state) = app.try_state::<TrayLifecycleState>() {
        state.quit_requested.store(true, Ordering::SeqCst);
    }
    app.exit(0);
}

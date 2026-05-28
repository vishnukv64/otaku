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
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

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
pub fn request_quit(app: &AppHandle) {
    if let Some(state) = app.try_state::<TrayLifecycleState>() {
        state.quit_requested.store(true, Ordering::SeqCst);
    }
    app.exit(0);
}

/// Build the tray icon, attach its menu, and install click handlers.
/// Idempotent: safe to call once during setup.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "Show Otaku", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Otaku", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_hide,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default_window_icon".into()))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_hide" => toggle_main_window(app),
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore_and_navigate(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Show the window if hidden, hide it if visible. Used by the tray menu item.
fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => restore_and_navigate(app),
    }
}

#[cfg(target_os = "macos")]
pub fn install_app_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, Submenu};

    // Custom Quit item — owned by us, routes through request_quit so the
    // CloseRequested path doesn't intercept it.
    let quit_item = MenuItem::with_id(
        app,
        "app_quit",
        "Quit Otaku",
        true,
        Some("CmdOrCtrl+Q"),
    )?;

    let app_submenu = Submenu::with_items(
        app,
        "Otaku",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Otaku"), Some(AboutMetadata::default()))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    let menu = Menu::with_items(app, &[&app_submenu])?;
    app.set_menu(menu)?;

    app.on_menu_event(move |app, event| {
        if event.id().as_ref() == "app_quit" {
            request_quit(app);
        }
    });

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install_app_menu(_app: &AppHandle) -> tauri::Result<()> {
    // Non-macOS desktop has no first-class app menu; Cmd+Q is N/A there.
    Ok(())
}

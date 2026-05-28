# Background Mode, Tray & Native Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Otaku survive window close behind a system-tray icon, route the existing notification pipeline to OS-native banners (with focus-aware suppression and a deep-link), and add a "launch at login" toggle.

**Architecture:** Backend-weighted. A new `tray.rs` owns the tray icon, its menu, app-managed lifecycle state (quit flag, pending deep-link, menu handles), and a `restore_and_navigate` helper. `notifications.rs` un-gates its OS-native path to desktop and adds a pure `should_escalate_native` decision function plus an `escalate_to_native` opt-out flag — every event that already traverses `emit_notification` inherits native banners automatically. `lib.rs` installs `on_window_event` (close → hide unless quit was requested) and switches to the `.build()?.run(callback)` form to handle `RunEvent::Reopen`. `release_checker.rs` is rerouted through `emit_notification` and gains a `force` flag for the tray "Check now" item. Autostart uses `tauri-plugin-autostart` with a `--hidden` boot arg. Frontend gets a thin `deeplink` event listener and two Settings toggles.

**Tech Stack:** Tauri v2.9.5 (Rust), `tauri-plugin-notification` v2 (already a dep), `tauri-plugin-autostart` v2 (new), React + TanStack Router + Vite + Vitest on the frontend, sqlx + SQLite + tokio on the backend.

**Reference spec:** `docs/superpowers/specs/2026-05-28-background-mode-tray-notifications-design.md`

**Conventions reminder (from repo CLAUDE.md / past project updates):**
- Frontend tests live alongside source as `*.test.ts(x)` (Vitest).
- Rust unit tests inline as `#[cfg(test)] mod tests { ... }`, run with `cd src-tauri && cargo test`.
- Pre-existing eslint warnings: 11 (do not add new ones).
- The main window's default label is `"main"` (no explicit label in `tauri.conf.json`).

---

## Task 1: Add Cargo features and the autostart plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Edit the `tauri` feature list**

In `src-tauri/Cargo.toml`, change:

```toml
tauri = { version = "2.9.5", features = ["protocol-asset"] }
```

to:

```toml
tauri = { version = "2.9.5", features = ["protocol-asset", "tray-icon"] }
```

- [ ] **Step 2: Add the autostart plugin**

In the same `[dependencies]` section, just after `tauri-plugin-notification = "2"`, add:

```toml
tauri-plugin-autostart = "2"
```

- [ ] **Step 3: Verify it builds**

Run: `cd src-tauri && cargo build`
Expected: build succeeds (a fresh `tauri-plugin-autostart` crate compiles).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(tauri): enable tray-icon feature and add autostart plugin"
```

---

## Task 2: Create `tray.rs` with the lifecycle state struct (no tray yet)

**Files:**
- Create: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod tray;` and register state)

- [ ] **Step 1: Write `tray.rs` with just the state**

Create `src-tauri/src/tray.rs` with this exact content:

```rust
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
```

- [ ] **Step 2: Wire `tray.rs` into `lib.rs`**

In `src-tauri/src/lib.rs`, find the `mod` block at the top (lines 2-14) and add `mod tray;` so the list reads (preserving alphabetical-ish order):

```rust
mod auto_backup;
mod commands;
mod database;
mod downloads;
mod extensions;
mod jikan;
mod media;
mod notifications;
mod request_headers;
mod release_checker;
mod status_normalizer;
mod trackers;
mod tray;
mod video_server;
```

- [ ] **Step 3: Register `TrayLifecycleState` in `setup`**

In `src-tauri/src/lib.rs`, inside `.setup(|app| { ... })` — directly after `let app_handle = app.handle();` (around the current line 197) — add:

```rust
      // Tray + window-close + deeplink lifecycle state.
      app_handle.manage(tray::TrayLifecycleState::default());
```

- [ ] **Step 4: Verify it builds**

Run: `cd src-tauri && cargo build`
Expected: build succeeds; the new `tray::TrayLifecycleState` is reachable from anywhere via `app.state::<tray::TrayLifecycleState>()` or `try_state`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/tray.rs src-tauri/src/lib.rs
git commit -m "feat(tray): add TrayLifecycleState and restore_and_navigate scaffold"
```

---

## Task 3: TDD the `should_escalate_native` decision function

**Files:**
- Modify: `src-tauri/src/notifications.rs`

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/notifications.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::should_escalate_native;

    #[test]
    fn focused_and_visible_window_suppresses_native() {
        assert!(!should_escalate_native(true, true, true, true));
    }

    #[test]
    fn hidden_window_escalates() {
        assert!(should_escalate_native(false, false, true, true));
    }

    #[test]
    fn visible_but_unfocused_escalates() {
        // Background-but-on-screen counts as background — the user is in
        // another app, the in-app toast is not the surface they're looking at.
        assert!(should_escalate_native(false, true, true, true));
    }

    #[test]
    fn focused_but_hidden_escalates() {
        // Defensive: shouldn't happen in practice but the gate should not
        // misfire if one of the two queries races.
        assert!(should_escalate_native(true, false, true, true));
    }

    #[test]
    fn desktop_notifications_disabled_suppresses() {
        assert!(!should_escalate_native(false, false, false, true));
    }

    #[test]
    fn escalate_flag_false_suppresses() {
        assert!(!should_escalate_native(false, false, true, false));
    }
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-tauri && cargo test --lib should_escalate_native`
Expected: FAIL with `cannot find function 'should_escalate_native' in this scope`.

- [ ] **Step 3: Implement the function**

In `src-tauri/src/notifications.rs`, just above the `// ==================== Helper Functions for Common Notifications ====================` divider (currently around line 313), add:

```rust
/// Should `emit_notification` escalate this payload to a native OS banner?
///
/// Suppresses when the main window is genuinely in front of the user (focused
/// AND visible) — that case is already covered by the in-app toast.
pub(crate) fn should_escalate_native(
    window_focused: bool,
    window_visible: bool,
    desktop_notifs_enabled: bool,
    escalate_flag: bool,
) -> bool {
    let foreground = window_focused && window_visible;
    desktop_notifs_enabled && escalate_flag && !foreground
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd src-tauri && cargo test --lib should_escalate_native`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/notifications.rs
git commit -m "feat(notifications): add should_escalate_native decision function with tests"
```

---

## Task 4: Add the `escalate_to_native` opt-out field on `NotificationPayload`

**Files:**
- Modify: `src-tauri/src/notifications.rs`

- [ ] **Step 1: Add a serde default helper**

Near the top of `src-tauri/src/notifications.rs` (just below the `use` block), add:

```rust
fn default_true() -> bool { true }
```

- [ ] **Step 2: Add the field to `NotificationPayload`**

Change the `NotificationPayload` struct (currently at lines 46-59) to include the new field. Insert the field just before `timestamp`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPayload {
    pub id: String,
    #[serde(rename = "type")]
    pub notification_type: NotificationType,
    pub title: String,
    pub message: String,
    pub source: Option<String>,
    pub action: Option<NotificationAction>,
    pub metadata: Option<serde_json::Value>,
    pub read: bool,
    pub dismissed: bool,
    pub timestamp: i64,
    /// Should this notification escalate to a native OS banner when the window
    /// is hidden? Defaults true. Set false via `with_native(false)` for purely
    /// in-app notifications (e.g. "removed from library"). Not persisted to DB.
    #[serde(default = "default_true")]
    pub escalate_to_native: bool,
}
```

- [ ] **Step 3: Initialise the field in `NotificationPayload::new`**

In `impl NotificationPayload { pub fn new(...) -> Self { Self { ... } } }` (lines 63-80), add `escalate_to_native: true,` to the struct literal so it reads:

```rust
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            notification_type,
            title: title.into(),
            message: message.into(),
            source: None,
            action: None,
            metadata: None,
            read: false,
            dismissed: false,
            timestamp: chrono::Utc::now().timestamp_millis(),
            escalate_to_native: true,
        }
```

- [ ] **Step 4: Add a `with_native` builder method**

After `with_metadata` (currently lines 99-102), add:

```rust
    /// Opt this notification out of native OS escalation.
    #[allow(dead_code)]
    pub fn with_native(mut self, escalate: bool) -> Self {
        self.escalate_to_native = escalate;
        self
    }
```

- [ ] **Step 5: Confirm the SELECT path defaults the field**

The `list_notifications` SELECT (lines 195-215) does **not** read `escalate_to_native` from the row, and there is no DB column for it. In the per-row reconstruction (lines 247-258), add `escalate_to_native: true,` to the struct literal — the persisted notifications all behave as escalation-eligible when re-emitted (which is what we want; nothing in the DB has opted out).

After the change, the literal reads:

```rust
        notifications.push(NotificationPayload {
            id: row.try_get("id")?,
            notification_type,
            title: row.try_get("title")?,
            message: row.try_get("message")?,
            source: row.try_get("source").ok().flatten(),
            action,
            metadata,
            read: row.try_get::<i32, _>("read")? != 0,
            dismissed: row.try_get::<i32, _>("dismissed")? != 0,
            timestamp: row.try_get("created_at")?,
            escalate_to_native: true,
        });
```

- [ ] **Step 6: Verify it builds and tests still pass**

Run: `cd src-tauri && cargo build && cargo test --lib should_escalate_native`
Expected: build succeeds, all 6 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/notifications.rs
git commit -m "feat(notifications): add escalate_to_native field and with_native builder"
```

---

## Task 5: Generalize `send_system_notification` and wire the escalation gate into `emit_notification`

**Files:**
- Modify: `src-tauri/src/notifications.rs`

- [ ] **Step 1: Drop the Android-only cfg on `send_system_notification`**

Change the existing function (currently lines 134-147) — remove the `#[cfg(target_os = "android")]` attribute so it compiles everywhere `tauri_plugin_notification` is available:

```rust
/// Send a native system notification via the OS notification center.
/// Used on Android (always) and on desktop (gated by `should_escalate_native`).
fn send_system_notification(app_handle: &AppHandle, notification: &NotificationPayload) {
    use tauri_plugin_notification::NotificationExt;

    if let Err(e) = app_handle
        .notification()
        .builder()
        .title(&notification.title)
        .body(&notification.message)
        .show()
    {
        log::error!("Failed to send system notification: {}", e);
    }
}
```

- [ ] **Step 2: Replace the body of `emit_notification` with the gated version**

Replace the entire current `emit_notification` (lines 107-131) with:

```rust
/// Emit a notification to the frontend, persist it, and optionally escalate
/// to a native OS banner.
///
/// Escalation rules (desktop only):
///   - window not focused or not visible
///   - desktop_notifications setting enabled (default true)
///   - payload.escalate_to_native true (default true)
///
/// When a native banner fires, the payload's action.route (if any) is stored
/// as the pending deep-link; the next time the app is activated,
/// `tray::restore_and_navigate` emits a `"deeplink"` event with that route.
pub async fn emit_notification(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    notification: NotificationPayload,
) -> Result<()> {
    // 1. In-app event (drives the existing toast UI and any other listeners).
    if let Err(e) = app_handle.emit(NOTIFICATION_EVENT, &notification) {
        log::error!("Failed to emit notification event: {}", e);
    } else {
        log::debug!(
            "Emitted notification: {} - {}",
            notification.title,
            notification.message
        );
    }

    // 2. Desktop: escalate to native banner if the window isn't in front.
    #[cfg(desktop)]
    {
        let window = app_handle.get_webview_window("main");
        let window_focused = window
            .as_ref()
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false);
        let window_visible = window
            .as_ref()
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);

        let desktop_notifs_enabled = match pool {
            Some(pool) => read_desktop_notifications_setting(pool).await,
            None => true,
        };

        if should_escalate_native(
            window_focused,
            window_visible,
            desktop_notifs_enabled,
            notification.escalate_to_native,
        ) {
            send_system_notification(app_handle, &notification);

            if let Some(route) = notification.action.as_ref().and_then(|a| a.route.clone()) {
                if let Some(state) = app_handle.try_state::<crate::tray::TrayLifecycleState>() {
                    if let Ok(mut pending) = state.pending_deeplink.lock() {
                        *pending = Some(route);
                    }
                }
            }
        }
    }

    // 3. Android: always send a system notification (unchanged from before).
    #[cfg(target_os = "android")]
    {
        send_system_notification(app_handle, &notification);
    }

    // 4. Persist.
    if let Some(pool) = pool {
        save_notification(pool, &notification).await?;
    }

    Ok(())
}

/// Read the user's desktop-notification preference from `app_settings`.
/// Defaults to true if the row is missing or unreadable.
#[cfg(desktop)]
async fn read_desktop_notifications_setting(pool: &SqlitePool) -> bool {
    let row: Result<Option<String>, _> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'desktop_notifications_enabled'",
    )
    .fetch_optional(pool)
    .await;

    match row {
        Ok(Some(v)) => v != "false" && v != "0",
        Ok(None) => true,
        Err(e) => {
            log::warn!("Failed to read desktop_notifications_enabled: {}", e);
            true
        }
    }
}
```

> **Verify before implementing:** `app_settings` is the table name `commands::get_app_setting` / `set_app_setting` use. If the table or column name differs in this repo, adjust the SELECT to match — confirm with `grep -rn "app_settings\|app_setting" src-tauri/src/`.

- [ ] **Step 3: Build and run the test suite**

Run: `cd src-tauri && cargo build && cargo test --lib`
Expected: build succeeds, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/notifications.rs
git commit -m "feat(notifications): route desktop emits through native banner escalation"
```

---

## Task 6: Window close-to-hide handler

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Install `on_window_event` on the builder**

In `src-tauri/src/lib.rs`, find the line `.register_asynchronous_uri_scheme_protocol(...)` (line 78) — directly *before* it, add:

```rust
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let app = window.app_handle();
        let should_hide = app
          .try_state::<tray::TrayLifecycleState>()
          .map(|s| !s.quit_requested.load(std::sync::atomic::Ordering::SeqCst))
          .unwrap_or(false);

        if should_hide {
          api.prevent_close();
          if let Err(e) = window.hide() {
            log::error!("Failed to hide window on close: {}", e);
          }
        }
      }
    })
```

- [ ] **Step 2: Build to verify**

Run: `cd src-tauri && cargo build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke (do not skip)**

Run: `pnpm tauri dev` (from repo root). When the window appears:
1. Click the red traffic-light button. **Expected:** window disappears, process keeps running (the dev terminal shows ongoing log output from release-checker etc.).
2. Quit the dev session with Ctrl+C in the terminal — the test for "tray Quit fully exits" comes in Task 9.

If hide does not happen, recheck the state registration from Task 2.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(window): intercept CloseRequested and hide to tray when not quitting"
```

---

## Task 7: Switch to `.build()?.run(callback)` and handle `RunEvent::Reopen`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Rewrite the builder tail**

In `src-tauri/src/lib.rs`, change the final line (currently `.run(tauri::generate_context!()).expect("error while running tauri application");` near line 569) to the callback form:

```rust
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
        if !has_visible_windows {
          tray::restore_and_navigate(app_handle);
        }
      }
    });
```

> Note: the new method chain ends with `.run(...)` returning `()`, identical to before — just with our callback installed.

- [ ] **Step 2: Build to verify**

Run: `cd src-tauri && cargo build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke**

Run: `pnpm tauri dev`. Hide the window (Task 6 behavior). On macOS, click the dock icon. **Expected:** the window reappears focused.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(window): handle RunEvent::Reopen to restore window from dock"
```

---

## Task 8: Build the tray icon and wire Show/Hide + Quit

**Files:**
- Modify: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the tray-build function to `tray.rs`**

Append to `src-tauri/src/tray.rs`:

```rust
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

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
```

- [ ] **Step 2: Override the macOS app menu's Quit so Cmd+Q routes through `request_quit`**

Without this, the default app-menu Quit fires `WindowEvent::CloseRequested`
first → the Task 6 handler intercepts it → app *hides* instead of quitting,
which directly contradicts the spec's "Cmd+Q fully exits" requirement.

Still in `tray.rs`, add:

```rust
#[cfg(target_os = "macos")]
pub fn install_app_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, Submenu};

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
            &tauri::menu::PredefinedMenuItem::about(app, Some("About Otaku"), Some(AboutMetadata::default()))?,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &tauri::menu::PredefinedMenuItem::services(app, None)?,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &tauri::menu::PredefinedMenuItem::hide(app, None)?,
            &tauri::menu::PredefinedMenuItem::hide_others(app, None)?,
            &tauri::menu::PredefinedMenuItem::show_all(app, None)?,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
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
```

- [ ] **Step 3: Call `install_app_menu` and `build_tray` from `lib.rs::setup`**

In `src-tauri/src/lib.rs`, at the bottom of the `.setup(|app| { ... })` block — after the `log::info!("Backend initialized successfully");` line and *before* the closing `Ok(())` — add (still inside the `block_on`):

```rust
        if let Err(e) = tray::install_app_menu(&app_handle) {
            log::error!("Failed to install app menu: {}", e);
        }
        if let Err(e) = tray::build_tray(&app_handle) {
            log::error!("Failed to build tray icon: {}", e);
        }
```

- [ ] **Step 4: Build to verify**

Run: `cd src-tauri && cargo build`
Expected: build succeeds. (If the `tray-icon` feature from Task 1 was not added, this will fail with "no method named `tray_handle` / `TrayIconBuilder` not in scope".)

- [ ] **Step 5: Manual smoke**

Run: `pnpm tauri dev`.
1. **Expected:** menu-bar icon appears (uses the app icon).
2. Click the red traffic-light → window hides; click the tray icon (left-click) → window reappears focused.
3. Right-click the tray icon → menu shows "Show Otaku" and "Quit Otaku".
4. Click "Show Otaku" while window is visible → window hides. Click again → window reappears.
5. Click "Quit Otaku" → the dev process exits (no orphan).
6. **Cmd+Q** from anywhere in the app → the dev process exits (no orphan). If this *hides* instead of exits, the `install_app_menu` step didn't land or the `on_menu_event` registration is racing — recheck Step 2.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/tray.rs src-tauri/src/lib.rs
git commit -m "feat(tray): add tray icon with Show/Hide/Quit and Cmd+Q app-menu override"
```

---

## Task 9: Add the "Check for new episodes now" tray item + force flag

**Files:**
- Modify: `src-tauri/src/release_checker.rs`
- Modify: `src-tauri/src/commands.rs` (if `check_for_new_releases` lives there) or `src-tauri/src/release_checker.rs`
- Modify: `src-tauri/src/tray.rs`

- [ ] **Step 1: Locate the manual-check entry point**

Run: `grep -n "check_for_new_releases\|next_scheduled_check" src-tauri/src/release_checker.rs src-tauri/src/commands.rs`

You should find a Tauri command `check_for_new_releases` (registered in `lib.rs` line 470) and the eligibility check that consults `next_scheduled_check`. Read both before editing.

- [ ] **Step 2: Add `force: bool` to the command and thread it through the eligibility check**

The command signature today is approximately:

```rust
pub async fn check_for_new_releases(state: tauri::State<'_, AppState>) -> Result<…>
```

Change it to accept an optional force flag:

```rust
#[tauri::command]
pub async fn check_for_new_releases(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    force: Option<bool>,
) -> Result<…, String> {
    let force = force.unwrap_or(false);
    // … existing body, but pass `force` into the eligibility check …
}
```

Inside `release_checker.rs`, find the `get_eligible_media` (or similarly-named) function that consults `next_scheduled_check`. Add a `force: bool` parameter; when true, skip the `next_scheduled_check` filter so every tracked item is eligible immediately:

```rust
async fn get_eligible_media(pool: &SqlitePool, force: bool) -> Result<Vec<MediaTracking>> {
    let query = if force {
        // Force path used by the tray "Check now" item — bypass the cadence gate.
        r#"SELECT … FROM … WHERE enabled = 1"#
    } else {
        // Normal scheduled path (unchanged).
        r#"SELECT … FROM … WHERE enabled = 1 AND (next_scheduled_check IS NULL OR next_scheduled_check <= ?)"#
    };
    // … bind params, run query …
}
```

> Replace `…` with the actual SELECT columns and bindings present in the existing function. Do **not** change the normal path's SQL — only add the alternative for force=true.

- [ ] **Step 3: Add the "Check for new episodes now" item to the tray menu**

In `src-tauri/src/tray.rs::build_tray`, add the new menu item *before* the second separator (between `show_hide` and `quit`):

```rust
    let check_releases = MenuItem::with_id(
        app,
        "check_releases",
        "Check for new episodes now",
        true,
        None::<&str>,
    )?;

    let menu = Menu::with_items(
        app,
        &[
            &show_hide,
            &PredefinedMenuItem::separator(app)?,
            &check_releases,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
```

In the `.on_menu_event(...)` arm, add:

```rust
            "check_releases" => trigger_release_check(app),
```

Then add the helper to `tray.rs`:

```rust
fn trigger_release_check(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Force-bypass next_scheduled_check so the manual trigger isn't a
        // no-op when the user just added an anime (finding B in the
        // 2026-05-15 release-checker diagnosis).
        if let Err(e) = crate::release_checker::run_check(&app, /* force = */ true).await {
            log::error!("Manual release check failed: {}", e);
        }
    });
}
```

> Replace `release_checker::run_check` with the actual public function name discovered in Step 1. If only a `#[tauri::command]` exists, call it via `app.run_on_main_thread` or refactor a small async helper out of the command body that both the command and the tray can call (the latter is cleaner; do that).

- [ ] **Step 4: Build to verify**

Run: `cd src-tauri && cargo build`
Expected: build succeeds.

- [ ] **Step 5: Manual smoke**

Run: `pnpm tauri dev`. Right-click the tray icon → "Check for new episodes now". **Expected:** the dev terminal shows the release checker running immediately (look for the log line emitted at the start of a check) regardless of whether the cadence would normally permit it.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/release_checker.rs src-tauri/src/commands.rs src-tauri/src/tray.rs
git commit -m "feat(tray): add Check for new episodes now with force flag"
```

---

## Task 10: TDD the downloads-count diff + add the dynamic tray menu item

**Files:**
- Modify: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/downloads/...` (wherever the in-progress count is tracked) and/or `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/tray.rs`, add at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::format_downloads_label;

    #[test]
    fn zero_renders_idle_label() {
        assert_eq!(format_downloads_label(0), "No active downloads");
    }

    #[test]
    fn one_renders_singular() {
        assert_eq!(format_downloads_label(1), "Downloads: 1 in progress");
    }

    #[test]
    fn many_renders_plural() {
        assert_eq!(format_downloads_label(5), "Downloads: 5 in progress");
    }
}
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd src-tauri && cargo test --lib format_downloads_label`
Expected: FAIL with "cannot find function `format_downloads_label`".

- [ ] **Step 3: Implement the label formatter**

Add to `tray.rs`:

```rust
/// Render the dynamic tray menu label for the active downloads count.
pub(crate) fn format_downloads_label(active: usize) -> String {
    if active == 0 {
        "No active downloads".to_string()
    } else {
        format!("Downloads: {} in progress", active)
    }
}
```

- [ ] **Step 4: Confirm tests pass**

Run: `cd src-tauri && cargo test --lib format_downloads_label`
Expected: 3 tests pass.

- [ ] **Step 5: Add the menu item and store its handle**

Update `TrayLifecycleState`:

```rust
use tauri::menu::MenuItem as TauriMenuItem;
use tauri::Wry;

#[derive(Default)]
pub struct TrayLifecycleState {
    pub quit_requested: AtomicBool,
    pub pending_deeplink: Mutex<Option<String>>,
    /// Handle to the dynamic "Downloads: N in progress" menu item so we can
    /// update its text and enabled state without rebuilding the whole menu.
    pub downloads_item: Mutex<Option<TauriMenuItem<Wry>>>,
    /// Last value pushed to `downloads_item` so we can short-circuit when the
    /// active count hasn't actually changed (perf-audit finding: download
    /// progress events fire per-tick — never re-set text every tick).
    pub last_downloads_count: Mutex<usize>,
}
```

In `build_tray`, build the item and store the handle (the item starts disabled):

```rust
    let downloads_item = MenuItem::with_id(
        app,
        "downloads_status",
        format_downloads_label(0),
        false, // disabled when count = 0
        None::<&str>,
    )?;

    if let Some(state) = app.try_state::<TrayLifecycleState>() {
        if let Ok(mut slot) = state.downloads_item.lock() {
            *slot = Some(downloads_item.clone());
        }
    }

    let menu = Menu::with_items(
        app,
        &[
            &show_hide,
            &PredefinedMenuItem::separator(app)?,
            &downloads_item,
            &check_releases,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
```

In `.on_menu_event`, add an arm for clicking it (jumps to /downloads):

```rust
            "downloads_status" => {
                if let Some(state) = app.try_state::<TrayLifecycleState>() {
                    if let Ok(mut pending) = state.pending_deeplink.lock() {
                        *pending = Some("/downloads".to_string());
                    }
                }
                restore_and_navigate(app);
            }
```

- [ ] **Step 6: Add `update_downloads_count` and wire it to download events**

Add to `tray.rs`:

```rust
/// Update the tray's downloads item if (and only if) the active count changed.
/// Safe to call from any thread / on every progress tick — the per-tick
/// no-op short-circuit prevents UI churn.
pub fn update_downloads_count(app: &AppHandle, active: usize) {
    let Some(state) = app.try_state::<TrayLifecycleState>() else {
        return;
    };

    {
        let mut last = match state.last_downloads_count.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if *last == active {
            return;
        }
        *last = active;
    }

    let Ok(item_slot) = state.downloads_item.lock() else {
        return;
    };
    let Some(item) = item_slot.as_ref() else {
        return;
    };

    if let Err(e) = item.set_text(format_downloads_label(active)) {
        log::error!("Failed to update downloads tray label: {}", e);
    }
    if let Err(e) = item.set_enabled(active > 0) {
        log::error!("Failed to update downloads tray enabled state: {}", e);
    }
}
```

- [ ] **Step 7: Hook the count source**

Locate the place where in-progress download counts change. The `DownloadManager` already emits status events; find its event-emission site:

Run: `grep -rn "app_handle.emit\|app.emit" src-tauri/src/downloads/`

Wherever a download status changes (start, complete, fail, cancel) for either episode or chapter manager, add a call to compute the *combined* active count and call `tray::update_downloads_count(app, active)`. If the manager already exposes a "list active" helper, reuse it; otherwise add a small `active_count(&self) -> usize` method that returns the number of downloads whose status is `downloading`.

The combined count comes from both episode and chapter managers — sum them.

- [ ] **Step 8: Build and run all tests**

Run: `cd src-tauri && cargo build && cargo test --lib`
Expected: builds and all tests pass.

- [ ] **Step 9: Manual smoke**

Run: `pnpm tauri dev`. Open the app, start an episode download. **Expected:** the tray menu (right-click to open) shows "Downloads: 1 in progress" and the item is enabled. After completion, it returns to "No active downloads" (disabled). Clicking the active item shows the window and navigates to `/downloads`.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/tray.rs src-tauri/src/downloads/
git commit -m "feat(tray): live downloads count menu item with per-tick short-circuit"
```

---

## Task 11: Route `emit_release_notification` through `emit_notification`

**Files:**
- Modify: `src-tauri/src/release_checker.rs`

- [ ] **Step 1: Find the current implementation**

Run: `grep -n "emit_release_notification\|fn emit_release" src-tauri/src/release_checker.rs`

Read the existing function. Per the 2026-05-15 diagnosis, it currently builds a payload and calls `app_handle.emit("notification", …)` directly.

- [ ] **Step 2: Replace direct emit with `emit_notification`**

Rewrite the function to construct a `NotificationPayload` and hand it to the chokepoint. For a new-episode release the payload should look like:

```rust
async fn emit_release_notification(
    app_handle: &tauri::AppHandle,
    pool: Option<&sqlx::SqlitePool>,
    media_id: &str,
    title: &str,
    new_kind: &str,        // "episode" | "chapter"
    new_number: f64,
) -> anyhow::Result<()> {
    use crate::notifications::{NotificationPayload, NotificationType};

    let (heading, route) = match new_kind {
        "chapter" => (
            format!("New chapter of {}", title),
            format!("/manga/{}", media_id),
        ),
        _ => (
            format!("New episode of {}", title),
            format!("/anime/{}", media_id),
        ),
    };

    let body = match new_kind {
        "chapter" => format!("Chapter {} is available now.", trim_number(new_number)),
        _ => format!("Episode {} is available now.", trim_number(new_number)),
    };

    let payload = NotificationPayload::new(NotificationType::Success, heading, body)
        .with_source("release_checker")
        .with_action("Open", Some(route), None)
        .with_metadata(serde_json::json!({
            "media_id": media_id,
            "kind": new_kind,
            "number": new_number,
        }));

    crate::notifications::emit_notification(app_handle, pool, payload).await?;
    Ok(())
}

/// Render whole numbers as integers ("12") and fractions as full decimals
/// ("12.5") for human-readable notification bodies.
fn trim_number(n: f64) -> String {
    if (n.fract()).abs() < f64::EPSILON {
        format!("{}", n as i64)
    } else {
        format!("{}", n)
    }
}
```

> Adjust the function signature to match the call sites (e.g. some may already pass an `extension_id`, a release timestamp, etc. — preserve the existing inputs; only the body changes).

- [ ] **Step 3: Update all call sites**

Run: `grep -n "emit_release_notification" src-tauri/src/release_checker.rs`

Each call site must now `await?` the new async function (it already returns `Result`); pass the optional pool reference if it wasn't already passed.

- [ ] **Step 4: Build and test**

Run: `cd src-tauri && cargo build && cargo test --lib`
Expected: success.

- [ ] **Step 5: Manual smoke**

Run: `pnpm tauri dev`. Hide the window. Trigger a release check via the tray ("Check for new episodes now") with at least one tracked anime that has a known new episode. **Expected:** OS native banner appears. (If no real new episode is available, temporarily comment out the persistence/duplicate gate in `should_notify` to force one for the smoke; revert after.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/release_checker.rs
git commit -m "feat(release_checker): route notifications through emit_notification chokepoint"
```

---

## Task 12: Add the app-update-available notification helper and call it

**Files:**
- Modify: `src-tauri/src/notifications.rs`
- Modify: wherever the update check completes (locate in Step 1)

- [ ] **Step 1: Locate the update-check completion site**

Run: `grep -rn "tauri_plugin_updater\|update\\.check\\|Update available\|update_check_info" src-tauri/src/ src/`

The frontend may handle this today via `getUpdateCheckInfo`/`setUpdateCheckInfo` commands (visible in `lib.rs` line 461-462). Decide based on what you find:
- If the backend already has a "we just discovered an update" hook, add the helper call there.
- If only the frontend knows, add the helper as a backend command the frontend calls when its update-check returns `true`.

- [ ] **Step 2: Add the helper to `notifications.rs`**

After the existing `notify_*` helpers (around line 472), append:

```rust
/// Emit an app-update-available notification. Routes through `emit_notification`
/// so it inherits in-app toast + native banner escalation + persistence.
pub async fn notify_app_update_available(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    version: &str,
) -> Result<()> {
    let notification = NotificationPayload::new(
        NotificationType::Info,
        "Update available",
        format!("Otaku {} is ready to install.", version),
    )
    .with_source("updater")
    .with_action(
        "Update",
        Some("/settings#update".to_string()),
        None,
    )
    .with_metadata(serde_json::json!({ "version": version }));

    emit_notification(app_handle, pool, notification).await
}
```

> The route `/settings#update` assumes the existing settings page has an update section; adjust to whatever the real settings route is.

- [ ] **Step 3: Call the helper from the update-check completion**

If the existing path is a backend tauri::command (recommended), add a single line that fires the helper once when a new version is detected (do not fire on every poll):

```rust
        if new_version_detected {
            let _ = crate::notifications::notify_app_update_available(
                &app_handle,
                Some(pool),
                &new_version,
            ).await;
        }
```

If the path lives in the frontend, add a tiny new command `notify_update_available(version: String)` that calls the helper, and invoke it from the frontend's existing update-detected branch.

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/notifications.rs <other files touched>
git commit -m "feat(updater): notify on app update available via emit_notification"
```

---

## Task 13: Register the autostart plugin and add settings commands

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Register the autostart plugin**

In `src-tauri/src/lib.rs`, in the `tauri::Builder::default()` chain (lines 57-62), wrap with the `#[cfg(desktop)]` block since autostart is desktop-only. Adjust the builder to:

```rust
  let mut builder = tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_notification::init());

  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      Some(vec!["--hidden"]),
    ));
  }
```

- [ ] **Step 2: Add the four commands**

In `src-tauri/src/commands.rs`, append:

```rust
// ==================== Autostart ====================

#[tauri::command]
#[cfg(desktop)]
pub async fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
#[cfg(desktop)]
pub async fn get_autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

// Mobile no-ops so the frontend has one API to call. Android still has its
// own launcher conventions; iOS isn't in scope.
#[tauri::command]
#[cfg(not(desktop))]
pub async fn set_autostart(_enabled: bool) -> Result<(), String> { Ok(()) }

#[tauri::command]
#[cfg(not(desktop))]
pub async fn get_autostart_status() -> Result<bool, String> { Ok(false) }

// ==================== Desktop notifications toggle ====================

#[tauri::command]
pub async fn set_desktop_notifications_enabled(
    state: tauri::State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    let value = if enabled { "true" } else { "false" };
    set_app_setting(state, "desktop_notifications_enabled".to_string(), value.to_string()).await
}

#[tauri::command]
pub async fn get_desktop_notifications_enabled(
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    match get_app_setting(state, "desktop_notifications_enabled".to_string()).await? {
        Some(v) => Ok(v != "false" && v != "0"),
        None => Ok(true),
    }
}
```

> If `set_app_setting` / `get_app_setting` have different signatures, adjust the calls — the goal is round-tripping a string under the key `desktop_notifications_enabled`.

- [ ] **Step 3: Register the new commands in `generate_handler!`**

In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler![...]` list (anywhere in it):

```rust
      // Tray / background settings
      commands::set_autostart,
      commands::get_autostart_status,
      commands::set_desktop_notifications_enabled,
      commands::get_desktop_notifications_enabled,
```

- [ ] **Step 4: Honour `--hidden` boot**

In `src-tauri/src/lib.rs`, inside `.setup(|app| { ... })`, near the top (after the database-init block in the existing flow), detect the flag and hide the main window before it ever shows:

```rust
      if std::env::args().any(|a| a == "--hidden") {
        if let Some(window) = app_handle.get_webview_window("main") {
          let _ = window.hide();
        }
      }
```

> Tauri shows the window on app start by default; `hide()` immediately after creation is the documented pattern for "start hidden."

- [ ] **Step 5: Build and test**

Run: `cd src-tauri && cargo build && cargo test --lib`
Expected: success.

- [ ] **Step 6: Manual smoke**

Run: `pnpm tauri dev`. From DevTools call `__TAURI__.core.invoke('set_autostart', { enabled: true })`. **Expected:** no error; check `~/Library/LaunchAgents/` for a new `com.otaku.player.plist` (or similar bundle-id-based name). Call `set_autostart` with `enabled: false` to clean up.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "feat(autostart): register plugin, add settings commands, honour --hidden boot"
```

---

## Task 14: Frontend deeplink event listener

**Files:**
- Locate first: the router root (likely `src/routes/__root.tsx`) — confirm with `grep -n "createRootRoute\|__root" src/routes/`.
- Modify: that file.
- Create: `src/hooks/useDeeplinkListener.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/useDeeplinkListener.ts
//
// Listens for the backend "deeplink" event (emitted by tray::restore_and_navigate
// whenever the app is brought forward) and navigates the TanStack router.
//
// Mount once at the router root.

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useNavigate } from '@tanstack/react-router';

export function useDeeplinkListener(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<string>('deeplink', (event) => {
      const route = event.payload;
      if (typeof route === 'string' && route.length > 0) {
        navigate({ to: route as never }).catch((e) => {
          console.warn('[deeplink] navigate failed', route, e);
        });
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((e) => console.error('[deeplink] listen failed', e));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [navigate]);
}
```

- [ ] **Step 2: Add a Vitest spec**

```typescript
// src/hooks/useDeeplinkListener.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDeeplinkListener } from './useDeeplinkListener';

const navigate = vi.fn();
let registeredHandler: ((event: { payload: string }) => void) | undefined;
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_eventName: string, handler: (e: { payload: string }) => void) => {
    registeredHandler = handler;
    return Promise.resolve(unlisten);
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

beforeEach(() => {
  navigate.mockReset();
  unlisten.mockReset();
  registeredHandler = undefined;
});

describe('useDeeplinkListener', () => {
  it('navigates when a string deeplink payload is received', async () => {
    renderHook(() => useDeeplinkListener());
    await Promise.resolve(); // let the listen() promise resolve

    registeredHandler?.({ payload: '/anime/123' });
    expect(navigate).toHaveBeenCalledWith({ to: '/anime/123' });
  });

  it('ignores empty payloads', async () => {
    renderHook(() => useDeeplinkListener());
    await Promise.resolve();

    registeredHandler?.({ payload: '' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useDeeplinkListener());
    await Promise.resolve();

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `pnpm vitest run src/hooks/useDeeplinkListener.test.ts`
Expected: 3 tests pass.

- [ ] **Step 4: Mount the hook at the router root**

In the router root file (e.g. `src/routes/__root.tsx`), inside the root component, add:

```typescript
import { useDeeplinkListener } from '../hooks/useDeeplinkListener';

function RootLayout() {
  useDeeplinkListener();
  // … existing root JSX …
}
```

- [ ] **Step 5: Run typecheck, vitest, eslint**

Run: `pnpm typecheck && pnpm vitest run && pnpm lint`
Expected: typecheck passes; vitest green; eslint has at most the 11 pre-existing warnings (no new ones).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useDeeplinkListener.ts src/hooks/useDeeplinkListener.test.ts src/routes/__root.tsx
git commit -m "feat(frontend): listen for backend deeplink event at router root"
```

---

## Task 15: Frontend Settings toggles

**Files:**
- Locate: the settings page (`grep -n "settings" src/routes/ | head` — likely `src/routes/settings.tsx` or similar).
- Modify: that file.

- [ ] **Step 1: Read the existing settings page to match its toggle pattern**

Run: `grep -n "Switch\|Toggle\|invoke" src/routes/settings*.tsx 2>/dev/null` (or the actual path found above).

Identify how existing toggles are structured (component name, label/description pattern, async-load + invoke wiring).

- [ ] **Step 2: Add the "Launch Otaku at login" toggle**

Add a section that:
1. On mount, calls `invoke<boolean>('get_autostart_status')` and seeds local state.
2. On toggle, calls `invoke('set_autostart', { enabled: next })` and, on success, updates local state; on failure shows a toast and reverts.

Use the same component the existing toggles use (do not introduce a new one). The label is **"Launch Otaku at login"** with description "Otaku starts in the background when you log in, with the menu-bar icon ready."

- [ ] **Step 3: Add the "Desktop notifications" toggle**

Mirror Step 2 with `get_desktop_notifications_enabled` / `set_desktop_notifications_enabled`. Label: **"Desktop notifications"**. Description: "Show OS notification banners when the window is hidden or in the background."

- [ ] **Step 4: Run typecheck, vitest, eslint**

Run: `pnpm typecheck && pnpm vitest run && pnpm lint`
Expected: typecheck passes; existing tests still green; no new lint warnings.

- [ ] **Step 5: Manual smoke**

Run: `pnpm tauri dev`. Navigate to Settings:
1. Toggle "Launch Otaku at login" → on. Check `~/Library/LaunchAgents/` for a new plist; toggle off → it disappears.
2. Toggle "Desktop notifications" → off. Hide the window and trigger a notification (e.g. via the tray's release check). **Expected:** no native banner. Toggle back on, repeat. **Expected:** native banner appears.

- [ ] **Step 6: Commit**

```bash
git add src/routes/settings*.tsx
git commit -m "feat(frontend): add Launch-at-login and Desktop-notifications settings toggles"
```

---

## Task 16: End-to-end verification pass

**Files:** none modified — verification only.

- [ ] **Step 1: Repo-required checks**

Run, from the repo root:

```bash
pnpm typecheck
pnpm vitest run
pnpm lint
cd src-tauri && cargo build && cargo clippy --all-targets -- -D warnings && cargo test --lib && cd -
```

Expected:
- `pnpm typecheck` — no errors.
- `pnpm vitest run` — all green.
- `pnpm lint` — at most 11 warnings (the pre-existing baseline), zero errors.
- `cargo build` — succeeds.
- `cargo clippy` — zero warnings for code touched in this branch.
- `cargo test` — `should_escalate_native` (6) + `format_downloads_label` (3) + any pre-existing tests all pass.

- [ ] **Step 2: Manual end-to-end smoke**

Run: `pnpm tauri dev` from the repo root.

Tick each:
- [ ] App launches with a window and a tray icon.
- [ ] Close window → window hides, process keeps running (release-checker log still ticks).
- [ ] Tray left-click → window restores focused.
- [ ] Tray right-click menu: Show/Hide toggles, Check for new episodes now runs immediately (log line confirms), Quit fully exits.
- [ ] Start a download → tray menu item updates to "Downloads: 1 in progress" and is enabled. Click it → window opens to `/downloads`. Cancel/complete → tray returns to "No active downloads" disabled.
- [ ] With window focused, trigger any notification (e.g. complete a download) → in-app toast only, no native banner.
- [ ] Hide the window, trigger the same → native OS banner appears.
- [ ] Click the native banner → window restores, router navigates to the route the notification carried.
- [ ] Settings → toggle "Launch Otaku at login" on; verify LaunchAgent plist created; toggle off; verify removed.
- [ ] Settings → toggle "Desktop notifications" off; trigger notification while hidden → no banner; toggle on → banner returns.
- [ ] Quit via Cmd+Q. Restart. Verify state survives (autostart still on if it was on; desktop_notifications setting persisted).

- [ ] **Step 3: Commit a verification log**

Compose a brief flow update note (see flow §4.5 — under 10 lines, two paragraphs) summarizing what was verified, save to `~/.flow/tasks/tray-notifications/updates/2026-MM-DD-end-to-end-verification.md` via the flow skill's note workflow.

- [ ] **Step 4: Final commit if any touch-ups landed**

```bash
git status
# If anything new appeared from the smoke pass, commit it with a message
# describing the specific fix; otherwise this task ends without a commit.
```

---

## Notes for the executing engineer

- **Order matters.** Tasks are sequential; each one keeps the repo in a buildable, runnable state. Do not skip ahead.
- **Pure logic vs integration.** Tasks 3, 4, 10 (decision function, payload field, label formatter) are TDD with unit tests. Tasks 6, 7, 8, 9, 11, 12, 13 touch Tauri lifecycle / external systems — they're verified by `cargo build` plus an explicit manual smoke. Do not invent fake unit tests for them.
- **`#[cfg(desktop)]` vs `#[cfg(not(target_os = "android"))]`.** The spec mandates `#[cfg(desktop)]` — use that. iOS targets are excluded automatically; Android keeps its existing path.
- **The deep-link is best-effort by design** — last-actionable-route wins when multiple banners stack. Don't try to invent per-notification attribution unless the implementation spike in Task 11/12 shows the plugin reliably delivers desktop click events on the current Tauri version. If it does, that's a follow-up task, not this plan.
- **Eslint baseline is 11 pre-existing warnings.** Do not let your changes increase that.
- **The CLAUDE.md in `src-tauri/src/` is empty by current snapshot.** All Rust conventions follow the existing module style in `notifications.rs` / `release_checker.rs` (snake_case fns, `log::*` for logging, `anyhow::Result` for fallible helpers, `Result<…, String>` for Tauri commands).

# Background mode, system tray & native desktop notifications

**Status:** approved design — implementation pending
**Date:** 2026-05-28
**Task:** flow `tray-notifications`
**Work dir:** `/Users/vishnukv/facets/codebases/otaku`

## Goal

Let Otaku keep running in the background after the window is closed, surface a
menu-bar (tray) icon to control and restore it, and route the existing
notification events to the OS-native notification center on desktop.

The background work that already exists (release checker, daily schedule,
auto-backup) currently dies when the user closes the window. The OS-native
notification path inside `notifications::emit_notification` exists but is
gated `#[cfg(target_os = "android")]`, so desktop only ever fires the in-app
toast. This feature closes both gaps so "tell me when a new episode drops"
works while the app is hidden.

## Decisions (from brainstorming)

| Dimension | Decision |
| --- | --- |
| Window close | **Hide to tray, keep running** (fixed, not configurable). Cmd+Q and tray "Quit" are the only paths to fully exit. |
| Tray menu | Show/Hide window · Quit · **Check for new episodes now** · live **downloads in progress** count (+ jump to `/downloads`) |
| Native notifications fire for | New episode/chapter released · Download/chapter complete · App update available |
| Suppression rule | Native banner only when window is hidden/unfocused (focused case is already covered by the in-app toast — avoid double-notify) |
| Click behavior | Restore + focus window **+ deep-link** to the notification's `action.route` |
| Platforms | All desktop (`#[cfg(desktop)]`). Android keeps its existing path unchanged. |
| Autostart | Yes — Settings toggle backed by `tauri-plugin-autostart`; starts hidden into the tray. |
| Notification routing | **Extend `emit_notification` centrally** (un-gate to all platforms + add focus-aware escalation). |

## Architecture

The feature is backend-weighted. Three new concerns plug into Tauri's
existing lifecycle, plus a thin frontend listener.

```
                        ┌───────────────────────────────────────────────────┐
   release_checker ─┐   │ notifications::emit_notification()                │
   downloads      ──┼──▶│ (single chokepoint, src-tauri/src/notifications.rs)│
   updater        ──┘   │                                                   │
                        │ 1. always emit Tauri event (drives in-app toast)  │
                        │ 2. always persist to SQLite                       │
                        │ 3. IF desktop && window hidden/unfocused          │
                        │    && desktop-notifs enabled                      │
                        │    && payload.escalate_to_native                  │
                        │    → show native banner via tauri-plugin-notification│
                        │    → store pending_deeplink = payload.action.route│
                        └───────────────────────────────────────────────────┘
                                          │ click / dock / tray brings app forward
                                          ▼
   RunEvent::Reopen, tray left-click,
   tray "Show", single-instance focus  ──▶ show + focus + unminimize main window
                                       ──▶ emit "deeplink" event (route) to frontend
                                       ──▶ frontend router navigates, clears pending
```

## Components

### 1. `src-tauri/src/tray.rs` (new)

Owns the menu-bar icon and its menu.

- `build_tray(app: &AppHandle) -> tauri::Result<()>` builds a
  `TrayIconBuilder` using the app's default window icon, with a menu:
  1. *Show / Hide window* (toggle based on current visibility)
  2. separator
  3. *Downloads: N in progress* (dynamic text; N counts downloads whose
     status is `downloading` — queued and completed/failed/cancelled are
     excluded; episode + chapter downloads are summed). Clicking jumps
     to `/downloads` and shows the window. Disabled when N = 0.
  4. *Check for new episodes now*
  5. separator
  6. *Quit Otaku*
- Left-click on the tray icon → show + focus + unminimize the main window.
- A `TrayState` (held in app-managed state) keeps handles to the dynamic
  menu items so the downloads-count text can be updated in place without
  rebuilding the menu.
- The downloads counter updates **only when the count changes**, not on
  every progress tick — the 2026-05-18 performance audit flagged that
  download events fire per-tick. We subscribe to existing download-status
  changes and diff the active count; throttling lives here.
- "Check for new episodes now" calls the existing
  `commands::check_for_new_releases` command and **passes a force flag** so
  it bypasses the `next_scheduled_check` gate. Otherwise it would be a
  silent no-op (finding B in the shelved 2026-05-15 release-checker
  diagnosis). If `check_for_new_releases` doesn't already accept a force
  argument, this task adds it.

### 2. Window lifecycle (in `src-tauri/src/lib.rs`)

- `on_window_event(|win, event| ...)` on the main window: when
  `WindowEvent::CloseRequested { api, .. }` fires, call
  `api.prevent_close()` then `win.hide()`, **unless** a `quit_requested`
  flag (`AtomicBool` in app state) is set — in which case let the close
  proceed.
- The tray "Quit" item and any future "real quit" path set
  `quit_requested = true` and then call `app.exit(0)`.
- Switch the builder's tail from `.run(generate_context!())` to the
  callback form: `.build(generate_context!())?.run(|app_handle, event|
  …)`. In that callback:
  - `RunEvent::Reopen { has_visible_windows: false, .. }` (macOS
    dock-click when window is hidden) → show + focus the main window and
    flush any pending deep-link.
  - We do **not** suppress `RunEvent::ExitRequested` — with
    `prevent_close()` the window never closes naturally, so the only
    paths that reach exit are Cmd+Q and tray Quit, both of which we
    intend to honour.

### 3. `src-tauri/src/notifications.rs` changes

- **Un-gate `send_system_notification`.** Today it's
  `#[cfg(target_os = "android")]`. Generalize to all platforms (Android
  keeps its existing call site; desktop gets a parallel call gated by the
  escalation rule below).
- **Add a pure decision function:**
  ```rust
  fn should_escalate_native(
      window_focused: bool,
      window_visible: bool,
      desktop_notifs_enabled: bool,
      escalate_flag: bool,
  ) -> bool {
      // Suppress when the window is genuinely in front of the user.
      let foreground = window_focused && window_visible;
      desktop_notifs_enabled && escalate_flag && !foreground
  }
  ```
  This is the unit-tested seam; the rest of `emit_notification` reads
  window state and calls it.
- **Add a non-persisted `escalate_to_native: bool` field** to
  `NotificationPayload` (defaults `true` via a `default_true` serde
  default). A `with_native(false)` builder lets cosmetic notifications
  (e.g. "removed from library") opt out. The field is **not** added to
  the SQLite schema — it only affects emission, so no DB migration.
- **Wire the desktop-notifications master toggle.** The escalation gate
  reads an `app_setting` key `desktop_notifications_enabled` (default
  `true`); the Settings toggle below writes it. Read is cheap (existing
  `get_app_setting` path).
- **Set `pending_deeplink`** in app state to `payload.action.route` when
  a native banner is shown. Last-write-wins.
- **Routing call sites through the chokepoint.** Native banners only
  fire for events that actually traverse `emit_notification`. Today:
  - Download / chapter download complete: already go through
    `notify_download_complete` / `notify_chapter_download_complete` →
    `emit_notification`. **No change needed.**
  - New episode/chapter released: `release_checker::emit_release_notification`
    historically emits the `"notification"` Tauri event directly
    (per the 2026-05-15 diagnosis chain). It must be reworked to call
    `emit_notification` so it inherits in-app + native + persistence
    + the escalation gate uniformly. This is part of the task.
  - App update available: `tauri-plugin-updater` doesn't currently
    feed the notification system. Add a small helper
    `notify_app_update_available(version, route)` and call it from
    wherever the updater check completes (frontend or backend,
    matching the existing update flow) so the banner fires when the
    window is hidden.

### 4. Deep-link delivery (pending-deeplink model)

We design around the desktop limitation honestly:
`tauri-plugin-notification`'s per-banner click callback is not reliably
delivered on macOS (the `notify-rust` / `mac-notification-sys` backend
is historically inconsistent). Instead of depending on a banner-click
event, deep-links are surface-agnostic:

1. When a native banner is shown, the backend stores the route in
   `pending_deeplink: Mutex<Option<String>>`.
2. Whatever brings the app forward — banner click (macOS activates the
   app), dock click, tray left-click, tray "Show", or a future
   single-instance focus — calls a single helper
   `restore_and_navigate(app)`:
   - `window.show()`, `window.unminimize()`, `window.set_focus()`.
   - Take the pending route; if present, `app.emit("deeplink", &route)`.
   - Frontend router root listens for `deeplink` and navigates.
3. Limitation: with several stacked native banners, click → routes to
   the most-recent actionable one. Acceptable for v1; documented.

**Verify-during-implementation:** spike whether the plugin delivers a
real desktop click event on the current Tauri / plugin versions. If it
does, upgrade attribution to per-notification accuracy (set
`pending_deeplink` from the click callback instead of the show site).

### 5. Autostart

- Add `tauri-plugin-autostart = "2"` to `Cargo.toml`.
- Register with `MacosLauncher::LaunchAgent` and args `["--hidden"]`.
- Boot path in `setup`: if `std::env::args().any(|a| a == "--hidden")`
  (or autostart was the launcher), skip the initial `window.show()`
  call — the app starts in the tray only.
- New commands:
  - `set_autostart(enabled: bool) -> Result<()>` — enables or disables
    the LaunchAgent and writes an `app_setting` mirror.
  - `get_autostart_status() -> Result<bool>` — reads plugin state.
- Settings UI binds to these (see §6).

### 6. Frontend changes

Kept deliberately small.

- **Router root:** add a Tauri event listener on `deeplink` (string
  route) that calls the existing TanStack Router `navigate` to that
  route. Mount once at the root.
- **Settings page** (existing): two new toggles in the "Behavior" / "App"
  section:
  - **Launch Otaku at login** — wired to
    `set_autostart` / `get_autostart_status`.
  - **Desktop notifications** — wired to
    `app_setting('desktop_notifications_enabled')`. Default `true`.
- No new pages, no new routes, no design-system changes.

### 7. Cargo, capabilities, config

- `src-tauri/Cargo.toml`:
  - `tauri` features: add `tray-icon` to the existing `["protocol-asset"]`.
  - Add `tauri-plugin-autostart = "2"`.
- `src-tauri/capabilities/*.json`:
  - Notifications: the plugin's permission must be enabled (already used
    on Android; if the desktop capability is gated separately, add the
    `notification:default` permission).
  - Autostart: add `autostart:default` if invoked from JS. We can keep
    everything Rust-side (commands invoked from the frontend), in which
    case no JS capability is needed; the autostart plugin's JS API
    capability is **not** required.
  - Tray: created from Rust, no capability change.
- `tauri.conf.json`: no changes (tray is built in Rust; autostart needs
  no config).

### 8. State, types, command surface

- `AppState` (or a dedicated `TrayState` struct in app-managed state)
  gains:
  - `quit_requested: AtomicBool`
  - `pending_deeplink: Mutex<Option<String>>`
  - `tray_handles: Mutex<Option<TrayMenuHandles>>` (held so dynamic
    menu items can be updated)
- `NotificationPayload` gains `escalate_to_native: bool` (serde default
  `true`, not persisted).
- New commands registered in `tauri::generate_handler!`:
  - `set_autostart(enabled: bool)`
  - `get_autostart_status()`
  - `set_desktop_notifications_enabled(enabled: bool)`
  - `get_desktop_notifications_enabled()`
- The "Check for new episodes now" tray action invokes the existing
  `check_for_new_releases` command (with a force argument added if
  missing) — no new command wrapping it.

## Data flow

**New episode example (window hidden):**

1. `release_checker.rs` detects a new episode, builds
   `NotificationPayload` with `action.route = "/anime/<id>"`.
2. `emit_notification` always emits the Tauri event (in-app toast — no
   visible effect when window is hidden) and persists to SQLite.
3. Escalation gate: window not focused, not visible, desktop notifs
   enabled, escalate flag true → show native banner; set
   `pending_deeplink = "/anime/<id>"`.
4. User clicks the banner → macOS activates Otaku → `RunEvent::Reopen`
   fires → `restore_and_navigate` shows the window, emits `deeplink`,
   frontend navigates.

**Download complete (window focused):** in-app toast as today; native
banner suppressed by the focus rule; pending_deeplink unchanged.

**Background episode check via tray:** user picks "Check for new
episodes now"; the command runs with force=true regardless of
`next_scheduled_check`; any new releases follow the path above.

## Error handling

- Native-notification failure → `log::error!`, continue. Never fail the
  emit (preserves existing behaviour for Android).
- Tray build failure → log error, continue running with no tray
  (degraded; window still visible). Platforms without tray support
  return `Ok(())` and skip.
- Autostart enable/disable failure → bubble up as command `Result::Err`
  so the Settings toggle can surface it and revert the UI state.
- Window operations always guarded:
  `if let Some(win) = app.get_webview_window("main") { … }`.

## Testing

**Rust unit tests** (`#[cfg(test)]` in `notifications.rs`):
- `should_escalate_native` matrix:
  - focused + visible → `false`
  - hidden → `true`
  - visible but not focused → `true` (background-but-on-screen counts
    as background)
  - desktop-notifs disabled → `false`
  - escalate-flag false → `false`
- Downloads-count change detector (a small pure function comparing
  previous vs current active count).

**Manual verification** (`pnpm tauri dev` on macOS):
1. Closing the window hides it; the process keeps running (tail logs,
   confirm release-checker tick continues).
2. Tray menu items: Show/Hide toggles visibility; Quit fully exits;
   Check now triggers an immediate release check; downloads counter
   updates as a download starts/completes.
3. Trigger a notification while focused → toast only, no native banner.
   Hide the window, trigger again → native banner appears.
4. Click the banner → window restores, navigates to the correct route.
5. Settings: enable "Launch at login" → LaunchAgent appears in
   `~/Library/LaunchAgents/`; re-login → app starts hidden, tray
   icon present.

**Repo-required checks** (must all pass clean):
- `pnpm typecheck`
- `pnpm vitest run`
- `pnpm lint` (must not add new warnings beyond the 11 pre-existing ones)
- `cd src-tauri && cargo build` and `cargo clippy -- -D warnings` for
  new code.

## File-level change list

- `src-tauri/Cargo.toml` — `tauri` `tray-icon` feature; add
  `tauri-plugin-autostart`.
- `src-tauri/src/tray.rs` — **new** module (tray build, menu events,
  downloads-count updater, `restore_and_navigate` helper).
- `src-tauri/src/lib.rs` — register autostart plugin; build tray in
  `setup`; install `on_window_event`; switch to `.build()?.run(...)`
  callback form for `RunEvent::Reopen`; add new app state; register
  new commands; honour `--hidden` boot.
- `src-tauri/src/notifications.rs` — generalize platform gate;
  `should_escalate_native`; `escalate_to_native` field on payload;
  `pending_deeplink` set on native show.
- `src-tauri/src/commands.rs` — new commands (autostart status/setter,
  desktop-notifs enabled status/setter); force flag on
  `check_for_new_releases` if not already present.
- `src-tauri/src/release_checker.rs` — (a) accept/honour the force flag
  from the tray manual trigger (bypass `next_scheduled_check` only on
  the force path); (b) route `emit_release_notification` through
  `notifications::emit_notification` instead of emitting the
  `"notification"` Tauri event directly, so new-episode banners
  inherit the escalation gate and deep-link.
- `tauri-plugin-updater` integration — add a
  `notify_app_update_available(version, route)` helper in
  `notifications.rs` and call it from the existing update-check site
  so the banner fires when the window is hidden. Exact call site to be
  located during implementation.
- `src-tauri/capabilities/*.json` — confirm notification permission;
  no JS-side autostart capability needed.
- Frontend Settings component — two new toggles (autostart, desktop
  notifications).
- Frontend router root — `deeplink` event listener that navigates.

## Out of scope (v1)

- Per-notification click attribution beyond the last-actionable-route
  heuristic (will be upgraded if the implementation spike confirms the
  plugin delivers desktop click events).
- Visual QA on Windows / Linux (code paths build via `#[cfg(desktop)]`,
  but verification is macOS-only).
- Fixing the broader release-checker reliability bugs (findings A, C,
  D, E, F from the shelved 2026-05-15 diagnosis) — we only
  force-bypass `next_scheduled_check` for the manual tray trigger,
  nothing else.
- Tray icon badges, animated icons, or custom artwork (reuses the
  app's existing icon).
- Mobile (iOS / Android) — Android keeps its current notification path
  untouched; iOS is out of scope entirely.

## Open questions (resolve during implementation)

- Does `tauri-plugin-notification` deliver a reliable per-notification
  click event on macOS desktop with the current crate version? If yes,
  set `pending_deeplink` from the click callback instead of the show
  site for exact attribution.
- Does the existing `check_for_new_releases` command already accept a
  force argument? If yes, reuse; if no, add it and thread it down to
  the eligibility check.
- Where does the updater currently signal "update available"? Locate
  the existing call site (frontend or backend) and decide whether
  `notify_app_update_available` is invoked there directly or wrapped
  by a small backend listener on the updater plugin's events.

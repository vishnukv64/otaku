// Pair & sync between Otaku on the phone and on the Mac over the Praxis relay or LAN.
// Design: docs/plans/2026-11-07-pair-and-sync-design.md
mod engine;
mod frame;
mod hlc;
mod link;
mod net;
mod store;

pub use engine::Engine;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::State;

type E<'a> = State<'a, Arc<Engine>>;

#[tauri::command]
pub async fn sync_status(e: E<'_>) -> Result<Value, String> {
    Ok(e.status().await)
}

#[tauri::command]
pub async fn sync_start_pairing(e: E<'_>) -> Result<Value, String> {
    e.inner().start_pairing().await
}

#[tauri::command]
pub async fn sync_cancel_pairing(e: E<'_>) -> Result<(), String> {
    e.cancel_pairing();
    Ok(())
}

#[tauri::command]
pub async fn sync_approve_pair(e: E<'_>, approve: bool) -> Result<(), String> {
    e.inner().approve_pair(approve).await
}

/// Phone: parse a scanned otaku://pair payload, return the verification words.
#[tauri::command]
pub async fn sync_pair_scan(e: E<'_>, payload: String) -> Result<Value, String> {
    e.scan(&payload)
}

/// Phone: trade the 6-digit code (plus the Mac's LAN address shown beside it) for the pairing payload.
#[tauri::command]
pub async fn sync_pair_redeem(addr: String, code: String) -> Result<String, String> {
    let r = reqwest::Client::new()
        .post(format!("http://{}/sync/redeem", addr.trim()))
        .json(&json!({"code": code.trim()}))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|_| "unreachable".to_string())?;
    if !r.status().is_success() {
        return Err("expired".into());
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    v["payload"].as_str().map(String::from).ok_or_else(|| "expired".into())
}

#[tauri::command]
pub async fn sync_pair_connect(e: E<'_>, name: String) -> Result<(), String> {
    e.inner().connect_pairing(name).await
}

#[tauri::command]
pub async fn sync_unpair(e: E<'_>, device_id: String) -> Result<(), String> {
    e.unpair(&device_id).await
}

#[tauri::command]
pub async fn sync_set_toggles(e: E<'_>, device_id: String, progress: bool, library: bool, reading: bool) -> Result<(), String> {
    e.set_toggles(&device_id, progress, library, reading).await
}

#[tauri::command]
pub async fn sync_rename_device(e: E<'_>, name: String) -> Result<(), String> {
    engine::put(&e.pool, "sync.device_name", name.trim()).await;
    e.notify();
    Ok(())
}

/// Switch relay (self-hosted open relay = its wss:// URL, no sign-in needed); empty = LAN only.
#[tauri::command]
pub async fn sync_set_relay_url(e: E<'_>, url: String) -> Result<(), String> {
    engine::put(&e.pool, "sync.relay_url", url.trim()).await;
    e.notify();
    Ok(())
}

#[tauri::command]
pub async fn sync_relay_signin(app: tauri::AppHandle, e: E<'_>) -> Result<Value, String> {
    use tauri_plugin_shell::ShellExt;
    let relay = e.relay_url().await;
    let token = net::relay_signin(&relay, |url| {
        #[allow(deprecated)]
        let _ = app.shell().open(url, None);
    })
    .await?;
    engine::put(&e.pool, "sync.relay_token", &token).await;
    e.notify();
    Ok(e.status().await["relay"].clone())
}

#[tauri::command]
pub async fn sync_relay_signout(e: E<'_>) -> Result<(), String> {
    let token = e.relay_token().await;
    if !token.is_empty() {
        let _ = reqwest::Client::new()
            .post(format!("{}/logout", net::http_base(&e.relay_url().await)))
            .bearer_auth(&token)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;
    }
    engine::put(&e.pool, "sync.relay_token", "").await;
    e.notify();
    Ok(())
}

#[tauri::command]
pub async fn sync_stats(e: E<'_>) -> Result<Value, String> {
    Ok(e.stats().await)
}

#[tauri::command]
pub async fn sync_mark_conflicts_seen(e: E<'_>) -> Result<(), String> {
    engine::put(&e.pool, "sync.conflicts_seen", &engine::now_ms().to_string()).await;
    e.notify();
    Ok(())
}

/// presence | handoff | remote → every connected peer. Returns how many connections got it.
#[tauri::command]
pub async fn sync_send(e: E<'_>, kind: String, data: Value) -> Result<usize, String> {
    if !["presence", "handoff", "remote"].contains(&kind.as_str()) {
        return Err(format!("unsupported frame kind {kind}"));
    }
    Ok(e.broadcast(&kind, data))
}

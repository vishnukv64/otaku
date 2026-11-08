// Sync engine: pairing, sessions over relay/LAN, push/ack of the change log.
// Mac = Host (dials relay as host, accepts LAN), phone = Guest.
use super::frame::{self, Frame};
use super::hlc::Hlc;
use super::link::{self, Link, QrPayload};
use super::net::{self, Chan};
use super::store::{self, Change, Toggles};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine as _};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::UnboundedSender;

pub const SCHEMA: i64 = 1;
const PAIR_TTL_MS: i64 = 120_000;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Role {
    Host,
    Guest,
}

#[derive(PartialEq, Debug)]
pub enum Outcome {
    Closed,
    Unpaired,
    Paired,
    Rejected(String),
}

#[derive(sqlx::FromRow, Clone, Debug)]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub role: String,
    pub room_id: String,
    pub room_key: String,
    pub write_token: String,
    pub relay_url: String,
    pub relay_token: String,
    pub lan_addr: String,
    pub sync_progress: i64,
    pub sync_library: i64,
    pub sync_reading: i64,
    pub acked_seq: i64,
    pub items_in: i64,
    pub items_out: i64,
    pub last_synced: Option<String>,
    pub paired_at: String,
}

impl Peer {
    pub fn toggles(&self) -> Toggles {
        Toggles { progress: self.sync_progress != 0, library: self.sync_library != 0, reading: self.sync_reading != 0 }
    }

    fn link(&self) -> Option<Link> {
        let key: [u8; 32] = B64.decode(&self.room_key).ok()?.try_into().ok()?;
        let write = B64.decode(&self.write_token).ok().and_then(|w| w.try_into().ok());
        Some(Link { relay: self.relay_url.clone(), room: self.room_id.clone(), key, write })
    }
}

struct Awaiting {
    id: String,
    name: String,
    platform: String,
}

struct Pending {
    link: Link,
    code: String,
    expires: i64,
    attempts: u32,
    awaiting: Option<Awaiting>,
}

struct Conn {
    room: String,
    tx: UnboundedSender<String>,
    key: [u8; 32],
    sent: i64,
}

pub struct Engine {
    pub app: AppHandle,
    pub pool: SqlitePool,
    hlc: Hlc,
    pub dev_id: String,
    pub lan_port: AtomicU64,
    seq: AtomicI64,
    next_conn: AtomicU64,
    pending: Mutex<Option<Pending>>,
    scanned: Mutex<Option<QrPayload>>,
    conns: Mutex<HashMap<u64, Conn>>,
    loops: Mutex<HashMap<String, tokio::task::AbortHandle>>,
    pub error: Mutex<Option<String>>,
    presence: Mutex<HashMap<String, Value>>,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}

impl Engine {
    pub async fn start(app: AppHandle, pool: SqlitePool) -> Result<Arc<Engine>, String> {
        store::init(&pool).await.map_err(|e| e.to_string())?;
        let dev_id = match get(&pool, "sync.device_id").await {
            Some(i) => i,
            None => {
                let i = uuid::Uuid::new_v4().to_string();
                put(&pool, "sync.device_id", &i).await;
                i
            }
        };
        match store::backfill(&pool, &dev_id).await {
            Ok(n) if n > 0 => log::info!("sync: logged {n} existing rows for paired devices"),
            Ok(_) => {}
            Err(e) => log::warn!("sync backfill: {e}"),
        }
        let seed = store::max_hlc(&pool).await;
        let e = Arc::new(Engine {
            app,
            pool,
            hlc: Hlc::new(seed),
            dev_id,
            lan_port: AtomicU64::new(0),
            seq: AtomicI64::new(0),
            next_conn: AtomicU64::new(1),
            pending: Mutex::new(None),
            scanned: Mutex::new(None),
            conns: Mutex::new(HashMap::new()),
            loops: Mutex::new(HashMap::new()),
            error: Mutex::new(None),
            presence: Mutex::new(HashMap::new()),
        });
        for p in e.peers().await {
            e.spawn_maintain(&p.room_id, if p.role == "phone" { Role::Host } else { Role::Guest });
        }
        let t = e.clone();
        tokio::spawn(async move {
            loop {
                let _ = store::stamp(&t.pool, &t.hlc, &t.dev_id).await;
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        });
        #[cfg(desktop)]
        e.clone().serve_lan();
        Ok(e)
    }

    pub fn notify(&self) {
        let _ = self.app.emit("sync://status", json!({}));
    }

    fn emit(&self, ev: &str, v: Value) {
        let _ = self.app.emit(ev, v);
    }

    fn next_seq(&self) -> i64 {
        let now = chrono::Utc::now().timestamp_micros();
        self.seq.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |p| Some(now.max(p + 1))).map(|p| now.max(p + 1)).unwrap()
    }

    fn send(&self, tx: &UnboundedSender<String>, key: &[u8; 32], kind: &str, data: Value) {
        let f = Frame { kind: kind.into(), data, seq: self.next_seq(), dev: self.dev_id.clone() };
        if let Ok(w) = frame::encode(key, &f) {
            let _ = tx.send(w);
        }
    }

    pub async fn device_name(&self) -> String {
        get(&self.pool, "sync.device_name").await.unwrap_or_else(|| if cfg!(desktop) { "My Mac".into() } else { "My phone".into() })
    }

    pub async fn relay_url(&self) -> String {
        get(&self.pool, "sync.relay_url").await.unwrap_or_else(|| link::DEFAULT_RELAY.into())
    }

    pub async fn relay_token(&self) -> String {
        get(&self.pool, "sync.relay_token").await.unwrap_or_default()
    }

    pub async fn peers(&self) -> Vec<Peer> {
        sqlx::query_as("SELECT * FROM paired_devices ORDER BY paired_at").fetch_all(&self.pool).await.unwrap_or_default()
    }

    async fn peer_by_room(&self, room: &str) -> Option<Peer> {
        sqlx::query_as("SELECT * FROM paired_devices WHERE room_id=?").bind(room).fetch_optional(&self.pool).await.ok().flatten()
    }

    // ---------- Mac: pairing ----------

    pub async fn start_pairing(self: &Arc<Self>) -> Result<Value, String> {
        self.cancel_pairing();
        let relay = self.relay_url().await;
        let token = self.relay_token().await;
        let lan = net::lan_ip().map(|ip| format!("{ip}:{}", self.lan_port.load(Ordering::Relaxed))).unwrap_or_default();
        let link = Link::generate(&relay, true);
        let code = format!("{:06}", rand::random::<u32>() % 1_000_000);
        let expires = now_ms() + PAIR_TTL_MS;
        let qr = link::qr_payload(&link, &lan, &self.device_name().await, &token);
        let words = link::verify_words(&link.key);
        let room = link.room.clone();
        *self.pending.lock().unwrap() = Some(Pending { link, code: code.clone(), expires, attempts: 0, awaiting: None });
        if !relay.is_empty() {
            self.spawn_maintain(&room, Role::Host);
        }
        let e = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(PAIR_TTL_MS as u64 + 500)).await;
            let expired = e.pending.lock().unwrap().as_ref().map(|p| p.link.room == room && p.awaiting.is_none()).unwrap_or(false);
            if expired {
                e.cancel_pairing();
                e.emit("sync://pair-expired", json!({}));
            }
        });
        Ok(json!({"qr": qr, "code": code, "expiresAt": expires, "lan": lan, "words": words, "relayUrl": relay, "signedIn": !token.is_empty()}))
    }

    pub fn cancel_pairing(&self) {
        if let Some(p) = self.pending.lock().unwrap().take() {
            if let Some(h) = self.loops.lock().unwrap().remove(&p.link.room) {
                h.abort();
            }
        }
    }

    pub async fn approve_pair(self: &Arc<Self>, approve: bool) -> Result<(), String> {
        let p = self.pending.lock().unwrap().take().ok_or("no pairing in progress")?;
        let a = p.awaiting.ok_or("no phone is waiting")?;
        let conns: Vec<(UnboundedSender<String>, [u8; 32])> =
            self.conns.lock().unwrap().values().filter(|c| c.room == p.link.room).map(|c| (c.tx.clone(), c.key)).collect();
        if !approve {
            for (tx, k) in &conns {
                self.send(tx, k, "pair-no", json!({"reason": "rejected"}));
            }
            self.emit("sync://pair-state", json!({"state": "rejected"}));
            return Ok(());
        }
        sqlx::query(
            "INSERT OR REPLACE INTO paired_devices(id,name,platform,role,room_id,room_key,write_token,relay_url) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(&a.id)
        .bind(&a.name)
        .bind(&a.platform)
        .bind("phone")
        .bind(&p.link.room)
        .bind(B64.encode(p.link.key))
        .bind(p.link.write_b64())
        .bind(&p.link.relay)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        let me = json!({"id": self.dev_id, "name": self.device_name().await, "platform": std::env::consts::OS});
        for (tx, k) in &conns {
            self.send(tx, k, "pair-ok", me.clone());
        }
        self.emit("sync://pair-state", json!({"state": "paired", "name": a.name}));
        self.notify();
        Ok(())
    }

    /// LAN code redemption: returns the QR payload once, if the code matches.
    pub async fn redeem(&self, code: &str) -> Option<String> {
        let (link, expires) = {
            let mut g = self.pending.lock().unwrap();
            let p = g.as_mut()?;
            if now_ms() > p.expires {
                return None;
            }
            if p.code != code {
                p.attempts += 1;
                if p.attempts >= 5 {
                    p.expires = 0; // lock out brute force
                }
                return None;
            }
            p.expires = p.expires.min(now_ms() + 30_000);
            (p.link.clone(), p.expires)
        };
        let _ = expires;
        let lan = net::lan_ip().map(|ip| format!("{ip}:{}", self.lan_port.load(Ordering::Relaxed))).unwrap_or_default();
        Some(link::qr_payload(&link, &lan, &self.device_name().await, &self.relay_token().await))
    }

    // ---------- Phone: pairing ----------

    pub fn scan(&self, payload: &str) -> Result<Value, String> {
        let qr = link::parse_qr(payload)?;
        let v = json!({"words": link::verify_words(&qr.link.key), "macName": qr.name, "lan": qr.lan, "relay": qr.link.relay});
        *self.scanned.lock().unwrap() = Some(qr);
        Ok(v)
    }

    pub async fn connect_pairing(self: &Arc<Self>, name: String) -> Result<(), String> {
        let qr = self.scanned.lock().unwrap().take().ok_or("scan a pairing code first")?;
        put(&self.pool, "sync.device_name", &name).await;
        let e = self.clone();
        tokio::spawn(async move {
            let wt = qr.link.write_b64();
            e.emit("sync://pair-state", json!({"state": "connecting", "via": "lan"}));
            let mut chan = None;
            if !qr.lan.is_empty() {
                chan = net::dial_lan(&qr.lan, &qr.link.room, &wt)
                    .await
                    .map_err(|err| log::warn!("pairing: LAN {} failed: {err}", qr.lan))
                    .ok();
            }
            if chan.is_none() {
                e.emit("sync://pair-state", json!({"state": "connecting", "via": "relay"}));
                let token = if qr.token.is_empty() { e.relay_token().await } else { qr.token.clone() };
                match net::dial_relay(&qr.link, "guest", &token).await {
                    Ok(c) => chan = Some(c),
                    Err(err) => {
                        log::warn!("pairing: relay failed: {err}");
                        e.emit("sync://pair-state", json!({"state": "error", "code": err.code(), "detail": err.to_string()}));
                        return;
                    }
                }
            }
            e.emit("sync://pair-state", json!({"state": "waiting"}));
            let link = qr.link.clone();
            let run = e.session(&link, Role::Guest, chan.unwrap(), Some(qr));
            match tokio::time::timeout(Duration::from_secs(PAIR_TTL_MS as u64 + 60_000), run).await {
                Ok(Outcome::Paired) => {}
                Ok(Outcome::Rejected(r)) => e.emit("sync://pair-state", json!({"state": "error", "code": r})),
                _ => e.emit("sync://pair-state", json!({"state": "error", "code": "relay_unreachable"})),
            }
        });
        Ok(())
    }

    // ---------- shared ----------

    pub async fn unpair(&self, id: &str) -> Result<(), String> {
        let p: Peer = sqlx::query_as("SELECT * FROM paired_devices WHERE id=?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("unknown device")?;
        for c in self.conns.lock().unwrap().values().filter(|c| c.room == p.room_id) {
            self.send(&c.tx, &c.key, "bye", json!({"id": self.dev_id}));
        }
        tokio::time::sleep(Duration::from_millis(250)).await; // let bye flush before the loop is aborted
        self.drop_peer(&p.room_id).await;
        Ok(())
    }

    async fn drop_peer(&self, room: &str) {
        let _ = sqlx::query("DELETE FROM paired_devices WHERE room_id=?").bind(room).execute(&self.pool).await;
        if let Some(h) = self.loops.lock().unwrap().remove(room) {
            h.abort();
        }
        self.conns.lock().unwrap().retain(|_, c| c.room != room);
        self.notify();
    }

    pub fn spawn_maintain(self: &Arc<Self>, room: &str, role: Role) {
        let e = self.clone();
        let r = room.to_string();
        let h = tokio::spawn(async move { e.maintain(r, role).await }).abort_handle();
        if let Some(old) = self.loops.lock().unwrap().insert(room.to_string(), h) {
            old.abort();
        }
    }

    /// (link, relay token, lan addr) for a room we are hosting or guesting.
    async fn room_ctx(&self, room: &str, role: Role) -> Option<(Link, String, String)> {
        if let Some(p) = self.peer_by_room(room).await {
            let tok = if role == Role::Guest && !p.relay_token.is_empty() { p.relay_token.clone() } else { self.relay_token().await };
            return Some((p.link()?, tok, p.lan_addr));
        }
        let l = self.pending.lock().unwrap().as_ref().filter(|p| p.link.room == room).map(|p| p.link.clone())?;
        Some((l, self.relay_token().await, String::new()))
    }

    /// Dial, run a session, redial with backoff until the room is gone.
    async fn maintain(self: Arc<Self>, room: String, role: Role) {
        let mut backoff = 1u64;
        loop {
            let Some((link, token, lan)) = self.room_ctx(&room, role).await else { return };
            let wt = link.write_b64();
            let mut chan = None;
            if role == Role::Guest && !lan.is_empty() {
                chan = net::dial_lan(&lan, &room, &wt).await.map_err(|err| log::debug!("sync: LAN {lan} failed: {err}")).ok();
            }
            let dial = match chan {
                Some(c) => Ok(c),
                None => net::dial_relay(&link, if role == Role::Host { "host" } else { "guest" }, &token).await,
            };
            match dial {
                Ok(c) => {
                    backoff = 1;
                    *self.error.lock().unwrap() = None;
                    match self.session(&link, role, c, None).await {
                        Outcome::Unpaired => return,
                        _ => {}
                    }
                }
                Err(err) => {
                    log::warn!("sync: relay dial failed: {err}");
                    *self.error.lock().unwrap() = Some(err.code().to_string());
                    self.notify();
                }
            }
            if self.room_ctx(&room, role).await.is_none() {
                return;
            }
            tokio::time::sleep(Duration::from_secs(backoff)).await;
            backoff = (backoff * 2).min(30);
        }
    }

    async fn session(self: &Arc<Self>, link: &Link, role: Role, mut chan: Chan, pairing: Option<QrPayload>) -> Outcome {
        let id = self.next_conn.fetch_add(1, Ordering::SeqCst);
        self.conns.lock().unwrap().insert(id, Conn { room: link.room.clone(), tx: chan.tx.clone(), key: link.key, sent: 0 });
        self.notify();
        if role == Role::Guest {
            let hello = self.hello(link).await;
            self.send(&chan.tx, &link.key, "hello", hello);
        }
        let mut last: HashMap<String, i64> = HashMap::new();
        let mut tick = tokio::time::interval(Duration::from_secs(2));
        let mut n = 0u32;
        let out = loop {
            tokio::select! {
                m = chan.rx.recv() => {
                    let Some(w) = m else { break Outcome::Closed };
                    if let Some(o) = self.on_wire(&w, link, role, id, &mut last, pairing.as_ref()).await { break o }
                }
                _ = tick.tick() => {
                    n += 1;
                    if n % 12 == 0 { self.send(&chan.tx, &link.key, "ping", json!({"id": self.dev_id})); }
                    self.push(id).await;
                }
            }
        };
        self.conns.lock().unwrap().remove(&id);
        self.notify();
        out
    }

    async fn hello(&self, link: &Link) -> Value {
        json!({"id": self.dev_id, "name": self.device_name().await, "platform": std::env::consts::OS,
               "schema": SCHEMA, "ver": env!("CARGO_PKG_VERSION"), "writeToken": link.write_b64()})
    }

    async fn on_wire(
        self: &Arc<Self>,
        wire: &str,
        link: &Link,
        role: Role,
        conn: u64,
        last: &mut HashMap<String, i64>,
        pairing: Option<&QrPayload>,
    ) -> Option<Outcome> {
        if serde_json::from_str::<Value>(wire).map(|v| v.get("relay").is_some()).unwrap_or(false) {
            return None; // relay control frame
        }
        let f = frame::decode(&link.key, wire).ok()?;
        if f.seq > 0 {
            let prev = last.entry(f.dev.clone()).or_insert(0);
            if f.seq <= *prev {
                return None; // replay
            }
            *prev = f.seq;
        }
        let tx = self.conns.lock().unwrap().get(&conn).map(|c| c.tx.clone())?;
        let d = &f.data;
        match (f.kind.as_str(), role) {
            ("hello", Role::Host) => return self.host_hello(link, d, conn, &tx).await,
            ("hello", Role::Guest) => self.start_sync(conn).await,
            ("pair-ok", Role::Guest) => {
                let qr = pairing?;
                let res = sqlx::query(
                    "INSERT OR REPLACE INTO paired_devices(id,name,platform,role,room_id,room_key,write_token,relay_url,relay_token,lan_addr) VALUES(?,?,?,?,?,?,?,?,?,?)",
                )
                .bind(s(d, "id"))
                .bind(s(d, "name"))
                .bind(s(d, "platform"))
                .bind("mac")
                .bind(&link.room)
                .bind(B64.encode(link.key))
                .bind(link.write_b64())
                .bind(&link.relay)
                .bind(&qr.token)
                .bind(&qr.lan)
                .execute(&self.pool)
                .await;
                if res.is_err() {
                    return Some(Outcome::Rejected("rejected".into()));
                }
                self.emit("sync://pair-state", json!({"state": "paired", "name": s(d, "name")}));
                self.spawn_maintain(&link.room, Role::Guest);
                self.notify();
                return Some(Outcome::Paired);
            }
            ("pair-no", Role::Guest) => {
                let r = s(d, "reason");
                if pairing.is_some() {
                    return Some(Outcome::Rejected(if r.is_empty() { "rejected" } else { r }.into()));
                }
                if r == "unauthorized" || r == "unknown" {
                    self.drop_peer(&link.room).await;
                    self.emit("sync://unpaired", json!({}));
                    return Some(Outcome::Unpaired);
                }
                *self.error.lock().unwrap() = Some(r.to_string());
                return Some(Outcome::Closed);
            }
            ("bye", _) => {
                self.drop_peer(&link.room).await;
                self.emit("sync://unpaired", json!({}));
                return Some(Outcome::Unpaired);
            }
            ("ping", _) => {}
            (kind, _) => {
                let peer = self.peer_by_room(&link.room).await?; // everything below needs a paired peer
                self.on_paired_frame(kind, d, &peer, conn, &tx, link).await;
            }
        }
        None
    }

    async fn host_hello(&self, link: &Link, d: &Value, conn: u64, tx: &UnboundedSender<String>) -> Option<Outcome> {
        let no = |r: &str| {
            self.send(tx, &link.key, "pair-no", json!({"reason": r}));
            Some(Outcome::Closed)
        };
        if s(d, "writeToken") != link.write_b64() {
            return no("unauthorized");
        }
        if d["schema"].as_i64().unwrap_or(0) != SCHEMA {
            return no("version");
        }
        if let Some(p) = self.peer_by_room(&link.room).await {
            if p.id != s(d, "id") {
                return no("unauthorized");
            }
            let _ = sqlx::query("UPDATE paired_devices SET name=?,platform=? WHERE id=?").bind(s(d, "name")).bind(s(d, "platform")).bind(&p.id).execute(&self.pool).await;
            let h = self.hello(link).await;
            self.send(tx, &link.key, "hello", h);
            self.start_sync(conn).await;
            return None;
        }
        let verdict = {
            let mut g = self.pending.lock().unwrap();
            match g.as_mut() {
                Some(p) if p.link.room == link.room && now_ms() <= p.expires + 30_000 => {
                    p.awaiting = Some(Awaiting { id: s(d, "id").into(), name: s(d, "name").into(), platform: s(d, "platform").into() });
                    Ok(())
                }
                Some(p) if p.link.room == link.room => Err("expired"),
                _ => Err("unknown"),
            }
        };
        match verdict {
            Ok(()) => {
                self.emit(
                    "sync://pair-request",
                    json!({"name": s(d, "name"), "platform": s(d, "platform"), "words": link::verify_words(&link.key)}),
                );
                None
            }
            Err(r) => no(r),
        }
    }

    async fn on_paired_frame(&self, kind: &str, d: &Value, peer: &Peer, conn: u64, tx: &UnboundedSender<String>, link: &Link) {
        match kind {
            "sync-push" => {
                let changes: Vec<Change> = serde_json::from_value(d["changes"].clone()).unwrap_or_default();
                let _ = store::stamp(&self.pool, &self.hlc, &self.dev_id).await;
                match store::apply(&self.pool, &self.hlc, &changes, peer.toggles()).await {
                    Ok((n, conflicts)) => {
                        let _ = sqlx::query("UPDATE paired_devices SET items_in=items_in+?, last_synced=CURRENT_TIMESTAMP WHERE id=?")
                            .bind(n as i64)
                            .bind(&peer.id)
                            .execute(&self.pool)
                            .await;
                        self.send(tx, &link.key, "sync-ack", json!({"seq": d["upto"], "n": changes.len()}));
                        self.emit("sync://applied", json!({"count": n, "conflicts": conflicts, "from": peer.name}));
                        self.notify();
                    }
                    Err(e) => *self.error.lock().unwrap() = Some(format!("apply: {e}")),
                }
            }
            "sync-ack" => {
                let _ = sqlx::query("UPDATE paired_devices SET acked_seq=MAX(acked_seq,?), items_out=items_out+?, last_synced=CURRENT_TIMESTAMP WHERE id=?")
                    .bind(d["seq"].as_i64().unwrap_or(0))
                    .bind(d["n"].as_i64().unwrap_or(0))
                    .bind(&peer.id)
                    .execute(&self.pool)
                    .await;
                self.notify();
            }
            "stats" => {
                for day in d["days"].as_array().into_iter().flatten() {
                    let _ = sqlx::query("INSERT OR REPLACE INTO sync_peer_stats(device_id,day,watch_seconds,chapters) VALUES(?,?,?,?)")
                        .bind(&peer.id)
                        .bind(s(day, "day"))
                        .bind(day["watch"].as_f64().unwrap_or(0.0))
                        .bind(day["chapters"].as_i64().unwrap_or(0))
                        .execute(&self.pool)
                        .await;
                }
                self.notify();
            }
            "presence" => {
                self.presence.lock().unwrap().insert(peer.id.clone(), d.clone());
                self.emit("sync://presence", json!({"from": peer.name, "fromId": peer.id, "data": d}));
            }
            "handoff" => self.emit("sync://handoff", json!({"from": peer.name, "fromId": peer.id, "data": d})),
            "remote" => self.emit("sync://remote", d.clone()),
            _ => {}
        }
        let _ = conn;
    }

    async fn start_sync(&self, conn: u64) {
        let (room, tx, key) = match self.conns.lock().unwrap().get_mut(&conn) {
            Some(c) => {
                c.sent = 0;
                (c.room.clone(), c.tx.clone(), c.key)
            }
            None => return,
        };
        let days = serde_json::to_value(store::local_stats(&self.pool).await).unwrap_or(Value::Null);
        self.send(&tx, &key, "stats", json!({"days": days}));
        let _ = room;
        self.push(conn).await;
    }

    async fn push(&self, conn: u64) {
        let (room, tx, key, mut after) = match self.conns.lock().unwrap().get(&conn) {
            Some(c) => (c.room.clone(), c.tx.clone(), c.key, c.sent),
            None => return,
        };
        let Some(peer) = self.peer_by_room(&room).await else { return };
        after = after.max(peer.acked_seq);
        loop {
            let chunk = match store::pending(&self.pool, &peer.id, after, 200, peer.toggles()).await {
                Ok(c) if !c.is_empty() => c,
                _ => break,
            };
            after = chunk.last().map(|c| c.seq).unwrap_or(after);
            self.send(&tx, &key, "sync-push", json!({"changes": chunk, "upto": after}));
            if let Some(c) = self.conns.lock().unwrap().get_mut(&conn) {
                c.sent = after;
            }
        }
    }

    /// Broadcast presence/handoff/remote to every connected peer.
    pub fn broadcast(&self, kind: &str, data: Value) -> usize {
        let conns = self.conns.lock().unwrap();
        for c in conns.values() {
            self.send(&c.tx, &c.key, kind, data.clone());
        }
        conns.len()
    }

    // ---------- status ----------

    pub async fn status(&self) -> Value {
        let _ = store::stamp(&self.pool, &self.hlc, &self.dev_id).await;
        let connected: Vec<String> = self.conns.lock().unwrap().values().map(|c| c.room.clone()).collect();
        let presence = self.presence.lock().unwrap().clone();
        let mut devices = vec![];
        let mut queued = 0;
        for p in self.peers().await {
            let q = store::queued(&self.pool, &p.id, p.acked_seq, p.toggles()).await;
            queued = queued.max(q);
            devices.push(json!({
                "id": p.id, "name": p.name, "platform": p.platform, "role": p.role,
                "connected": connected.contains(&p.room_id), "queued": q,
                "lastSynced": p.last_synced, "pairedAt": p.paired_at, "itemsIn": p.items_in, "itemsOut": p.items_out,
                "progress": p.sync_progress != 0, "library": p.sync_library != 0, "reading": p.sync_reading != 0,
                "lan": p.lan_addr, "presence": presence.get(&p.id),
            }));
        }
        let any_conn = devices.iter().any(|d| d["connected"] == true);
        let error = self.error.lock().unwrap().clone();
        let state = if devices.is_empty() {
            "idle"
        } else if error.is_some() && !any_conn {
            "error"
        } else if !any_conn {
            "offline"
        } else if queued > 0 {
            "syncing"
        } else {
            "synced"
        };
        let seen: i64 = get(&self.pool, "sync.conflicts_seen").await.and_then(|v| v.parse().ok()).unwrap_or(0);
        let conflicts: Vec<(String, i64)> = sqlx::query_as(
            "SELECT COALESCE(winner_device,''), COUNT(*) FROM sync_conflicts WHERE created_at>? GROUP BY winner_device",
        )
        .bind(seen)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();
        let names: HashMap<String, String> = devices.iter().map(|d| (d["id"].as_str().unwrap_or("").into(), d["name"].as_str().unwrap_or("").into())).collect();
        let token = self.relay_token().await;
        let claims = net::token_claims(&token);
        json!({
            "deviceId": self.dev_id, "deviceName": self.device_name().await, "state": state, "queued": queued, "error": error,
            "devices": devices,
            "conflicts": {"unseen": conflicts.iter().map(|c| c.1).sum::<i64>(),
                          "byDevice": conflicts.iter().map(|(d, n)| json!({"device": names.get(d).cloned().unwrap_or_else(|| d.clone()), "count": n})).collect::<Vec<_>>()},
            "relay": {"url": self.relay_url().await, "signedIn": !token.is_empty(), "email": claims.as_ref().map(|c| c.0.clone()), "expiresAt": claims.map(|c| c.1)},
            "lan": net::lan_ip().map(|ip| format!("{ip}:{}", self.lan_port.load(Ordering::Relaxed))),
        })
    }

    pub async fn stats(&self) -> Value {
        let mut out = vec![json!({"id": self.dev_id, "name": self.device_name().await, "self": true,
                                  "days": serde_json::to_value(store::local_stats(&self.pool).await).unwrap_or(Value::Null)})];
        for p in self.peers().await {
            let rows: Vec<(String, f64, i64)> = sqlx::query_as("SELECT day,watch_seconds,chapters FROM sync_peer_stats WHERE device_id=? ORDER BY day")
                .bind(&p.id)
                .fetch_all(&self.pool)
                .await
                .unwrap_or_default();
            out.push(json!({"id": p.id, "name": p.name, "self": false,
                            "days": rows.into_iter().map(|(d, w, c)| json!({"day": d, "watch": w, "chapters": c})).collect::<Vec<_>>()}));
        }
        json!({"devices": out})
    }

    pub async fn set_toggles(&self, id: &str, progress: bool, library: bool, reading: bool) -> Result<(), String> {
        // acked_seq resets so a type switched back on resends what it skipped (apply is idempotent)
        sqlx::query("UPDATE paired_devices SET sync_progress=?,sync_library=?,sync_reading=?,acked_seq=0 WHERE id=?")
            .bind(progress)
            .bind(library)
            .bind(reading)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        self.notify();
        Ok(())
    }

    // ---------- LAN ----------

    async fn lan_link(&self, room: &str, wt: &str) -> Option<Link> {
        let l = if let Some(p) = self.peer_by_room(room).await {
            p.link()?
        } else {
            self.pending.lock().unwrap().as_ref().filter(|p| p.link.room == room && now_ms() <= p.expires + 30_000).map(|p| p.link.clone())?
        };
        (l.write_b64() == wt).then_some(l)
    }

    #[cfg(desktop)]
    fn serve_lan(self: Arc<Self>) {
        use axum::{
            extract::{ws::WebSocketUpgrade, Path, Query, State},
            http::StatusCode,
            response::IntoResponse,
            routing::{get, post},
            Json, Router,
        };
        async fn ws(
            State(e): State<Arc<Engine>>,
            Path(room): Path<String>,
            Query(q): Query<HashMap<String, String>>,
            up: WebSocketUpgrade,
        ) -> axum::response::Response {
            match e.lan_link(&room, q.get("wt").map(String::as_str).unwrap_or("")).await {
                Some(link) => up
                    .on_upgrade(move |sock| async move {
                        e.session(&link, Role::Host, net::axum_chan(sock), None).await;
                    })
                    .into_response(),
                None => StatusCode::FORBIDDEN.into_response(),
            }
        }
        async fn redeem(State(e): State<Arc<Engine>>, Json(b): Json<Value>) -> axum::response::Response {
            match e.redeem(s(&b, "code")).await {
                Some(p) => Json(json!({"payload": p})).into_response(),
                None => StatusCode::FORBIDDEN.into_response(),
            }
        }
        tokio::spawn(async move {
            let app = Router::new().route("/sync/:room", get(ws)).route("/sync/redeem", post(redeem)).with_state(self.clone());
            // Fixed port so the address a phone saved at pairing still works after the
            // Mac app restarts (a random port changed every launch); random if taken.
            let ln = match tokio::net::TcpListener::bind(("0.0.0.0", LAN_PORT)).await {
                Ok(l) => l,
                Err(_) => match tokio::net::TcpListener::bind("0.0.0.0:0").await {
                    Ok(l) => l,
                    Err(e) => return log::error!("sync LAN listener: {e}"),
                },
            };
            log::info!("sync LAN listener on {:?}", ln.local_addr());
            self.lan_port.store(ln.local_addr().map(|a| a.port() as u64).unwrap_or(0), Ordering::Relaxed);
            if let Err(e) = axum::serve(ln, app).await {
                log::error!("sync LAN server: {e}");
            }
        });
    }
}

/// Mac's LAN sync port (phones dial `<mac ip>:LAN_PORT`).
const LAN_PORT: u16 = 47913;

pub async fn get(pool: &SqlitePool, k: &str) -> Option<String> {
    sqlx::query_scalar("SELECT value FROM app_settings WHERE key=?").bind(k).fetch_optional(pool).await.ok().flatten()
}

pub async fn put(pool: &SqlitePool, k: &str, v: &str) {
    let _ = sqlx::query(
        "INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    )
    .bind(k)
    .bind(v)
    .bind(now_ms())
    .execute(pool)
    .await;
}

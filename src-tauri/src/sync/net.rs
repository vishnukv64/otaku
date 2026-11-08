// Transports (relay WebSocket client, LAN WebSocket) and relay sign-in.
// Every transport reduces to a Chan of sealed wire strings.
use super::link::Link;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue, Message};

pub struct Chan {
    pub tx: UnboundedSender<String>,
    pub rx: UnboundedReceiver<String>,
}

#[derive(Debug)]
pub enum DialError {
    Unreachable(String),
    Refused(String),
}

impl DialError {
    /// Stable code for the UI.
    pub fn code(&self) -> &'static str {
        match self {
            DialError::Unreachable(_) => "relay_unreachable",
            DialError::Refused(r) => {
                let r = r.to_lowercase();
                if ["token", "account", "auth", "domain", "sign", "forbidden", "banned"].iter().any(|w| r.contains(w)) {
                    "wrong_account"
                } else {
                    "relay_unreachable"
                }
            }
        }
    }
}

impl std::fmt::Display for DialError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DialError::Unreachable(e) => write!(f, "unreachable: {e}"),
            DialError::Refused(e) => write!(f, "refused: {e}"),
        }
    }
}

fn pump<S, E: Send + 'static>(ws: S, first: Option<String>) -> Chan
where
    S: futures_util::Stream<Item = Result<Message, E>> + futures_util::Sink<Message> + Send + Unpin + 'static,
    <S as futures_util::Sink<Message>>::Error: Send,
{
    let (out_tx, mut out_rx) = unbounded_channel::<String>();
    let (in_tx, in_rx) = unbounded_channel::<String>();
    if let Some(f) = first {
        let _ = in_tx.send(f);
    }
    let (mut sink, mut stream) = ws.split();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                o = out_rx.recv() => match o {
                    Some(t) => if sink.send(Message::Text(t)).await.is_err() { break },
                    None => { let _ = sink.close().await; break }
                },
                m = stream.next() => match m {
                    Some(Ok(Message::Text(t))) => if in_tx.send(t).is_err() { break },
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                },
            }
        }
    });
    Chan { tx: out_tx, rx: in_rx }
}

/// Relay dial: Bearer token, wait for {"relay":"admitted"} (mirrors collab/relay.go).
pub async fn dial_relay(link: &Link, role: &str, token: &str) -> Result<Chan, DialError> {
    let mut req = format!("{}?role={role}", link.ws_url()).into_client_request().map_err(|e| DialError::Unreachable(e.to_string()))?;
    if !token.is_empty() {
        if let Ok(v) = HeaderValue::from_str(&format!("Bearer {token}")) {
            req.headers_mut().insert("Authorization", v);
        }
    }
    req.headers_mut().insert("X-Praxis-Purpose", HeaderValue::from_static("otaku-sync"));
    // The relay serves rooms with Go's x/net/websocket Handler, which answers 403 to a
    // handshake without a parseable Origin (non-browser clients send none). Same value
    // as the Praxis Go client.
    req.headers_mut().insert("Origin", HeaderValue::from_static("https://omp.sh/"));
    let (mut ws, _) = tokio::time::timeout(Duration::from_secs(10), tokio_tungstenite::connect_async(req))
        .await
        .map_err(|_| DialError::Unreachable("timeout".into()))?
        .map_err(|e| DialError::Unreachable(e.to_string()))?;
    let first = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(t))) => return Ok(t),
                Some(Ok(_)) => continue,
                _ => return Err(DialError::Refused("relay closed before admitting connection".into())),
            }
        }
    })
    .await
    .map_err(|_| DialError::Unreachable("no admission ack".into()))??;
    match serde_json::from_str::<Value>(&first).ok().and_then(|v| v.get("relay").and_then(|r| r.as_str().map(String::from))) {
        Some(c) if c == "admitted" => Ok(pump(ws, None)),
        Some(c) if c == "refused" => {
            let reason = serde_json::from_str::<Value>(&first).ok().and_then(|v| v["reason"].as_str().map(String::from)).unwrap_or_default();
            Err(DialError::Refused(reason))
        }
        Some(c) => Err(DialError::Unreachable(format!("unexpected relay control {c}"))),
        // relay that predates the ack: a sealed frame proves admission
        None => Ok(pump(ws, Some(first))),
    }
}

pub async fn dial_lan(addr: &str, room: &str, write_token: &str) -> Result<Chan, DialError> {
    let url = format!("ws://{addr}/sync/{}?wt={}", urlencoding::encode(room), urlencoding::encode(write_token));
    let (ws, _) = tokio::time::timeout(Duration::from_secs(3), tokio_tungstenite::connect_async(url))
        .await
        .map_err(|_| DialError::Unreachable("lan timeout".into()))?
        .map_err(|e| DialError::Unreachable(e.to_string()))?;
    Ok(pump(ws, None))
}

/// Adapt an axum WebSocket (LAN route) to a Chan.
pub fn axum_chan(ws: axum::extract::ws::WebSocket) -> Chan {
    use axum::extract::ws::Message as M;
    let (out_tx, mut out_rx) = unbounded_channel::<String>();
    let (in_tx, in_rx) = unbounded_channel::<String>();
    let (mut sink, mut stream) = ws.split();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                o = out_rx.recv() => match o {
                    Some(t) => if sink.send(M::Text(t)).await.is_err() { break },
                    None => { let _ = sink.close().await; break }
                },
                m = stream.next() => match m {
                    Some(Ok(M::Text(t))) => if in_tx.send(t).is_err() { break },
                    Some(Ok(M::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                },
            }
        }
    });
    Chan { tx: out_tx, rx: in_rx }
}

/// Best LAN address to advertise: the interface the OS would route to the internet
/// (UDP connect sends no packet).
pub fn lan_ip() -> Option<String> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

pub fn http_base(relay_ws: &str) -> String {
    relay_ws.replacen("wss://", "https://", 1).replacen("ws://", "http://", 1).trim_end_matches('/').to_string()
}

/// (email, expiry unix seconds) from a relay token `prxr1.<payload>.<mac>`; no verification.
pub fn token_claims(token: &str) -> Option<(String, i64)> {
    let p = token.split('.').nth(1)?;
    let v: Value = serde_json::from_slice(&B64.decode(p).ok()?).ok()?;
    Some((v["email"].as_str()?.to_string(), v["exp"].as_i64()?))
}

/// PKCE sign-in against the relay's /login page via a loopback callback. Returns the token.
pub async fn relay_signin(relay_ws: &str, open: impl FnOnce(&str)) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let base = http_base(relay_ws);
    let ln = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let state = B64.encode(rand::random::<[u8; 16]>());
    let verifier = B64.encode(rand::random::<[u8; 32]>());
    let challenge = B64.encode(Sha256::digest(verifier.as_bytes()));
    let cb = format!("http://127.0.0.1:{}/callback", ln.local_addr().map_err(|e| e.to_string())?.port());
    let mut u = url::Url::parse(&format!("{base}/login")).map_err(|e| e.to_string())?;
    u.query_pairs_mut().append_pair("cb", &cb).append_pair("state", &state).append_pair("code_challenge", &challenge);
    open(u.as_str());

    let code = tokio::time::timeout(Duration::from_secs(180), async {
        loop {
            let (mut s, _) = ln.accept().await.map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 8192];
            let n = s.read(&mut buf).await.unwrap_or(0);
            let line = String::from_utf8_lossy(&buf[..n]).lines().next().unwrap_or("").to_string();
            let path = line.split_whitespace().nth(1).unwrap_or("/");
            let q = url::Url::parse(&format!("http://x{path}")).map_err(|e| e.to_string())?;
            let get = |k: &str| q.query_pairs().find(|(a, _)| a == k).map(|(_, v)| v.to_string());
            let ok = q.path() == "/callback" && get("code").is_some() && get("state").map(|s| s.split('#').next() == Some(&state)).unwrap_or(false);
            let body = if ok { "Signed in. You can close this tab and return to Otaku." } else { "Sign-in failed. Return to Otaku and try again." };
            let _ = s
                .write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes())
                .await;
            if ok {
                return Ok::<String, String>(get("code").unwrap().split('#').next().unwrap().to_string());
            }
        }
    })
    .await
    .map_err(|_| "sign-in timed out".to_string())??;

    let r = reqwest::Client::new()
        .post(format!("{base}/login/exchange"))
        .json(&serde_json::json!({"code": code, "code_verifier": verifier}))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("sign-in exchange refused ({})", r.status()));
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    v["token"].as_str().map(String::from).ok_or_else(|| "no token in exchange response".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_decode() {
        let p = B64.encode(r#"{"email":"a@facets.cloud","exp":123}"#);
        assert_eq!(token_claims(&format!("prxr1.{p}.mac")), Some(("a@facets.cloud".into(), 123)));
    }

    #[test]
    fn refusal_codes() {
        assert_eq!(DialError::Refused("domain not allowed".into()).code(), "wrong_account");
        assert_eq!(DialError::Unreachable("x".into()).code(), "relay_unreachable");
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// OTAKU_RELAY_TOKEN=<prxr1…> cargo test --lib sync::net::live -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn relay_host_and_guest_exchange() {
        let token = std::env::var("OTAKU_RELAY_TOKEN").expect("token");
        let link = Link::generate(super::super::link::DEFAULT_RELAY, true);
        let host = dial_relay(&link, "host", &token).await;
        println!("host: {:?}", host.as_ref().err().map(|e| e.to_string()));
        let mut host = host.unwrap();
        let guest = dial_relay(&link, "guest", &token).await;
        println!("guest: {:?}", guest.as_ref().err().map(|e| e.to_string()));
        let mut guest = guest.unwrap();
        guest.tx.send("hello-from-guest".into()).unwrap();
        let got = tokio::time::timeout(Duration::from_secs(10), host.rx.recv()).await;
        println!("host received: {:?}", got);
        host.tx.send("hello-from-host".into()).unwrap();
        let got2 = tokio::time::timeout(Duration::from_secs(10), guest.rx.recv()).await;
        println!("guest received: {:?}", got2);
    }
}

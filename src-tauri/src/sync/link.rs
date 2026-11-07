// Collab link: same format as praxis-harness collab/link.go.
// FullLink = "<relay host>/r/<room>.<b64url(key[||write token])>", no padding.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};

pub const DEFAULT_RELAY: &str = "wss://relay.internal-tools.console.facets.cloud";

#[derive(Clone, Debug, PartialEq)]
pub struct Link {
    pub relay: String, // ws(s) base, e.g. wss://relay.example.com
    pub room: String,
    pub key: [u8; 32],
    pub write: Option<[u8; 16]>,
}

fn host_of(relay: &str) -> &str {
    let r = relay.split("://").last().unwrap_or(relay);
    r.split('/').next().unwrap_or(r)
}

impl Link {
    pub fn generate(relay: &str, write: bool) -> Link {
        let room = B64.encode(rand::random::<[u8; 9]>());
        Link { relay: relay.into(), room, key: rand::random(), write: write.then(rand::random) }
    }

    pub fn secret(&self) -> String {
        let mut raw = self.key.to_vec();
        if let Some(w) = self.write {
            raw.extend_from_slice(&w);
        }
        B64.encode(raw)
    }

    pub fn write_b64(&self) -> String {
        self.write.map(|w| B64.encode(w)).unwrap_or_default()
    }

    pub fn full_link(&self) -> String {
        format!("{}/r/{}.{}", host_of(&self.relay), self.room, self.secret())
    }

    pub fn ws_url(&self) -> String {
        format!("{}/r/{}", self.relay.trim_end_matches('/'), self.room)
    }

    pub fn parse(raw: &str) -> Result<Link, String> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err("empty link".into());
        }
        let (relay, rest) = match raw.find("/r/") {
            Some(i) => {
                let host = &raw[..i];
                let scheme = if host.starts_with("ws://") || host.starts_with("http://") { "ws" } else { "wss" };
                let host = host.split("://").last().unwrap();
                (format!("{scheme}://{host}"), &raw[i + 3..])
            }
            None => (String::new(), raw),
        };
        let cut = rest.rfind(['.', '#']).filter(|i| *i > 0).ok_or("link has no secret")?;
        let (room, secret) = (&rest[..cut], &rest[cut + 1..]);
        let bytes = B64.decode(secret.trim_end_matches('=')).map_err(|e| format!("bad secret: {e}"))?;
        let (key, write) = match bytes.len() {
            32 => (bytes[..32].try_into().unwrap(), None),
            48 => (bytes[..32].try_into().unwrap(), Some(bytes[32..].try_into().unwrap())),
            n => return Err(format!("invalid room secret length {n} (want 32 or 48)")),
        };
        Ok(Link { relay, room: room.into(), key, write })
    }
}

/// Four verification words from SHA-256(room key); both screens must match.
pub fn verify_words(key: &[u8; 32]) -> [&'static str; 4] {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(key);
    std::array::from_fn(|i| WORDS[h[i] as usize % WORDS.len()])
}

const WORDS: [&str; 64] = [
    "amber", "anchor", "arrow", "aspen", "badge", "basil", "beacon", "birch", "bison", "bloom", "breeze", "cedar",
    "cinder", "clover", "comet", "coral", "crane", "dawn", "delta", "dune", "ember", "falcon", "fern", "flint",
    "fox", "garnet", "glacier", "harbor", "hazel", "heron", "iris", "ivory", "jade", "juniper", "kelp", "lantern",
    "lark", "lotus", "maple", "marble", "meadow", "mist", "nectar", "oak", "onyx", "opal", "otter", "pearl",
    "pine", "plum", "quartz", "raven", "reef", "river", "sage", "sparrow", "tide", "topaz", "violet", "willow",
    "wren", "yarrow", "zephyr", "zinnia",
];

/// otaku://pair?l=<FullLink>&lan=<ip:port>&n=<mac name>[&r=<relay>][&t=<relay token>]
pub fn qr_payload(l: &Link, lan: &str, name: &str, token: &str) -> String {
    let mut u = url::Url::parse("otaku://pair").unwrap();
    {
        let mut q = u.query_pairs_mut();
        q.append_pair("l", &l.full_link()).append_pair("lan", lan).append_pair("n", name).append_pair("r", &l.relay);
        if !token.is_empty() {
            q.append_pair("t", token);
        }
    }
    u.to_string()
}

pub struct QrPayload {
    pub link: Link,
    pub lan: String,
    pub name: String,
    pub token: String,
}

pub fn parse_qr(s: &str) -> Result<QrPayload, String> {
    let u = url::Url::parse(s.trim()).map_err(|e| e.to_string())?;
    if u.scheme() != "otaku" || u.host_str() != Some("pair") {
        return Err("not an Otaku pairing code".into());
    }
    let get = |k: &str| u.query_pairs().find(|(a, _)| a == k).map(|(_, v)| v.to_string()).unwrap_or_default();
    let mut link = Link::parse(&get("l"))?;
    if !get("r").is_empty() {
        link.relay = get("r");
    }
    Ok(QrPayload { link, lan: get("lan"), name: get("n"), token: get("t") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let l = Link::generate("wss://relay.example.com", true);
        assert_eq!(Link::parse(&l.full_link()).unwrap(), l);
        let view = Link::generate("wss://relay.example.com", false);
        assert_eq!(Link::parse(&view.full_link()).unwrap(), view);
        let q = parse_qr(&qr_payload(&l, "192.168.1.5:4000", "My Mac", "tok")).unwrap();
        assert_eq!((q.link, q.lan.as_str(), q.name.as_str(), q.token.as_str()), (l, "192.168.1.5:4000", "My Mac", "tok"));
    }

    // Produced by praxis-harness collab.Link{...}.FullLink() (key = 0..31, write = key[:16]).
    #[test]
    fn go_full_link() {
        let l = Link::parse("relay.example.com/r/abcDEF123.AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8AAQIDBAUGBwgJCgsMDQ4P").unwrap();
        assert_eq!(l.relay, "wss://relay.example.com");
        assert_eq!(l.room, "abcDEF123");
        assert_eq!(l.key, std::array::from_fn::<u8, 32, _>(|i| i as u8));
        assert_eq!(l.write.unwrap(), std::array::from_fn::<u8, 16, _>(|i| i as u8));
        assert_eq!(l.full_link(), "relay.example.com/r/abcDEF123.AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8AAQIDBAUGBwgJCgsMDQ4P");
    }

    #[test]
    fn words_stable() {
        assert_eq!(verify_words(&[7; 32]), verify_words(&[7; 32]));
        assert_ne!(verify_words(&[7; 32]), verify_words(&[8; 32]));
    }
}

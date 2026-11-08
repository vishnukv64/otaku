// AES-256-GCM sealing and frame envelope, wire-compatible with praxis-harness
// collab/{crypto,frame}.go: wire = JSON {"Nonce":b64,"Body":b64} (Go []byte = std base64),
// plaintext = JSON {kind,data,seq,dev}.
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize)]
struct Sealed {
    #[serde(rename = "Nonce")]
    nonce: String,
    #[serde(rename = "Body")]
    body: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Frame {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub data: Value,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub seq: i64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub dev: String,
}

fn is_zero(n: &i64) -> bool {
    *n == 0
}

pub fn seal_with(key: &[u8; 32], nonce: [u8; 12], plain: &[u8]) -> Result<String, String> {
    let c = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let body = c.encrypt(Nonce::from_slice(&nonce), plain).map_err(|e| e.to_string())?;
    serde_json::to_string(&Sealed { nonce: B64.encode(nonce), body: B64.encode(body) }).map_err(|e| e.to_string())
}

pub fn encode(key: &[u8; 32], f: &Frame) -> Result<String, String> {
    seal_with(key, rand::random(), &serde_json::to_vec(f).map_err(|e| e.to_string())?)
}

pub fn decode(key: &[u8; 32], wire: &str) -> Result<Frame, String> {
    let s: Sealed = serde_json::from_str(wire).map_err(|e| format!("unmarshal sealed frame: {e}"))?;
    let nonce = B64.decode(s.nonce).map_err(|e| e.to_string())?;
    if nonce.len() != 12 {
        return Err(format!("nonce must be 12 bytes, got {}", nonce.len()));
    }
    let body = B64.decode(s.body).map_err(|e| e.to_string())?;
    let c = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let plain = c.decrypt(Nonce::from_slice(&nonce), body.as_slice()).map_err(|_| "decrypt failed".to_string())?;
    serde_json::from_slice(&plain).map_err(|e| format!("unmarshal frame: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> [u8; 32] {
        std::array::from_fn(|i| i as u8)
    }

    // Sealed by praxis-harness collab.EncodeFrame(key 0..31, Frame{hello,{"name":"mac"},42,"dev1"}).
    #[test]
    fn opens_go_frame() {
        let wire = r#"{"Nonce":"+e3mticNW+O3EXPl","Body":"j8Q4UN9q5zINvZMkBrIC1DXJXk5k5ZhpJQU54eU6KEdS7t+A9oUxtGWsLjC7P8YhhdZIRjF9Sdk6GEJdfwlS6V2mb2MorR+OYiJAuA=="}"#;
        let f = decode(&key(), wire).unwrap();
        assert_eq!(f, Frame { kind: "hello".into(), data: serde_json::json!({"name":"mac"}), seq: 42, dev: "dev1".into() });
    }

    #[test]
    fn round_trip_and_tamper() {
        let f = Frame { kind: "ping".into(), ..Default::default() };
        let w = encode(&key(), &f).unwrap();
        assert_eq!(decode(&key(), &w).unwrap(), f);
        assert!(decode(&[9; 32], &w).is_err());
    }
}

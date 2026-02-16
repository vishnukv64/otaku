use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const JIKAN_BASE_URL: &str = "https://api.jikan.moe/v4";
const MAX_PER_SECOND: usize = 3;
const MAX_PER_MINUTE: usize = 60;
const RETRY_DELAY_MS: u64 = 1000;
const MAX_RETRIES: u32 = 5;
const CACHE_TTL_SECS: u64 = 24 * 60 * 60;

struct CacheEntry {
    etag: String,
    body: String,
    cached_at: Instant,
}

pub struct JikanClient {
    request_times: Mutex<VecDeque<Instant>>,
    cache: Mutex<HashMap<String, CacheEntry>>,
}

impl JikanClient {
    pub fn new() -> Self {
        Self {
            request_times: Mutex::new(VecDeque::new()),
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn wait_for_rate_limit(&self) {
        loop {
            let mut times = self.request_times.lock().unwrap();
            let now = Instant::now();

            while times
                .front()
                .map_or(false, |t| now.duration_since(*t) > Duration::from_secs(60))
            {
                times.pop_front();
            }

            if times.len() >= MAX_PER_MINUTE {
                let wait_until = times
                    .front()
                    .unwrap()
                    .checked_add(Duration::from_secs(60))
                    .unwrap();
                let wait = wait_until.saturating_duration_since(now);
                drop(times);
                std::thread::sleep(wait);
                continue;
            }

            let one_sec_ago = now - Duration::from_secs(1);
            let recent_count = times.iter().filter(|t| **t > one_sec_ago).count();
            if recent_count >= MAX_PER_SECOND {
                drop(times);
                std::thread::sleep(Duration::from_millis(350));
                continue;
            }

            times.push_back(now);
            break;
        }
    }

    pub fn get(&self, path: &str) -> Result<String, String> {
        self.get_with_query(path, &[])
    }

    pub fn get_with_query(&self, path: &str, params: &[(&str, &str)]) -> Result<String, String> {
        let mut url = format!("{}{}", JIKAN_BASE_URL, path);

        if !params.is_empty() {
            let query: Vec<String> = params
                .iter()
                .filter(|(_, v)| !v.is_empty())
                .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
                .collect();
            if !query.is_empty() {
                url = format!("{}?{}", url, query.join("&"));
            }
        }

        // Look up cached ETag for this URL (only if not expired)
        let (cached_etag, cached_body) = {
            let cache = self.cache.lock().unwrap();
            if let Some(entry) = cache.get(&url) {
                if entry.cached_at.elapsed() < Duration::from_secs(CACHE_TTL_SECS) {
                    (Some(entry.etag.clone()), Some(entry.body.clone()))
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            }
        };

        let mut last_error = String::new();

        for attempt in 0..MAX_RETRIES {
            self.wait_for_rate_limit();

            log::debug!("Jikan request: {} (attempt {})", url, attempt + 1);

            let mut request = ureq::get(&url).set("Accept", "application/json");
            if let Some(ref etag) = cached_etag {
                request = request.set("If-None-Match", etag);
            }

            match request.call() {
                Ok(response) => {
                    let etag = response.header("etag").map(|s| s.to_string());
                    let body = response
                        .into_string()
                        .map_err(|e| format!("Failed to read response body: {}", e))?;
                    if let Some(etag) = etag {
                        let mut cache = self.cache.lock().unwrap();
                        cache.insert(
                            url,
                            CacheEntry {
                                etag,
                                body: body.clone(),
                                cached_at: Instant::now(),
                            },
                        );
                    }
                    return Ok(body);
                }
                Err(ureq::Error::Status(304, _)) => {
                    if let Some(ref body) = cached_body {
                        log::debug!("Jikan ETag cache hit: {}", url);
                        return Ok(body.clone());
                    }
                    // No cached body despite 304 — fall through to retry without ETag
                    last_error = "Received 304 but no cached body".to_string();
                }
                Err(ureq::Error::Status(429, _)) => {
                    log::warn!(
                        "Jikan rate limited, waiting {}ms before retry",
                        RETRY_DELAY_MS * (attempt as u64 + 1)
                    );
                    std::thread::sleep(Duration::from_millis(
                        RETRY_DELAY_MS * (attempt as u64 + 1),
                    ));
                    last_error = "Rate limited by Jikan API".to_string();
                }
                Err(ureq::Error::Status(code, response)) => {
                    let body = response.into_string().unwrap_or_default();
                    last_error = format!("Jikan API error {}: {}", code, body);
                    if code == 404 {
                        return Err(last_error);
                    }
                    if code >= 500 {
                        std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                        continue;
                    }
                    return Err(last_error);
                }
                Err(e) => {
                    last_error = format!("Jikan request failed: {}", e);
                    std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                }
            }
        }

        Err(format!(
            "Jikan request failed after {} retries: {}",
            MAX_RETRIES, last_error
        ))
    }

    pub fn get_parsed<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let body = self.get(path)?;
        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse Jikan response: {} (path: {})", e, path))
    }

    pub fn get_parsed_with_query<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> Result<T, String> {
        let body = self.get_with_query(path, params)?;
        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse Jikan response: {} (path: {})", e, path))
    }
}

lazy_static::lazy_static! {
    pub static ref JIKAN: JikanClient = JikanClient::new();
}

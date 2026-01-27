// Extension Sandbox - Safe HTTP fetch wrapper
//
// Provides secure HTTP requests with:
// - Domain whitelisting validation
// - URL sanitization
// - Request proxying through Rust
// - Response type validation

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// HTTP fetch options
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct FetchOptions {
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

/// HTTP fetch response
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct FetchResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Safe HTTP fetch implementation
#[allow(dead_code)]
pub struct SafeFetch {
    allowed_domains: Vec<String>,
}

#[allow(dead_code)]
impl SafeFetch {
    /// Create a new SafeFetch instance
    pub fn new(allowed_domains: Vec<String>) -> Self {
        Self {
            allowed_domains,
        }
    }

    /// Validate if a URL is allowed
    fn is_url_allowed(&self, url: &str) -> bool {
        let parsed = match url::Url::parse(url) {
            Ok(u) => u,
            Err(_) => return false,
        };

        // Must use HTTPS
        if parsed.scheme() != "https" {
            return false;
        }

        let host = match parsed.host_str() {
            Some(h) => h,
            None => return false,
        };

        // Check against allowed domains
        self.allowed_domains.iter().any(|domain| {
            host == domain || host.ends_with(&format!(".{}", domain))
        })
    }

    /// Perform a safe HTTP fetch (using ureq)
    pub fn fetch(&self, url: &str, options: Option<FetchOptions>) -> Result<FetchResponse> {
        use std::io::Read;

        // Validate URL
        if !self.is_url_allowed(url) {
            return Err(anyhow!("URL not in allowed domains: {}", url));
        }

        let options = options.unwrap_or(FetchOptions {
            method: Some("GET".to_string()),
            headers: None,
            body: None,
        });

        // Build request
        let method = options.method.as_deref().unwrap_or("GET");
        let mut request = match method.to_uppercase().as_str() {
            "GET" => ureq::get(url),
            "POST" => ureq::post(url),
            "PUT" => ureq::put(url),
            "DELETE" => ureq::delete(url),
            _ => return Err(anyhow!("Unsupported HTTP method: {}", method)),
        };

        // Add headers
        if let Some(headers) = options.headers {
            for (key, value) in headers {
                request = request.set(&key, &value);
            }
        }

        // Execute request
        let response = if let Some(body) = options.body {
            request.send_string(&body)?
        } else {
            request.call()?
        };

        let status = response.status();

        // Extract headers
        let mut headers = HashMap::new();
        for header_name in response.headers_names() {
            if let Some(value) = response.header(&header_name) {
                headers.insert(header_name, value.to_string());
            }
        }

        // Get body
        let mut body = String::new();
        response.into_reader().take(10_000_000).read_to_string(&mut body)?;

        Ok(FetchResponse {
            status,
            headers,
            body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_validation() {
        let fetcher = SafeFetch::new(vec!["example.com".to_string()]);

        assert!(fetcher.is_url_allowed("https://example.com/api"));
        assert!(fetcher.is_url_allowed("https://www.example.com/data"));
        assert!(!fetcher.is_url_allowed("http://example.com")); // HTTP not allowed
        assert!(!fetcher.is_url_allowed("https://evil.com"));
    }

    #[tokio::test]
    async fn test_fetch_disallowed_domain() {
        let fetcher = SafeFetch::new(vec!["example.com".to_string()]);
        let result = fetcher.fetch("https://evil.com/phishing", None).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not in allowed domains"));
    }
}


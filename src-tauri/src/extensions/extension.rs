// Extension struct and loader
//
// Defines the Extension type that holds the JavaScript code and metadata,
// and provides methods for loading and validating extensions.

use super::types::{ExtensionMetadata, ExtensionType};
use anyhow::{anyhow, Result};
use regex::Regex;

/// Represents a loaded extension
#[derive(Debug, Clone)]
pub struct Extension {
    pub metadata: ExtensionMetadata,
    pub code: String,
    pub allowed_domains: Vec<String>,
}

impl Extension {
    /// Load an extension from JavaScript code
    pub fn from_code(code: &str) -> Result<Self> {
        // Parse the extension code to extract metadata
        // Extensions should export an object with metadata
        let metadata = Self::extract_metadata(code)?;
        let allowed_domains = Self::extract_allowed_domains(code, &metadata.base_url)?;

        Ok(Self {
            metadata,
            code: code.to_string(),
            allowed_domains,
        })
    }

    /// Extract extension metadata from JavaScript code
    fn extract_metadata(code: &str) -> Result<ExtensionMetadata> {
        // For now, we'll use a simple regex approach
        // In production, you'd want to actually execute the code and read the metadata

        // Look for common patterns like: id: "com.example.anime"
        let id_re = Regex::new(r#"id:\s*["']([^"']+)["']"#)?;
        let name_re = Regex::new(r#"name:\s*["']([^"']+)["']"#)?;
        let version_re = Regex::new(r#"version:\s*["']([^"']+)["']"#)?;
        let type_re = Regex::new(r#"type:\s*["']([^"']+)["']"#)?;
        let lang_re = Regex::new(r#"language:\s*["']([^"']+)["']"#)?;
        let url_re = Regex::new(r#"baseUrl:\s*["']([^"']+)["']"#)?;

        let id = id_re
            .captures(code)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| anyhow!("Missing extension id"))?;

        let name = name_re
            .captures(code)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| anyhow!("Missing extension name"))?;

        let version = version_re
            .captures(code)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| "1.0.0".to_string());

        let extension_type = type_re
            .captures(code)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str())
            .unwrap_or("anime");

        let extension_type = match extension_type {
            "manga" => ExtensionType::Manga,
            _ => ExtensionType::Anime,
        };

        let language = lang_re
            .captures(code)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| "en".to_string());

        let base_url = url_re
            .captures(code)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| anyhow!("Missing baseUrl"))?;

        Ok(ExtensionMetadata {
            id,
            name,
            version,
            extension_type,
            language,
            base_url,
        })
    }

    /// Extract allowed domains from base URL
    fn extract_allowed_domains(_code: &str, base_url: &str) -> Result<Vec<String>> {
        let mut domains = vec![];

        // Parse base URL to get domain
        let url = url::Url::parse(base_url)?;
        if let Some(domain) = url.host_str() {
            domains.push(domain.to_string());
        }

        // TODO: Look for additional domains in code (allowedDomains array)

        Ok(domains)
    }

    /// Validate if a URL is allowed for this extension
    pub fn is_url_allowed(&self, url: &str) -> bool {
        let parsed = match url::Url::parse(url) {
            Ok(u) => u,
            Err(_) => return false,
        };

        let host = match parsed.host_str() {
            Some(h) => h,
            None => return false,
        };

        // Check if the host matches any allowed domain
        self.allowed_domains.iter().any(|domain| {
            host == domain || host.ends_with(&format!(".{}", domain))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_validation() {
        let ext = Extension {
            metadata: ExtensionMetadata {
                id: "test".to_string(),
                name: "Test".to_string(),
                version: "1.0.0".to_string(),
                extension_type: ExtensionType::Anime,
                language: "en".to_string(),
                base_url: "https://example.com".to_string(),
            },
            code: String::new(),
            allowed_domains: vec!["example.com".to_string()],
        };

        assert!(ext.is_url_allowed("https://example.com/api/search"));
        assert!(ext.is_url_allowed("https://www.example.com/data"));
        assert!(!ext.is_url_allowed("https://evil.com/phishing"));
    }
}

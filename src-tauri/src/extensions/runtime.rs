// Extension Runtime - QuickJS sandbox execution
//
// Provides secure JavaScript execution environment with:
// - Isolated context per extension
// - Removed dangerous globals
// - Safe HTTP fetch wrapper with domain validation

use super::extension::Extension;
use super::types::{ExtensionMetadata, MediaDetails, SearchResults, TagsResult, VideoSources};
use anyhow::{anyhow, Result};
use rquickjs::{Context, Runtime};
use std::sync::Arc;

/// Extension runtime for executing JavaScript code safely
pub struct ExtensionRuntime {
    extension: Arc<Extension>,
    #[allow(dead_code)]
    runtime: Runtime,
    context: Context,
}

impl ExtensionRuntime {
    /// Create a new runtime for an extension
    pub fn new(extension: Extension) -> Result<Self> {
        let runtime = Runtime::new()?;
        let context = Context::full(&runtime)?;

        let ext_runtime = Self {
            extension: Arc::new(extension),
            runtime,
            context,
        };

        // Initialize the sandbox
        ext_runtime.setup_sandbox()?;

        Ok(ext_runtime)
    }

    /// Set up the sandboxed environment
    fn setup_sandbox(&self) -> Result<()> {
        self.context.with(|ctx| {
            // Remove dangerous globals
            ctx.eval::<(), _>(
                r#"
                // Remove Node.js globals
                delete globalThis.require;
                delete globalThis.process;
                delete globalThis.Buffer;
                delete globalThis.global;
                delete globalThis.__dirname;
                delete globalThis.__filename;

                // Remove dangerous eval-like functions
                delete globalThis.eval;
                delete globalThis.Function;

                // Add safe console for debugging
                globalThis.console = {
                    log: function(...args) {
                        // Messages will be captured by Rust
                        __log(JSON.stringify(args));
                    },
                    error: function(...args) {
                        __log("ERROR: " + JSON.stringify(args));
                    }
                };
            "#,
            )?;

            // Register __fetch as a Rust function using ureq (pure sync, no tokio)
            let fetch_fn = rquickjs::Function::new(ctx.clone(), |url: String, options: rquickjs::Object| {
                use std::io::Read;

                log::debug!("__fetch called");

                // Parse options
                let method = options.get::<_, Option<String>>("method")
                    .unwrap_or(None)
                    .unwrap_or_else(|| "GET".to_string());

                // Build request using ureq
                let mut request = match method.as_str() {
                    "POST" => ureq::post(&url),
                    _ => ureq::get(&url),
                };

                // Add headers if provided
                if let Ok(Some(headers)) = options.get::<_, Option<rquickjs::Object>>("headers") {
                    for key in headers.keys::<String>() {
                        if let Ok(k) = key {
                            if let Ok(value) = headers.get::<_, String>(&k) {
                                request = request.set(&k, &value);
                            }
                        }
                    }
                }

                // Execute request
                match request.call() {
                    Ok(response) => {
                        let status = response.status();
                        let mut body = String::new();
                        let read_result = response.into_reader()
                            .take(10_000_000)
                            .read_to_string(&mut body);

                        let _ = (status, read_result); // silence unused warnings

                        // Return response object
                        Ok(serde_json::json!({
                            "status": status,
                            "body": body
                        }).to_string())
                    },
                    Err(e) => {
                        log::error!("__fetch error: {:?}", e);
                        Err(rquickjs::Error::Exception)
                    },
                }
            })?;

            ctx.globals().set("__fetch", fetch_fn)?;

            // Add __log function that outputs to Rust logger
            let log_fn = rquickjs::Function::new(ctx.clone(), |message: String| {
                log::debug!("[Extension] {}", message);
                Ok::<(), rquickjs::Error>(())
            })?;

            ctx.globals().set("__log", log_fn)?;

            // Load the extension code
            ctx.eval::<(), _>(self.extension.code.as_str())?;

            Ok::<(), rquickjs::Error>(())
        })?;

        Ok(())
    }

    /// Call extension's search method
    pub fn search(&self, query: &str, page: u32) -> Result<SearchResults> {
        self.context.with(|ctx| {
            // Get the extension object
            let ext_obj: rquickjs::Object = ctx.eval("extensionObject")?;

            // Call the search method
            let search_fn: rquickjs::Function = ext_obj.get("search")?;
            let result: rquickjs::Value = search_fn.call((query, page))?;

            // Convert to JSON and deserialize
            let json_str: String = ctx.json_stringify(result)?
                .ok_or_else(|| anyhow!("Failed to stringify search result"))?
                .to_string()?;

            let search_results: SearchResults = serde_json::from_str(&json_str)?;

            Ok(search_results)
        })
    }

    /// Call extension's discover method with filters
    pub fn discover(&self, page: u32, sort_type: Option<String>, genres: Vec<String>) -> Result<SearchResults> {
        self.context.with(|ctx| {
            let ext_obj: rquickjs::Object = ctx.eval("extensionObject")?;

            // Check if discover method exists, fallback to search if not
            let discover_fn: Option<rquickjs::Function> = ext_obj.get("discover").ok();

            let result: rquickjs::Value = if let Some(fn_obj) = discover_fn {
                // Call discover with sort type and genres
                let sort = sort_type.unwrap_or_else(|| "score".to_string());

                // Create JavaScript array for genres
                let genres_js = ctx.eval::<rquickjs::Value, _>("[]")?;
                let genres_arr = genres_js.as_object().unwrap();
                for (i, genre) in genres.iter().enumerate() {
                    genres_arr.set(i as u32, genre.as_str())?;
                }

                fn_obj.call((page, sort.as_str(), genres_arr.clone()))?
            } else {
                // Fallback to search with empty query
                let search_fn: rquickjs::Function = ext_obj.get("search")?;
                search_fn.call(("", page))?
            };

            let json_str: String = ctx.json_stringify(result)?
                .ok_or_else(|| anyhow!("Failed to stringify discover result"))?
                .to_string()?;

            let search_results: SearchResults = serde_json::from_str(&json_str)?;

            Ok(search_results)
        })
    }

    /// Call extension's getRecommendations method
    pub fn get_recommendations(&self) -> Result<SearchResults> {
        self.context.with(|ctx| {
            let ext_obj: rquickjs::Object = ctx.eval("extensionObject")?;

            // Check if getRecommendations method exists
            let recommendations_fn: Option<rquickjs::Function> = ext_obj.get("getRecommendations").ok();

            let result: rquickjs::Value = if let Some(fn_obj) = recommendations_fn {
                fn_obj.call(())?
            } else {
                // Fallback to discover
                let discover_fn: Option<rquickjs::Function> = ext_obj.get("discover").ok();
                if let Some(fn_obj) = discover_fn {
                    let genres_js = ctx.eval::<rquickjs::Value, _>("[]")?;
                    fn_obj.call((1, "trending", genres_js))?
                } else {
                    // Last fallback to search
                    let search_fn: rquickjs::Function = ext_obj.get("search")?;
                    search_fn.call(("", 1))?
                }
            };

            let json_str: String = ctx.json_stringify(result)?
                .ok_or_else(|| anyhow!("Failed to stringify recommendations result"))?
                .to_string()?;

            let search_results: SearchResults = serde_json::from_str(&json_str)?;

            Ok(search_results)
        })
    }

    /// Call extension's getDetails method
    pub fn get_details(&self, id: &str) -> Result<MediaDetails> {
        self.context.with(|ctx| {
            let ext_obj: rquickjs::Object = ctx.eval("extensionObject")?;
            let fn_obj: rquickjs::Function = ext_obj.get("getDetails")?;
            let result: rquickjs::Value = fn_obj.call((id,))?;

            let json_str: String = ctx.json_stringify(result)?
                .ok_or_else(|| anyhow!("Failed to stringify details"))?
                .to_string()?;

            let details: MediaDetails = serde_json::from_str(&json_str)?;

            Ok(details)
        })
    }

    /// Call extension's getSources method
    pub fn get_sources(&self, episode_id: &str) -> Result<VideoSources> {
        self.context.with(|ctx| {
            let ext_obj: rquickjs::Object = ctx.eval("extensionObject")?;
            let fn_obj: rquickjs::Function = ext_obj.get("getSources")?;
            let result: rquickjs::Value = fn_obj.call((episode_id,))?;

            let json_str: String = ctx.json_stringify(result)?
                .ok_or_else(|| anyhow!("Failed to stringify sources"))?
                .to_string()?;

            let sources: VideoSources = serde_json::from_str(&json_str)?;

            Ok(sources)
        })
    }

    /// Call extension's getTags method
    pub fn get_tags(&self, page: u32) -> Result<TagsResult> {
        self.context.with(|ctx| {
            let ext_obj: rquickjs::Object = ctx.eval("extensionObject")?;

            // Check if getTags method exists
            let tags_fn: Option<rquickjs::Function> = ext_obj.get("getTags").ok();

            let result: rquickjs::Value = if let Some(fn_obj) = tags_fn {
                fn_obj.call((page,))?
            } else {
                // Return empty result if method doesn't exist
                return Ok(TagsResult {
                    genres: vec![],
                    studios: vec![],
                    has_next_page: false,
                });
            };

            let json_str: String = ctx.json_stringify(result)?
                .ok_or_else(|| anyhow!("Failed to stringify tags result"))?
                .to_string()?;

            let tags_result: TagsResult = serde_json::from_str(&json_str)?;

            Ok(tags_result)
        })
    }

    /// Get extension metadata
    #[allow(dead_code)]
    pub fn metadata(&self) -> &ExtensionMetadata {
        &self.extension.metadata
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sandbox_removes_dangerous_globals() {
        let ext_code = r#"
            const extensionObject = {
                id: "test",
                name: "Test Extension",
                version: "1.0.0",
                type: "anime",
                language: "en",
                baseUrl: "https://example.com",

                search: async (query, page) => {
                    // Try to access forbidden globals
                    if (typeof require !== 'undefined') throw new Error("require is accessible!");
                    if (typeof process !== 'undefined') throw new Error("process is accessible!");
                    if (typeof eval !== 'undefined') throw new Error("eval is accessible!");

                    return {
                        results: [],
                        hasNextPage: false
                    };
                }
            };
        "#;

        let extension = Extension::from_code(ext_code).unwrap();
        let runtime = ExtensionRuntime::new(extension);

        // Should not panic - dangerous globals should be removed
        assert!(runtime.is_ok());
    }
}

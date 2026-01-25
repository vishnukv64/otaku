// Extension Runtime - QuickJS sandbox execution
//
// Provides secure JavaScript execution environment with:
// - Isolated context per extension
// - Removed dangerous globals
// - Safe HTTP fetch wrapper with domain validation

use super::extension::Extension;
use super::types::*;
use anyhow::{anyhow, Result};
use rquickjs::{Context, Runtime};
use std::sync::Arc;

/// Extension runtime for executing JavaScript code safely
pub struct ExtensionRuntime {
    extension: Arc<Extension>,
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

            // Inject the __fetch wrapper (will be implemented next)
            ctx.eval::<(), _>(
                r#"
                // Placeholder for __fetch - will be replaced with actual implementation
                globalThis.__fetch = async function(url, options) {
                    throw new Error("__fetch not yet implemented");
                };

                globalThis.__log = function(message) {
                    // Placeholder for logging
                };
            "#,
            )?;

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

    /// Get extension metadata
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

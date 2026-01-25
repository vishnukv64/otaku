// Extension System Module
//
// Handles:
// - Extension loading and management
// - JavaScript sandboxing with QuickJS
// - Domain whitelisting and URL validation
// - Extension API interface

pub mod extension;
pub mod runtime;
pub mod sandbox;
pub mod types;

// Re-export commonly used types
pub use extension::Extension;
pub use runtime::ExtensionRuntime;
pub use types::*;

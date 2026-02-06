// Status Normalizer Module
//
// Normalizes various API status strings to canonical values for consistent
// release tracking. Different APIs return different status strings (e.g.,
// "Airing", "Currently Airing", "Releasing", "Ongoing") that all mean the same thing.

use serde::{Deserialize, Serialize};

/// Canonical status values for normalized status tracking
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NormalizedStatus {
    /// Media is currently releasing new episodes/chapters
    Ongoing,
    /// Media has finished releasing
    Completed,
    /// Media is on hiatus (temporarily paused)
    Hiatus,
    /// Status is unknown or couldn't be determined
    Unknown,
}

impl NormalizedStatus {
    /// Returns the string representation for database storage
    pub fn as_str(&self) -> &'static str {
        match self {
            NormalizedStatus::Ongoing => "ongoing",
            NormalizedStatus::Completed => "completed",
            NormalizedStatus::Hiatus => "hiatus",
            NormalizedStatus::Unknown => "unknown",
        }
    }

    /// Parse from database string
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "ongoing" => NormalizedStatus::Ongoing,
            "completed" => NormalizedStatus::Completed,
            "hiatus" => NormalizedStatus::Hiatus,
            _ => NormalizedStatus::Unknown,
        }
    }

    /// Check if this status should be checked for new releases
    #[allow(dead_code)]
    pub fn should_check(&self) -> bool {
        matches!(self, NormalizedStatus::Ongoing | NormalizedStatus::Unknown)
    }

    /// Get recommended check interval in minutes based on status
    pub fn recommended_interval_minutes(&self) -> u32 {
        match self {
            NormalizedStatus::Ongoing => 120,   // 2 hours for ongoing
            NormalizedStatus::Unknown => 240,   // 4 hours for unknown (might be ongoing)
            NormalizedStatus::Hiatus => 720,    // 12 hours for hiatus
            NormalizedStatus::Completed => 1440, // 24 hours for completed (rare updates)
        }
    }
}

impl std::fmt::Display for NormalizedStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Normalize an API status string to a canonical status value
///
/// Handles various status string formats from different APIs:
/// - "Airing", "Currently Airing" → Ongoing
/// - "Releasing", "Ongoing", "Not yet released" → Ongoing
/// - "Finished", "Completed", "Ended" → Completed
/// - "Hiatus", "On Hold", "Paused" → Hiatus
/// - Unknown/empty → Unknown
///
/// # Examples
/// ```
/// use status_normalizer::normalize_status;
///
/// assert_eq!(normalize_status("Airing"), NormalizedStatus::Ongoing);
/// assert_eq!(normalize_status("Currently Airing"), NormalizedStatus::Ongoing);
/// assert_eq!(normalize_status("Finished"), NormalizedStatus::Completed);
/// ```
pub fn normalize_status(raw: &str) -> NormalizedStatus {
    if raw.is_empty() {
        return NormalizedStatus::Unknown;
    }

    let lower = raw.to_lowercase();

    // Check for ongoing patterns (order matters - check more specific first)
    if lower.contains("airing")
        || lower.contains("releasing")
        || lower.contains("ongoing")
        || lower.contains("currently")
        || lower.contains("not yet released")
        || lower.contains("not yet aired")
        || lower.contains("upcoming")
    {
        return NormalizedStatus::Ongoing;
    }

    // Check for completed patterns
    if lower.contains("finished")
        || lower.contains("completed")
        || lower.contains("ended")
        || lower.contains("concluded")
    {
        return NormalizedStatus::Completed;
    }

    // Check for hiatus patterns
    if lower.contains("hiatus")
        || lower.contains("on hold")
        || lower.contains("paused")
        || lower.contains("suspended")
        || lower.contains("discontinued") // Might still come back
    {
        return NormalizedStatus::Hiatus;
    }

    // Default to Unknown for unrecognized status strings
    NormalizedStatus::Unknown
}

/// Status mapping entry for explicit mappings
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct StatusMapping {
    pub pattern: &'static str,
    pub normalized: NormalizedStatus,
}

/// Get all known status mappings for reference/debugging
#[allow(dead_code)]
pub fn get_status_mappings() -> Vec<StatusMapping> {
    vec![
        // Ongoing patterns
        StatusMapping { pattern: "Airing", normalized: NormalizedStatus::Ongoing },
        StatusMapping { pattern: "Currently Airing", normalized: NormalizedStatus::Ongoing },
        StatusMapping { pattern: "Releasing", normalized: NormalizedStatus::Ongoing },
        StatusMapping { pattern: "Ongoing", normalized: NormalizedStatus::Ongoing },
        StatusMapping { pattern: "Not Yet Released", normalized: NormalizedStatus::Ongoing },
        StatusMapping { pattern: "Not Yet Aired", normalized: NormalizedStatus::Ongoing },
        StatusMapping { pattern: "Upcoming", normalized: NormalizedStatus::Ongoing },
        // Completed patterns
        StatusMapping { pattern: "Finished", normalized: NormalizedStatus::Completed },
        StatusMapping { pattern: "Completed", normalized: NormalizedStatus::Completed },
        StatusMapping { pattern: "Ended", normalized: NormalizedStatus::Completed },
        StatusMapping { pattern: "Concluded", normalized: NormalizedStatus::Completed },
        // Hiatus patterns
        StatusMapping { pattern: "Hiatus", normalized: NormalizedStatus::Hiatus },
        StatusMapping { pattern: "On Hold", normalized: NormalizedStatus::Hiatus },
        StatusMapping { pattern: "Paused", normalized: NormalizedStatus::Hiatus },
        StatusMapping { pattern: "Suspended", normalized: NormalizedStatus::Hiatus },
        StatusMapping { pattern: "Discontinued", normalized: NormalizedStatus::Hiatus },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_ongoing_variants() {
        assert_eq!(normalize_status("Airing"), NormalizedStatus::Ongoing);
        assert_eq!(normalize_status("Currently Airing"), NormalizedStatus::Ongoing);
        assert_eq!(normalize_status("Releasing"), NormalizedStatus::Ongoing);
        assert_eq!(normalize_status("Ongoing"), NormalizedStatus::Ongoing);
        assert_eq!(normalize_status("AIRING"), NormalizedStatus::Ongoing); // Case insensitive
        assert_eq!(normalize_status("currently airing"), NormalizedStatus::Ongoing);
    }

    #[test]
    fn test_normalize_completed_variants() {
        assert_eq!(normalize_status("Finished"), NormalizedStatus::Completed);
        assert_eq!(normalize_status("Completed"), NormalizedStatus::Completed);
        assert_eq!(normalize_status("Ended"), NormalizedStatus::Completed);
        assert_eq!(normalize_status("FINISHED"), NormalizedStatus::Completed);
    }

    #[test]
    fn test_normalize_hiatus_variants() {
        assert_eq!(normalize_status("Hiatus"), NormalizedStatus::Hiatus);
        assert_eq!(normalize_status("On Hold"), NormalizedStatus::Hiatus);
        assert_eq!(normalize_status("Paused"), NormalizedStatus::Hiatus);
    }

    #[test]
    fn test_normalize_unknown() {
        assert_eq!(normalize_status(""), NormalizedStatus::Unknown);
        assert_eq!(normalize_status("SomeRandomStatus"), NormalizedStatus::Unknown);
        assert_eq!(normalize_status("TBD"), NormalizedStatus::Unknown);
    }

    #[test]
    fn test_should_check() {
        assert!(NormalizedStatus::Ongoing.should_check());
        assert!(NormalizedStatus::Unknown.should_check());
        assert!(!NormalizedStatus::Completed.should_check());
        assert!(!NormalizedStatus::Hiatus.should_check());
    }
}

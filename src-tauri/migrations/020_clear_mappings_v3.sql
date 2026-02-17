-- Clear all cached ID mappings to re-resolve with improved length-ratio-aware
-- title similarity scoring and multi-title agreement validation.
DELETE FROM id_mappings;

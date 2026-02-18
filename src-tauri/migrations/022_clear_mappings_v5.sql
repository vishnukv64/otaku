-- Clear all cached AllAnime ID mappings after bridge matching logic change:
-- removed fuzzy fallback, added season+year validation, explicit title_japanese matching.
-- Stale mappings from fuzzy matching may be wrong — force re-resolution.
DELETE FROM id_mappings;

-- Clear all cached ID mappings so they get re-resolved with multi-signal validation.
-- Add match_score column to track confidence of each mapping.
DELETE FROM id_mappings;
ALTER TABLE id_mappings ADD COLUMN match_score REAL;

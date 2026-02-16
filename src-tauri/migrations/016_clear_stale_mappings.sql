-- Clear stale id_mappings from broken bridge resolutions
-- The bridge was rewritten to use inline GraphQL queries
-- Old cached IDs may point to wrong AllAnime shows
DELETE FROM id_mappings;

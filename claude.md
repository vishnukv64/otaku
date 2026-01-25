# Otaku - API Response Documentation

This file contains actual API responses from various sources for reference when building new features.

## AllAnime API

### Base URL
`https://api.allanime.day/api`

### GraphQL API Structure

All requests use the format:
```
https://api.allanime.day/api?variables={encoded_variables}&query={encoded_query}
```

---

## API Response Structures

### 1. Get Anime Details (`getDetails`)

**Endpoint**: GraphQL query with `show(_id: $showId)`

**Query Fields Requested**:
- `_id`
- `name`
- `thumbnail`
- `description`
- `status`
- `score`
- `season`
- `availableEpisodes`
- `availableEpisodesDetail`
- `genres`
- `tags`

**Actual Response** (to be populated):
```json
// Response will be captured from logs and added here
```

---

### 2. Search Anime (`search`)

**Endpoint**: GraphQL query with `shows(search: $search)`

**Query Fields Requested**:
- `_id`
- `name`
- `thumbnail`
- `availableEpisodes`
- `description`
- `status`
- `score`
- `season`

**Actual Response** (to be populated):
```json
// Response will be captured from logs and added here
```

---

### 3. Discover/Popular Anime (`discover`)

**Endpoint**: Persisted query `queryPopular`

**Variables**:
- `type`: "anime"
- `size`: 20
- `dateRange`: 1 (trending) or 30 (top rated)
- `page`: page number
- `allowAdult`: false
- `allowUnknown`: false

**Actual Response** (to be populated):
```json
// Response will be captured from logs and added here
```

---

### 4. Get Episode Sources (`getSources`)

**Endpoint**: GraphQL query with `episode(showId: $showId)`

**Query Fields Requested**:
- `episodeString`
- `sourceUrls`

**Actual Response** (to be populated):
```json
// Response will be captured from logs and added here
```

---

## Field Mappings & Transformations

### Genres/Tags Field Analysis

After analyzing the actual API response, we'll document:
- Field name in API response
- Data type and structure
- Sample values
- How to map to our `MediaDetails` type

---

## Notes

- All responses are captured from the Rust backend `__fetch()` function
- Logs can be viewed when running the app in development mode
- This documentation is updated as we discover new API structures

use serde::Deserialize;
use sqlx::SqlitePool;
use std::collections::HashSet;

const ALLANIME_API: &str = "https://api.allanime.day/api";
const ALLANIME_REFERER: &str = "https://allanime.to";
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

/// Inline GraphQL query for AllAnime search (avoids persisted query hash rotation).
/// Based on the approach used by GoAnime/Curd projects.
/// Inline GraphQL query for AllAnime anime search.
const ANIME_SEARCH_GQL: &str = r#"query($search: SearchInput, $limit: Int, $page: Int, $translationType: VaildTranslationTypeEnumType, $countryOrigin: VaildCountryOriginEnumType) {
    shows(search: $search, limit: $limit, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
        edges {
            _id
            name
            englishName
            availableEpisodes
            airedStart
            __typename
        }
    }
}"#;

/// Persisted query hash for AllAnime manga search.
/// AllAnime's `mangas` query does NOT support inline GraphQL (returns 400).
/// We must use a persisted query hash instead (same one the manga extension uses).
/// This hash may rotate over time — if manga bridge breaks, update this hash
/// from the working extension or AllAnime's frontend JS.
const MANGA_SEARCH_HASH: &str = "3a4b7e9ef62953484a05dd40f35b35b118ad2ff3d5e72d2add79bcaa663271e7";

// --- AllAnime response types ---

#[derive(Debug, Deserialize)]
struct AllAnimeSearchResponse {
    data: Option<AllAnimeSearchData>,
}

#[derive(Debug, Deserialize)]
struct AllAnimeSearchData {
    shows: Option<AllAnimeEdgeList>,
    mangas: Option<AllAnimeEdgeList>,
}

#[derive(Debug, Deserialize)]
struct AllAnimeEdgeList {
    edges: Vec<AllAnimeEdge>,
}

#[derive(Debug, Deserialize)]
struct AllAnimeEdge {
    _id: String,
    name: String,
    #[serde(rename = "englishName")]
    english_name: Option<String>,
    /// airedStart contains a date object like {"year":2024,"month":10,"date":5}
    #[serde(rename = "airedStart")]
    aired_start: Option<AllAnimeAiredStart>,
}

#[derive(Debug, Deserialize)]
struct AllAnimeAiredStart {
    year: Option<i32>,
}

// --- Database functions ---

/// Check the cache for an existing MAL-to-AllAnime mapping.
pub async fn get_cached_mapping(pool: &SqlitePool, mal_id: &str) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT allanime_id FROM id_mappings WHERE mal_id = ?",
    )
    .bind(mal_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))
}

/// Delete a cached mapping so it can be re-resolved.
pub async fn delete_cached_mapping(pool: &SqlitePool, mal_id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM id_mappings WHERE mal_id = ?")
        .bind(mal_id)
        .execute(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

/// Save a MAL-to-AllAnime mapping to the cache.
pub async fn save_mapping(
    pool: &SqlitePool,
    mal_id: &str,
    allanime_id: &str,
    media_type: &str,
    title: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR REPLACE INTO id_mappings (mal_id, allanime_id, media_type, title) VALUES (?, ?, ?, ?)",
    )
    .bind(mal_id)
    .bind(allanime_id)
    .bind(media_type)
    .bind(title)
    .execute(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

// --- Title matching ---

/// Compute a simple title similarity score (case-insensitive).
///
/// Returns 1.0 for exact matches, 0.8 for substring containment,
/// and Jaccard word similarity otherwise.
pub fn title_similarity(a: &str, b: &str) -> f64 {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();

    if a_lower == b_lower {
        return 1.0;
    }

    if a_lower.contains(&b_lower) || b_lower.contains(&a_lower) {
        return 0.8;
    }

    let a_words: HashSet<&str> = a_lower.split_whitespace().collect();
    let b_words: HashSet<&str> = b_lower.split_whitespace().collect();
    let intersection = a_words.intersection(&b_words).count() as f64;
    let union = a_words.union(&b_words).count() as f64;

    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

// --- Direct AllAnime search ---

/// Search AllAnime directly.
/// - Anime: uses inline GraphQL (avoids persisted query hash rotation).
/// - Manga: uses persisted query hash (inline GraphQL returns 400 for `mangas`).
fn search_allanime(query: &str, media_type: &str) -> Result<Vec<AllAnimeEdge>, String> {
    let is_manga = media_type == "manga";

    let mut search_obj = serde_json::json!({
        "allowAdult": false,
        "allowUnknown": false,
        "query": query
    });
    if is_manga {
        search_obj["isManga"] = serde_json::json!(true);
    }

    let variables = serde_json::json!({
        "search": search_obj,
        "limit": 40,
        "page": 1,
        "translationType": "sub",
        "countryOrigin": "ALL"
    });

    let variables_str = serde_json::to_string(&variables)
        .map_err(|e| format!("Failed to serialize variables: {}", e))?;

    // Manga uses persisted query hash; anime uses inline GraphQL
    let url = if is_manga {
        let extensions = serde_json::json!({
            "persistedQuery": {
                "version": 1,
                "sha256Hash": MANGA_SEARCH_HASH
            }
        });
        let extensions_str = serde_json::to_string(&extensions)
            .map_err(|e| format!("Failed to serialize extensions: {}", e))?;
        format!(
            "{}?variables={}&extensions={}",
            ALLANIME_API,
            urlencoding::encode(&variables_str),
            urlencoding::encode(&extensions_str)
        )
    } else {
        format!(
            "{}?variables={}&query={}",
            ALLANIME_API,
            urlencoding::encode(&variables_str),
            urlencoding::encode(ANIME_SEARCH_GQL)
        )
    };

    let response = ureq::get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Referer", ALLANIME_REFERER)
        .call()
        .map_err(|e| format!("AllAnime search request failed: {}", e))?;

    let body = response
        .into_string()
        .map_err(|e| format!("Failed to read AllAnime response: {}", e))?;

    let parsed: AllAnimeSearchResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse AllAnime response: {}", e))?;

    // Extract edges from either shows or mangas depending on query type
    Ok(parsed
        .data
        .and_then(|d| if is_manga { d.mangas } else { d.shows })
        .map(|s| s.edges)
        .unwrap_or_default())
}

/// Resolve a MAL title to an AllAnime ID by searching AllAnime directly.
///
/// Uses inline GraphQL queries (like GoAnime/Curd) to avoid persisted query
/// hash rotation issues. Tries the English title first, then falls back to
/// the original title. Uses title similarity and year matching to find the
/// best candidate.
pub fn resolve_via_search(
    title: &str,
    english_title: Option<&str>,
    year: Option<i32>,
    media_type: &str,
) -> Result<Option<String>, String> {
    let search_queries: Vec<&str> = [english_title, Some(title)]
        .iter()
        .filter_map(|q| *q)
        .collect();

    let mut best_match: Option<(String, f64)> = None;

    for query in &search_queries {
        let edges = match search_allanime(query, media_type) {
            Ok(edges) => edges,
            Err(e) => {
                log::warn!("AllAnime search failed for '{}': {}", query, e);
                continue;
            }
        };

        for edge in &edges {
            // Score against the original title
            let mut score = title_similarity(&edge.name, title) * 10.0;

            // Also score against the AllAnime english name
            if let Some(ref aa_eng) = edge.english_name {
                let eng_score = title_similarity(aa_eng, title) * 10.0;
                score = score.max(eng_score);
            }

            // Score against the MAL english title
            if let Some(eng) = english_title {
                let eng_score = title_similarity(&edge.name, eng) * 10.0;
                score = score.max(eng_score);

                if let Some(ref aa_eng) = edge.english_name {
                    let cross_eng = title_similarity(aa_eng, eng) * 10.0;
                    score = score.max(cross_eng);
                }
            }

            // Year match bonus
            if let (Some(aa_year), Some(search_year)) =
                (edge.aired_start.as_ref().and_then(|s| s.year), year)
            {
                if aa_year == search_year {
                    score += 3.0;
                }
            }

            let dominated = best_match.as_ref().map_or(false, |(_, s)| score <= *s);
            if !dominated && score > 5.0 {
                best_match = Some((edge._id.clone(), score));
            }
        }

        // Stop early if we already have a strong match
        if best_match.as_ref().map_or(false, |(_, s)| *s >= 8.0) {
            break;
        }
    }

    Ok(best_match.map(|(id, _)| id))
}

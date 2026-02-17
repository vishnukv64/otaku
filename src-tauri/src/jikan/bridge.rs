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
            nativeName
            availableEpisodes
            airedStart
            type
            status
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
    /// Native/Japanese title from AllAnime (e.g., "アナザー")
    #[serde(rename = "nativeName")]
    native_name: Option<String>,
    /// airedStart contains a date object like {"year":2024,"month":10,"date":5}
    #[serde(rename = "airedStart")]
    aired_start: Option<AllAnimeAiredStart>,
    /// Media type from AllAnime (e.g., "TV", "Movie", "OVA", "ONA", "Special")
    #[serde(rename = "type")]
    show_type: Option<String>,
    /// Available episode counts by language
    #[serde(rename = "availableEpisodes")]
    available_episodes: Option<AllAnimeAvailableEpisodes>,
}

#[derive(Debug, Deserialize)]
struct AllAnimeAiredStart {
    year: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct AllAnimeAvailableEpisodes {
    sub: Option<i32>,
    #[allow(dead_code)]
    dub: Option<i32>,
}

/// Hints from Jikan metadata to validate AllAnime search candidates.
#[allow(dead_code)]
pub struct MatchHints {
    /// Media type from Jikan (e.g., "TV", "Movie", "OVA", "Manga", "Novel")
    pub media_type: Option<String>,
    /// Total episode/chapter count from Jikan
    pub episode_count: Option<i32>,
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
    match_score: Option<f64>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR REPLACE INTO id_mappings (mal_id, allanime_id, media_type, title, match_score) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(mal_id)
    .bind(allanime_id)
    .bind(media_type)
    .bind(title)
    .bind(match_score)
    .execute(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

// --- Title matching ---

/// Compute a title similarity score (case-insensitive).
///
/// Returns 1.0 for exact matches, length-ratio-scaled score for substring
/// containment (penalizes short substrings inside long titles), and Jaccard
/// word similarity otherwise.
pub fn title_similarity(a: &str, b: &str) -> f64 {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();

    if a_lower == b_lower {
        return 1.0;
    }

    // Substring containment — scale by length ratio so short substrings
    // inside long titles don't score nearly as high as near-exact matches.
    // e.g. "another" in "in another world..." → ratio 7/42 ≈ 0.17 → 0.8*sqrt(0.17) ≈ 0.33
    // vs.  "naruto" in "naruto shippuden"   → ratio 6/17 ≈ 0.35 → 0.8*sqrt(0.35) ≈ 0.47
    if a_lower.contains(&b_lower) || b_lower.contains(&a_lower) {
        let shorter = a_lower.len().min(b_lower.len()) as f64;
        let longer = a_lower.len().max(b_lower.len()) as f64;
        if longer > 0.0 {
            return 0.8 * (shorter / longer).sqrt();
        }
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

// --- Media type normalization ---

/// Normalize media type strings from Jikan and AllAnime to a common form.
/// This allows cross-source comparison (e.g., Jikan "TV" vs AllAnime "TV Series").
#[allow(dead_code)]
fn normalize_media_type(raw: &str) -> &'static str {
    match raw.to_lowercase().trim() {
        "tv" | "tv series" | "tv_series" => "TV",
        "movie" | "film" => "MOVIE",
        "ova" | "oav" => "OVA",
        "ona" | "web" => "ONA",
        "special" | "sp" => "SPECIAL",
        "music" | "mv" => "MUSIC",
        "manga" => "MANGA",
        "novel" | "light novel" | "light_novel" | "lightnovel" => "NOVEL",
        "manhwa" => "MANHWA",
        "manhua" => "MANHUA",
        "one-shot" | "one_shot" | "oneshot" => "ONESHOT",
        "doujin" | "doujinshi" => "DOUJIN",
        _ => "UNKNOWN",
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
    synonyms: &[String],
    _hints: &MatchHints,
) -> Result<Option<(String, f64)>, String> {
    // Build deduplicated search queries: english_title → title → up to 4 synonyms
    let mut seen = HashSet::new();
    let mut search_queries: Vec<&str> = Vec::new();
    for q in [english_title, Some(title)].iter().filter_map(|q| *q) {
        if !q.is_empty() && seen.insert(q.to_lowercase()) {
            search_queries.push(q);
        }
    }
    for syn in synonyms.iter().take(4) {
        if !syn.is_empty() && seen.insert(syn.to_lowercase()) {
            search_queries.push(syn);
        }
    }

    // Collect all Jikan title variants (lowercased, trimmed) for exact matching
    let mut jikan_titles: Vec<String> = vec![title.to_lowercase()];
    if let Some(eng) = english_title {
        let e = eng.to_lowercase();
        if !jikan_titles.contains(&e) {
            jikan_titles.push(e);
        }
    }
    for syn in synonyms {
        let s = syn.to_lowercase();
        if !s.is_empty() && !jikan_titles.contains(&s) {
            jikan_titles.push(s);
        }
    }

    log::info!(
        "BRIDGE SEARCH for title='{}' | all_jikan_titles={:?} | year={:?}",
        title, jikan_titles, year
    );

    // --- Pass 1: Exact native name match (strongest signal) ---
    // --- Pass 2: Exact romaji/english name match ---
    // --- Pass 3: Fuzzy fallback (only if no exact match found) ---

    let mut all_edges: Vec<AllAnimeEdge> = Vec::new();

    for query in &search_queries {
        match search_allanime(query, media_type) {
            Ok(edges) => {
                log::info!("BRIDGE QUERY '{}': got {} candidates", query, edges.len());
                all_edges.extend(edges);
            }
            Err(e) => {
                log::warn!("AllAnime search failed for '{}': {}", query, e);
            }
        }
    }

    // Deduplicate by _id
    {
        let mut seen_ids = HashSet::new();
        all_edges.retain(|e| seen_ids.insert(e._id.clone()));
    }

    log::info!("BRIDGE: {} unique candidates after dedup", all_edges.len());

    // Log all candidates for debugging
    for edge in &all_edges {
        log::info!(
            "BRIDGE CANDIDATE [{}]: name='{}', english={:?}, native={:?}, type={:?}, eps={:?}, year={:?}",
            edge._id, edge.name, edge.english_name, edge.native_name,
            edge.show_type, edge.available_episodes.as_ref().and_then(|ae| ae.sub),
            edge.aired_start.as_ref().and_then(|s| s.year),
        );
    }

    // Pass 1: Exact native/Japanese name match
    for edge in &all_edges {
        if let Some(ref aa_native) = edge.native_name {
            let aa_native_trimmed = aa_native.trim().to_lowercase();
            if aa_native_trimmed.is_empty() {
                continue;
            }
            for jt in &jikan_titles {
                if jt.trim() == aa_native_trimmed {
                    log::info!(
                        "BRIDGE MATCH (native exact): '{}' native='{}' == jikan '{}' → id={}",
                        edge.name, aa_native, jt, edge._id
                    );
                    return Ok(Some((edge._id.clone(), 100.0)));
                }
            }
        }
    }
    log::info!("BRIDGE: No native name match found, trying exact title match");

    // Pass 2: Exact romaji or english name match
    for edge in &all_edges {
        let edge_name_lower = edge.name.to_lowercase();
        for jt in &jikan_titles {
            if jt.trim() == edge_name_lower.trim() {
                log::info!(
                    "BRIDGE MATCH (title exact): name='{}' == jikan '{}' → id={}",
                    edge.name, jt, edge._id
                );
                return Ok(Some((edge._id.clone(), 50.0)));
            }
        }
        if let Some(ref aa_eng) = edge.english_name {
            let aa_eng_lower = aa_eng.to_lowercase();
            for jt in &jikan_titles {
                if jt.trim() == aa_eng_lower.trim() {
                    log::info!(
                        "BRIDGE MATCH (english exact): english='{}' == jikan '{}' → id={}",
                        aa_eng, jt, edge._id
                    );
                    return Ok(Some((edge._id.clone(), 50.0)));
                }
            }
        }
    }
    log::info!("BRIDGE: No exact title match found, trying fuzzy fallback");

    // Pass 3: Fuzzy fallback — title similarity + year (for titles with no exact match)
    let mut best_match: Option<(String, f64)> = None;

    for edge in &all_edges {
        let mut score = title_similarity(&edge.name, title) * 10.0;

        if let Some(ref aa_eng) = edge.english_name {
            let eng_score = title_similarity(aa_eng, title) * 10.0;
            score = score.max(eng_score);
        }
        if let Some(eng) = english_title {
            let eng_score = title_similarity(&edge.name, eng) * 10.0;
            score = score.max(eng_score);
            if let Some(ref aa_eng) = edge.english_name {
                let cross = title_similarity(aa_eng, eng) * 10.0;
                score = score.max(cross);
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

        log::info!(
            "BRIDGE FUZZY '{}' [{}]: score={:.1}",
            edge.name, edge._id, score
        );

        let dominated = best_match.as_ref().map_or(false, |(_, s)| score <= *s);
        if !dominated && score > 5.0 {
            best_match = Some((edge._id.clone(), score));
        }
    }

    if let Some((ref id, score)) = best_match {
        log::info!("BRIDGE RESULT for '{}': winner='{}' score={:.1} (fuzzy)", title, id, score);
    } else {
        log::warn!("BRIDGE RESULT for '{}': NO MATCH found", title);
    }

    Ok(best_match)
}

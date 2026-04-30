// Recommendations Module
//
// TF-IDF genre scoring engine for content-based recommendations.
// Builds a user preference vector from watch history, then scores
// cached media by genre overlap to surface personalized suggestions.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use anyhow::Result;
use std::collections::HashMap;

use super::media::MediaEntry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenrePreference {
    pub genre: String,
    pub tf: f64,
    pub idf: f64,
    pub tfidf: f64,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendationEntry {
    pub media: MediaEntry,
    pub score: f64,
    pub reason: String,
    pub matched_genres: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarToGroup {
    pub source_title: String,
    pub source_cover_url: Option<String>,
    pub source_id: String,
    pub recommendations: Vec<RecommendationEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserGenreProfile {
    pub top_genres: Vec<GenrePreference>,
    pub total_watch_time_seconds: f64,
    pub total_series: i32,
}

/// Helper: parse genres JSON array string into a Vec<String>.
fn parse_genres(genres_json: &Option<String>) -> Vec<String> {
    match genres_json {
        Some(s) if !s.is_empty() => {
            serde_json::from_str::<Vec<String>>(s).unwrap_or_default()
        }
        _ => Vec::new(),
    }
}

/// Helper: construct a MediaEntry from a sqlx Row using the `m.*` column pattern.
fn media_entry_from_row(row: &sqlx::sqlite::SqliteRow) -> MediaEntry {
    use sqlx::Row;
    MediaEntry {
        id: row.get("id"),
        extension_id: row.get("extension_id"),
        title: row.get("title"),
        english_name: row.get("english_name"),
        native_name: row.get("native_name"),
        description: row.get("description"),
        cover_url: row.get("cover_url"),
        banner_url: row.get("banner_url"),
        trailer_url: row.get("trailer_url"),
        media_type: row.get("media_type"),
        content_type: row.get("content_type"),
        status: row.get("status"),
        year: row.get("year"),
        rating: row.get("rating"),
        episode_count: row.get("episode_count"),
        episode_duration: row.get("episode_duration"),
        season_quarter: row.get("season_quarter"),
        season_year: row.get("season_year"),
        aired_start_year: row.get("aired_start_year"),
        aired_start_month: row.get("aired_start_month"),
        aired_start_date: row.get("aired_start_date"),
        genres: row.get("genres"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

async fn build_feedback_genre_adjustments(pool: &SqlitePool) -> Result<HashMap<String, f64>> {
    use sqlx::Row;

    let rows = sqlx::query(
        r#"
        SELECT f.sentiment, m.genres
        FROM feedback f
        JOIN media m ON f.media_id = m.id
        WHERE m.media_type = 'anime'
          AND m.genres IS NOT NULL
          AND m.genres != '[]'
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut adjustments = HashMap::new();

    for row in rows {
        let sentiment: String = row.get("sentiment");
        let genres_json: Option<String> = row.get("genres");
        let delta = match sentiment.as_str() {
            "liked" => 0.2,
            "disliked" => -0.3,
            _ => 0.0,
        };

        if delta == 0.0 {
            continue;
        }

        for genre in parse_genres(&genres_json) {
            *adjustments.entry(genre).or_insert(0.0) += delta;
        }
    }

    Ok(adjustments)
}

/// Build a TF-IDF genre preference vector from the user's watch history.
///
/// TF (term frequency): time-weighted genre engagement with recency decay.
///   For each watch_history row we compute `progress_seconds * 0.95^(days_ago / 30)`
///   then sum per genre across all watched media.
///
/// IDF (inverse document frequency): `ln(total_media_with_genres / media_per_genre)`
///   computed from the full media catalogue so niche genres get a boost.
///
/// The final weight is TF*IDF normalized to [0, 1].
pub async fn build_genre_profile(pool: &SqlitePool) -> Result<UserGenreProfile> {
    // Step 1: Fetch raw watch data with timestamps and genres
    let rows = sqlx::query(
        r#"
        SELECT w.progress_seconds, w.last_watched, m.genres
        FROM watch_history w
        JOIN media m ON w.media_id = m.id
        WHERE m.genres IS NOT NULL AND w.progress_seconds > 0
        "#
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;

    let now = chrono::Local::now().naive_local();
    let mut genre_tf: HashMap<String, f64> = HashMap::new();
    let mut total_watch_time: f64 = 0.0;
    let mut media_ids_seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for row in &rows {
        let progress: f64 = row.get("progress_seconds");
        let last_watched: Option<String> = row.get("last_watched");
        let genres_json: Option<String> = row.get("genres");

        total_watch_time += progress;

        // Compute recency decay: 0.95^(days_ago / 30)
        let decay = match &last_watched {
            Some(ts) => {
                // Parse timestamp — try multiple formats since SQLite stores local time
                let parsed = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S")
                    .or_else(|_| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S"))
                    .or_else(|_| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S%.f"));
                match parsed {
                    Ok(dt) => {
                        let days_ago = (now - dt).num_seconds() as f64 / 86400.0;
                        0.95_f64.powf(days_ago / 30.0)
                    }
                    Err(_) => 1.0,
                }
            }
            None => 1.0,
        };

        let weighted = progress * decay;

        for genre in parse_genres(&genres_json) {
            *genre_tf.entry(genre).or_insert(0.0) += weighted;
        }
    }

    // Count unique media in watch history for total_series
    {
        let series_rows = sqlx::query(
            "SELECT DISTINCT media_id FROM watch_history"
        )
        .fetch_all(pool)
        .await?;

        for row in &series_rows {
            let mid: String = row.get("media_id");
            media_ids_seen.insert(mid);
        }
    }

    // Step 2: Compute IDF from the media catalogue
    let total_with_genres: f64 = {
        let row = sqlx::query(
            "SELECT COUNT(*) as cnt FROM media WHERE genres IS NOT NULL AND genres != '[]'"
        )
        .fetch_one(pool)
        .await?;
        let cnt: i32 = row.get("cnt");
        cnt as f64
    };

    // Count media per genre
    let genre_doc_rows = sqlx::query(
        r#"
        SELECT j.value as genre, COUNT(DISTINCT m.id) as doc_count
        FROM media m, json_each(m.genres) j
        WHERE m.genres IS NOT NULL
        GROUP BY j.value
        "#
    )
    .fetch_all(pool)
    .await?;

    let mut genre_doc_count: HashMap<String, f64> = HashMap::new();
    for row in &genre_doc_rows {
        let genre: String = row.get("genre");
        let count: i32 = row.get("doc_count");
        genre_doc_count.insert(genre, count as f64);
    }

    // Step 3: Combine TF * IDF
    let mut genre_scores: Vec<GenrePreference> = Vec::new();
    let mut max_tfidf: f64 = 0.0;

    for (genre, tf) in &genre_tf {
        let doc_count = genre_doc_count.get(genre).copied().unwrap_or(1.0);
        let idf = if total_with_genres > 0.0 && doc_count > 0.0 {
            (total_with_genres / doc_count).ln()
        } else {
            0.0
        };
        let tfidf = tf * idf;
        if tfidf > max_tfidf {
            max_tfidf = tfidf;
        }
        genre_scores.push(GenrePreference {
            genre: genre.clone(),
            tf: *tf,
            idf,
            tfidf,
            weight: 0.0, // will be normalized below
        });
    }

    // Normalize weights to [0, 1]
    for pref in &mut genre_scores {
        pref.weight = if max_tfidf > 0.0 { pref.tfidf / max_tfidf } else { 0.0 };
    }

    // Sort descending by weight
    genre_scores.sort_by(|a, b| b.weight.partial_cmp(&a.weight).unwrap_or(std::cmp::Ordering::Equal));

    Ok(UserGenreProfile {
        top_genres: genre_scores,
        total_watch_time_seconds: total_watch_time,
        total_series: media_ids_seen.len() as i32,
    })
}

/// Score cached media by TF-IDF genre overlap and return top recommendations.
///
/// Candidates are media NOT already in the user's library, with rating > 6.0.
/// Each candidate is scored by summing the user's genre weights for every matching
/// genre, plus a small rating bonus (rating / 100).
pub async fn get_content_recommendations(
    pool: &SqlitePool,
    limit: i32,
) -> Result<Vec<RecommendationEntry>> {
    let profile = build_genre_profile(pool).await?;

    if profile.top_genres.is_empty() {
        return Ok(Vec::new());
    }

    // Build a quick lookup of genre -> weight
    let mut genre_weights: HashMap<String, f64> = profile
        .top_genres
        .iter()
        .map(|g| (g.genre.clone(), g.weight))
        .collect();

    let feedback_adjustments = build_feedback_genre_adjustments(pool).await?;
    for (genre, adjustment) in feedback_adjustments {
        if let Some(weight) = genre_weights.get_mut(&genre) {
            *weight += adjustment;
        }
    }

    // Fetch candidate anime: not in library, has genres, rating > 6.0
    let candidates = sqlx::query(
        r#"
        SELECT m.*
        FROM media m
        WHERE m.genres IS NOT NULL
          AND m.genres != '[]'
          AND m.rating > 6.0
          AND m.media_type = 'anime'
          AND m.id NOT IN (SELECT media_id FROM library)
        LIMIT 500
        "#
    )
    .fetch_all(pool)
    .await?;

    let mut scored: Vec<RecommendationEntry> = Vec::new();

    for row in &candidates {
        let media = media_entry_from_row(row);
        let media_genres = parse_genres(&media.genres);

        if media_genres.is_empty() {
            continue;
        }

        let mut genre_score = 0.0;
        let mut matched = Vec::new();
        let mut feedback_tilt = 0.0;

        for g in &media_genres {
            if let Some(&w) = genre_weights.get(g) {
                genre_score += w;
                matched.push(g.clone());
                if w > 0.0 {
                    feedback_tilt += w;
                }
            }
        }

        if matched.is_empty() {
            continue;
        }

        // Rating bonus: rating / 100 (max ~0.1 contribution)
        let rating_bonus = media.rating.unwrap_or(0.0) / 100.0;
        let total_score = genre_score + rating_bonus;

        // Build reason string from top 3 matched genres
        let reason_genres: Vec<&str> = matched.iter().take(3).map(|s| s.as_str()).collect();
        let reason = if feedback_tilt > 0.6 {
            format!("Because you keep liking {}", reason_genres.join(", "))
        } else {
            format!("Because you like {}", reason_genres.join(", "))
        };

        scored.push(RecommendationEntry {
            media,
            score: total_score,
            reason,
            matched_genres: matched,
        });
    }

    // Sort descending by score
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit as usize);

    Ok(scored)
}

/// Find media similar to the user's top-rated/recent series, grouped by source.
///
/// Picks the user's top 3 series (by library score, then recency) and for each
/// finds media sharing 3+ genres (or 2+ if the source has fewer than 4 genres).
/// Results are grouped by source series for the frontend to render as carousels.
pub async fn get_similar_to_watched(
    pool: &SqlitePool,
    limit_per_series: i32,
) -> Result<Vec<SimilarToGroup>> {
    use sqlx::Row;

    // Get user's top 3 anime series by score (fallback: most recently added)
    let top_series = sqlx::query(
        r#"
        SELECT m.*, l.score as user_score, l.added_at
        FROM library l
        JOIN media m ON l.media_id = m.id
        WHERE m.genres IS NOT NULL AND m.genres != '[]'
          AND m.media_type = 'anime'
        ORDER BY COALESCE(l.score, 0) DESC, l.added_at DESC
        LIMIT 3
        "#
    )
    .fetch_all(pool)
    .await?;

    if top_series.is_empty() {
        return Ok(Vec::new());
    }

    // Collect all library media IDs to exclude
    let library_ids: Vec<String> = sqlx::query("SELECT media_id FROM library")
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| {
            let id: String = r.get("media_id");
            id
        })
        .collect();

    let library_set: std::collections::HashSet<&str> = library_ids.iter().map(|s| s.as_str()).collect();

    let mut groups: Vec<SimilarToGroup> = Vec::new();

    for source_row in &top_series {
        let source_media = media_entry_from_row(source_row);
        let source_genres = parse_genres(&source_media.genres);

        if source_genres.is_empty() {
            continue;
        }

        let genre_threshold = if source_genres.len() < 4 { 2 } else { 3 };

        // Fetch anime candidates with genres (match source media type)
        let candidates = sqlx::query(
            r#"
            SELECT m.*
            FROM media m
            WHERE m.genres IS NOT NULL
              AND m.genres != '[]'
              AND m.media_type = 'anime'
              AND m.id != ?
            LIMIT 500
            "#
        )
        .bind(&source_media.id)
        .fetch_all(pool)
        .await?;

        let source_genre_set: std::collections::HashSet<&str> =
            source_genres.iter().map(|s| s.as_str()).collect();

        let mut similar: Vec<RecommendationEntry> = Vec::new();

        for cand_row in &candidates {
            let cand = media_entry_from_row(cand_row);

            // Exclude library items
            if library_set.contains(cand.id.as_str()) {
                continue;
            }

            let cand_genres = parse_genres(&cand.genres);
            let matched: Vec<String> = cand_genres
                .iter()
                .filter(|g| source_genre_set.contains(g.as_str()))
                .cloned()
                .collect();

            if matched.len() < genre_threshold {
                continue;
            }

            let overlap_score = matched.len() as f64;
            let rating_bonus = cand.rating.unwrap_or(0.0) / 100.0;
            let total_score = overlap_score + rating_bonus;

            let reason = format!(
                "Similar to {} ({} shared genres)",
                source_media.title, matched.len()
            );

            similar.push(RecommendationEntry {
                media: cand,
                score: total_score,
                reason,
                matched_genres: matched,
            });
        }

        // Sort by score descending, take top N
        similar.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        similar.truncate(limit_per_series as usize);

        if !similar.is_empty() {
            groups.push(SimilarToGroup {
                source_title: source_media.title.clone(),
                source_cover_url: source_media.cover_url.clone(),
                source_id: source_media.id.clone(),
                recommendations: similar,
            });
        }
    }

    Ok(groups)
}

/// Return a truncated genre profile for the frontend (top N genres).
pub async fn get_user_top_genres(
    pool: &SqlitePool,
    limit: i32,
) -> Result<UserGenreProfile> {
    let mut profile = build_genre_profile(pool).await?;
    profile.top_genres.truncate(limit as usize);
    Ok(profile)
}

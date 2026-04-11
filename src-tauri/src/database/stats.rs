// Stats Module
//
// Provides all aggregate queries for the /stats dashboard:
// summary cards, daily activity, genre distribution, completion rings,
// top content, streaks, activity patterns, and binge stats.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use anyhow::Result;
use chrono::Local;

use super::media::MediaEntry;

/// Estimated reading time per page in minutes.
const READING_MINUTES_PER_PAGE: f64 = 2.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchStatsSummary {
    pub total_time_seconds: f64,
    pub episodes_completed: i32,
    pub series_completed: i32,
    pub total_episodes_started: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingStatsSummary {
    pub total_chapters_completed: i32,
    pub total_pages_read: i32,
    pub series_completed: i32,
    pub total_chapters_started: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyActivity {
    pub date: String,
    pub watch_minutes: f64,
    pub read_minutes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreStat {
    pub genre: String,
    pub time_seconds: f64,
    pub count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionStatsCategory {
    pub watching: i32,
    pub completed: i32,
    pub on_hold: i32,
    pub dropped: i32,
    pub plan_to_watch: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionStats {
    pub anime: CompletionStatsCategory,
    pub manga: CompletionStatsCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopWatchedEntry {
    pub media: MediaEntry,
    pub total_time_seconds: f64,
    pub episodes_watched: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopReadEntry {
    pub media: MediaEntry,
    pub chapters_read: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreakStats {
    pub current_streak_days: i32,
    pub longest_streak_days: i32,
    pub longest_streak_start: String,
    pub longest_streak_end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityPatterns {
    pub most_active_day: String,
    pub avg_daily_minutes: f64,
    pub avg_daily_span_minutes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BingeStats {
    pub max_episodes_in_day: i32,
    pub max_episodes_anime_title: String,
    pub max_episodes_date: String,
    pub max_chapters_in_day: i32,
    pub max_chapters_manga_title: String,
    pub max_chapters_date: String,
}

// ==================== New Stats Types ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HourlyActivity {
    pub hour: i32,
    pub day_of_week: i32,
    pub minutes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRateStats {
    pub anime_started: i32,
    pub anime_completed: i32,
    pub anime_rate: f64,
    pub manga_started: i32,
    pub manga_completed: i32,
    pub manga_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreDistEntry {
    pub score: i32,
    pub count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreDistribution {
    pub entries: Vec<ScoreDistEntry>,
    pub average_score: f64,
    pub total_rated: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentTypeEntry {
    pub content_type: String,
    pub count: i32,
    pub time_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonEntry {
    pub season: String,
    pub year: i32,
    pub count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchCompletionRateStats {
    pub avg_completion_percent: f64,
    pub fully_watched_percent: f64,
    pub total_episodes: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoritesStats {
    pub total_favorites: i32,
    pub anime_favorites: i32,
    pub manga_favorites: i32,
    pub top_genres: Vec<String>,
    pub recent_favorite_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeToCompletion {
    pub avg_days: f64,
    pub fastest_title: String,
    pub fastest_days: f64,
    pub slowest_title: String,
    pub slowest_days: f64,
    pub total_completed: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YearDistEntry {
    pub year: i32,
    pub anime_count: i32,
    pub manga_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Milestone {
    pub id: String,
    pub title: String,
    pub description: String,
    pub achieved: bool,
    pub progress: f64,
    pub target: i32,
    pub current: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MilestoneStats {
    pub milestones: Vec<Milestone>,
    pub total_achieved: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyRecap {
    pub month: String,
    pub episodes_watched: i32,
    pub chapters_read: i32,
    pub time_watched_seconds: f64,
    pub new_series_started: i32,
    pub series_completed: i32,
    pub top_genre: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatingComparisonEntry {
    pub title: String,
    pub cover_url: Option<String>,
    pub user_score: f64,
    pub public_rating: f64,
    pub difference: f64,
}

pub async fn get_watch_stats_summary(pool: &SqlitePool) -> Result<WatchStatsSummary> {
    let row = sqlx::query(
        "SELECT
            COALESCE(SUM(progress_seconds), 0) as total_time,
            COUNT(CASE WHEN completed = 1 THEN 1 END) as eps_completed,
            COUNT(*) as eps_started
        FROM watch_history"
    )
    .fetch_one(pool)
    .await?;

    let series_row = sqlx::query(
        "SELECT COUNT(*) as cnt FROM library l
         JOIN media m ON l.media_id = m.id
         WHERE l.status = 'completed' AND m.media_type = 'anime'"
    )
    .fetch_one(pool)
    .await?;

    use sqlx::Row;
    Ok(WatchStatsSummary {
        total_time_seconds: row.get::<f64, _>("total_time"),
        episodes_completed: row.get::<i32, _>("eps_completed"),
        series_completed: series_row.get::<i32, _>("cnt"),
        total_episodes_started: row.get::<i32, _>("eps_started"),
    })
}

pub async fn get_reading_stats_summary(pool: &SqlitePool) -> Result<ReadingStatsSummary> {
    let row = sqlx::query(
        "SELECT
            COUNT(CASE WHEN completed = 1 THEN 1 END) as chapters_completed,
            COALESCE(SUM(CASE WHEN completed = 1 THEN COALESCE(total_pages, 0) ELSE current_page END), 0) as total_pages,
            COUNT(*) as chapters_started
        FROM reading_history"
    )
    .fetch_one(pool)
    .await?;

    let series_row = sqlx::query(
        "SELECT COUNT(*) as cnt FROM library l
         JOIN media m ON l.media_id = m.id
         WHERE l.status = 'completed' AND m.media_type = 'manga'"
    )
    .fetch_one(pool)
    .await?;

    use sqlx::Row;
    Ok(ReadingStatsSummary {
        total_chapters_completed: row.get::<i32, _>("chapters_completed"),
        total_pages_read: row.get::<i32, _>("total_pages"),
        series_completed: series_row.get::<i32, _>("cnt"),
        total_chapters_started: row.get::<i32, _>("chapters_started"),
    })
}

pub async fn get_daily_activity(pool: &SqlitePool, days: i32) -> Result<Vec<DailyActivity>> {
    log::info!("get_daily_activity called with days={}", days);

    // Single query: UNION ALL watch + read, aggregate per day
    let date_filter = if days > 0 {
        format!("WHERE day >= DATE('now', '-{} days')", days)
    } else {
        String::new()
    };

    let query = format!(
        "SELECT day, SUM(watch_min) as watch_minutes, SUM(read_min) as read_minutes
         FROM (
             SELECT DATE(last_watched) as day, progress_seconds / 60.0 as watch_min, 0.0 as read_min
             FROM watch_history WHERE last_watched IS NOT NULL
             UNION ALL
             SELECT DATE(last_read) as day, 0.0 as watch_min,
                 (CASE WHEN completed = 1 THEN COALESCE(total_pages, 0) ELSE current_page END) * {rpm} as read_min
             FROM reading_history WHERE last_read IS NOT NULL
         )
         WHERE day IS NOT NULL
         {filter}
         GROUP BY day ORDER BY day",
        rpm = READING_MINUTES_PER_PAGE,
        filter = if date_filter.is_empty() { String::new() } else { format!("AND day >= DATE('now', '-{} days')", days) }
    );

    log::info!("get_daily_activity query: {}", query);

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await?;

    log::info!("get_daily_activity got {} rows", rows.len());

    use sqlx::Row;
    let results: Vec<DailyActivity> = rows.iter().filter_map(|row| {
        let day: Option<String> = row.try_get("day").ok().flatten();
        day.map(|d| DailyActivity {
            date: d,
            watch_minutes: row.try_get("watch_minutes").unwrap_or(0.0),
            read_minutes: row.try_get("read_minutes").unwrap_or(0.0),
        })
    }).collect();

    log::info!("get_daily_activity returning {} entries", results.len());
    Ok(results)
}

pub async fn get_genre_stats(
    pool: &SqlitePool,
    media_type: Option<&str>,
) -> Result<Vec<GenreStat>> {
    let query_str = match media_type {
        Some("anime") => {
            "SELECT j.value as genre, SUM(w.progress_seconds) as time_seconds, COUNT(*) as count
             FROM watch_history w
             JOIN media m ON w.media_id = m.id, json_each(m.genres) j
             WHERE m.genres IS NOT NULL
             GROUP BY j.value ORDER BY time_seconds DESC LIMIT 10"
        }
        Some("manga") => {
            "SELECT j.value as genre,
                SUM(CASE WHEN r.completed = 1 THEN COALESCE(r.total_pages, 0) ELSE r.current_page END) * 120.0 as time_seconds,
                COUNT(*) as count
             FROM reading_history r
             JOIN media m ON r.media_id = m.id, json_each(m.genres) j
             WHERE m.genres IS NOT NULL
             GROUP BY j.value ORDER BY time_seconds DESC LIMIT 10"
        }
        _ => {
            "SELECT genre, SUM(time_seconds) as time_seconds, SUM(count) as count FROM (
                SELECT j.value as genre, SUM(w.progress_seconds) as time_seconds, COUNT(*) as count
                FROM watch_history w
                JOIN media m ON w.media_id = m.id, json_each(m.genres) j
                WHERE m.genres IS NOT NULL
                GROUP BY j.value
                UNION ALL
                SELECT j.value as genre,
                    SUM(CASE WHEN r.completed = 1 THEN COALESCE(r.total_pages, 0) ELSE r.current_page END) * 120.0 as time_seconds,
                    COUNT(*) as count
                FROM reading_history r
                JOIN media m ON r.media_id = m.id, json_each(m.genres) j
                WHERE m.genres IS NOT NULL
                GROUP BY j.value
            ) GROUP BY genre ORDER BY time_seconds DESC LIMIT 10"
        }
    };

    let rows = sqlx::query(query_str).fetch_all(pool).await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| GenreStat {
        genre: row.get("genre"),
        time_seconds: row.get("time_seconds"),
        count: row.get("count"),
    }).collect())
}

pub async fn get_completion_stats(pool: &SqlitePool) -> Result<CompletionStats> {
    let rows = sqlx::query(
        "SELECT m.media_type, l.status, COUNT(*) as cnt
         FROM library l
         JOIN media m ON l.media_id = m.id
         GROUP BY m.media_type, l.status"
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    let mut anime = CompletionStatsCategory { watching: 0, completed: 0, on_hold: 0, dropped: 0, plan_to_watch: 0 };
    let mut manga = CompletionStatsCategory { watching: 0, completed: 0, on_hold: 0, dropped: 0, plan_to_watch: 0 };

    for row in &rows {
        let media_type: String = row.get("media_type");
        let status: String = row.get("status");
        let cnt: i32 = row.get("cnt");

        let target = if media_type == "anime" { &mut anime } else { &mut manga };
        match status.as_str() {
            "watching" | "reading" => target.watching = cnt,
            "completed" => target.completed = cnt,
            "on_hold" => target.on_hold = cnt,
            "dropped" => target.dropped = cnt,
            "plan_to_watch" | "plan_to_read" => target.plan_to_watch = cnt,
            _ => {}
        }
    }

    Ok(CompletionStats { anime, manga })
}

pub async fn get_top_watched_anime(pool: &SqlitePool, limit: i32) -> Result<Vec<TopWatchedEntry>> {
    let rows = sqlx::query(
        "SELECT m.*, SUM(w.progress_seconds) as total_time, COUNT(*) as eps_watched
         FROM watch_history w
         JOIN media m ON w.media_id = m.id
         GROUP BY m.id
         ORDER BY total_time DESC
         LIMIT ?"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| TopWatchedEntry {
        media: MediaEntry {
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
        },
        total_time_seconds: row.get("total_time"),
        episodes_watched: row.get("eps_watched"),
    }).collect())
}

pub async fn get_top_read_manga(pool: &SqlitePool, limit: i32) -> Result<Vec<TopReadEntry>> {
    let rows = sqlx::query(
        "SELECT m.*, COUNT(CASE WHEN r.completed = 1 THEN 1 END) as chapters_read
         FROM reading_history r
         JOIN media m ON r.media_id = m.id
         GROUP BY m.id
         ORDER BY chapters_read DESC
         LIMIT ?"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| TopReadEntry {
        media: MediaEntry {
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
        },
        chapters_read: row.get("chapters_read"),
    }).collect())
}

pub async fn get_streak_stats(pool: &SqlitePool) -> Result<StreakStats> {
    // Get all unique active dates
    let rows = sqlx::query(
            "SELECT DISTINCT day FROM (
                SELECT DATE(last_watched) as day FROM watch_history
                UNION
                SELECT DATE(last_read) as day FROM reading_history
            ) ORDER BY day DESC"
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    use chrono::NaiveDateTime;

    let dates: Vec<String> = rows.iter()
        .filter_map(|r| r.get::<Option<String>, _>("day"))
        .collect();

    if dates.is_empty() {
        return Ok(StreakStats {
            current_streak_days: 0,
            longest_streak_days: 0,
            longest_streak_start: String::new(),
            longest_streak_end: String::new(),
        });
    }

    let today = Local::now().format("%Y-%m-%d").to_string();

    // Calculate current streak (from today or yesterday backwards)
    let mut current_streak = 0i32;
    let first_date = &dates[0];
    let is_today = first_date == &today;
    let is_yesterday = {
        let yesterday = (Local::now() - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
        first_date == &yesterday
    };

    if is_today || is_yesterday {
        current_streak = 1;
        for i in 1..dates.len() {
            let prev = NaiveDateTime::parse_from_str(&format!("{} 00:00:00", dates[i-1]), "%Y-%m-%d %H:%M:%S");
            let curr = NaiveDateTime::parse_from_str(&format!("{} 00:00:00", dates[i]), "%Y-%m-%d %H:%M:%S");
            if let (Ok(p), Ok(c)) = (prev, curr) {
                if (p - c).num_days() == 1 {
                    current_streak += 1;
                } else {
                    break;
                }
            }
        }
    }

    // Calculate longest streak
    let mut longest = 1i32;
    let mut longest_start = dates.last().cloned().unwrap_or_default();
    let mut longest_end = dates.first().cloned().unwrap_or_default();
    let mut streak = 1i32;
    let mut streak_start_idx = 0usize;

    for i in 1..dates.len() {
        let prev = NaiveDateTime::parse_from_str(&format!("{} 00:00:00", dates[i-1]), "%Y-%m-%d %H:%M:%S");
        let curr = NaiveDateTime::parse_from_str(&format!("{} 00:00:00", dates[i]), "%Y-%m-%d %H:%M:%S");
        if let (Ok(p), Ok(c)) = (prev, curr) {
            if (p - c).num_days() == 1 {
                streak += 1;
            } else {
                if streak > longest {
                    longest = streak;
                    longest_end = dates[streak_start_idx].clone();
                    longest_start = dates[i - 1].clone();
                }
                streak = 1;
                streak_start_idx = i;
            }
        }
    }
    if streak > longest {
        longest = streak;
        longest_end = dates[streak_start_idx].clone();
        longest_start = dates[dates.len() - 1].clone();
    }

    Ok(StreakStats {
        current_streak_days: current_streak,
        longest_streak_days: longest,
        longest_streak_start: longest_start,
        longest_streak_end: longest_end,
    })
}

pub async fn get_activity_patterns(pool: &SqlitePool) -> Result<ActivityPatterns> {
    // Most active day of week
    let dow_rows = sqlx::query(
        &format!(
            "SELECT day_of_week, AVG(total_minutes) as avg_min FROM (
                SELECT strftime('%w', day) as day_of_week, SUM(minutes) as total_minutes FROM (
                    SELECT DATE(last_watched) as day, SUM(progress_seconds) / 60.0 as minutes
                    FROM watch_history GROUP BY day
                    UNION ALL
                    SELECT DATE(last_read) as day,
                        SUM(CASE WHEN completed = 1 THEN COALESCE(total_pages, 0) ELSE current_page END) * {} as minutes
                    FROM reading_history GROUP BY day
                ) GROUP BY day
            ) GROUP BY day_of_week ORDER BY avg_min DESC LIMIT 1",
            READING_MINUTES_PER_PAGE
        )
    )
    .fetch_optional(pool)
    .await?;

    use sqlx::Row;
    let most_active_day = match dow_rows {
        Some(ref row) => {
            let dow: String = row.get("day_of_week");
            let day_name = match dow.as_str() {
                "0" => "Sunday", "1" => "Monday", "2" => "Tuesday",
                "3" => "Wednesday", "4" => "Thursday", "5" => "Friday",
                "6" => "Saturday", _ => "Unknown"
            };
            day_name.to_string()
        }
        None => "None".to_string(),
    };

    // Average daily minutes (across all active days)
    let avg_row = sqlx::query(
        &format!(
            "SELECT AVG(total_minutes) as avg_min FROM (
                SELECT SUM(minutes) as total_minutes FROM (
                    SELECT DATE(last_watched) as day, SUM(progress_seconds) / 60.0 as minutes
                    FROM watch_history GROUP BY day
                    UNION ALL
                    SELECT DATE(last_read) as day,
                        SUM(CASE WHEN completed = 1 THEN COALESCE(total_pages, 0) ELSE current_page END) * {} as minutes
                    FROM reading_history GROUP BY day
                ) GROUP BY day
            )",
            READING_MINUTES_PER_PAGE
        )
    )
    .fetch_one(pool)
    .await?;

    let avg_daily: f64 = avg_row.try_get("avg_min").unwrap_or(0.0);

    Ok(ActivityPatterns {
        most_active_day,
        avg_daily_minutes: avg_daily,
        avg_daily_span_minutes: 0.0, // Simplified: would require min/max timestamp per day
    })
}

pub async fn get_binge_stats(pool: &SqlitePool) -> Result<BingeStats> {
    // Most episodes in a single day
    let ep_row = sqlx::query(
            "SELECT m.title, DATE(w.last_watched) as day, COUNT(*) as cnt
            FROM watch_history w
            JOIN media m ON w.media_id = m.id
            GROUP BY m.id, day
            ORDER BY cnt DESC LIMIT 1"
    )
    .fetch_optional(pool)
    .await?;

    // Most chapters in a single day
    let ch_row = sqlx::query(
            "SELECT m.title, DATE(r.last_read) as day, COUNT(*) as cnt
            FROM reading_history r
            JOIN media m ON r.media_id = m.id
            GROUP BY m.id, day
            ORDER BY cnt DESC LIMIT 1"
    )
    .fetch_optional(pool)
    .await?;

    use sqlx::Row;
    Ok(BingeStats {
        max_episodes_in_day: ep_row.as_ref().map(|r| r.get::<i32, _>("cnt")).unwrap_or(0),
        max_episodes_anime_title: ep_row.as_ref().map(|r| r.get::<String, _>("title")).unwrap_or_default(),
        max_episodes_date: ep_row.as_ref().map(|r| r.get::<String, _>("day")).unwrap_or_default(),
        max_chapters_in_day: ch_row.as_ref().map(|r| r.get::<i32, _>("cnt")).unwrap_or(0),
        max_chapters_manga_title: ch_row.as_ref().map(|r| r.get::<String, _>("title")).unwrap_or_default(),
        max_chapters_date: ch_row.as_ref().map(|r| r.get::<String, _>("day")).unwrap_or_default(),
    })
}

// ==================== New Stats Functions ====================

pub async fn get_peak_hours(pool: &SqlitePool) -> Result<Vec<HourlyActivity>> {
    let rows = sqlx::query(
        &format!(
            "SELECT hour, day_of_week, SUM(minutes) as minutes FROM (
                SELECT CAST(strftime('%H', last_watched) AS INTEGER) as hour,
                    CAST(strftime('%w', last_watched) AS INTEGER) as day_of_week,
                    progress_seconds / 60.0 as minutes
                FROM watch_history WHERE last_watched IS NOT NULL
                UNION ALL
                SELECT CAST(strftime('%H', last_read) AS INTEGER) as hour,
                    CAST(strftime('%w', last_read) AS INTEGER) as day_of_week,
                    (CASE WHEN completed = 1 THEN COALESCE(total_pages, 0) ELSE current_page END) * {} as minutes
                FROM reading_history WHERE last_read IS NOT NULL
            ) GROUP BY hour, day_of_week",
            READING_MINUTES_PER_PAGE
        )
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| HourlyActivity {
        hour: row.get("hour"),
        day_of_week: row.get("day_of_week"),
        minutes: row.get("minutes"),
    }).collect())
}

pub async fn get_completion_rate(pool: &SqlitePool) -> Result<CompletionRateStats> {
    let row = sqlx::query(
        "SELECT
            (SELECT COUNT(DISTINCT media_id) FROM watch_history) as anime_started,
            (SELECT COUNT(*) FROM library l JOIN media m ON l.media_id = m.id
             WHERE l.status = 'completed' AND m.media_type = 'anime') as anime_completed,
            (SELECT COUNT(DISTINCT media_id) FROM reading_history) as manga_started,
            (SELECT COUNT(*) FROM library l JOIN media m ON l.media_id = m.id
             WHERE l.status = 'completed' AND m.media_type = 'manga') as manga_completed"
    )
    .fetch_one(pool)
    .await?;

    use sqlx::Row;
    let anime_started: i32 = row.get("anime_started");
    let anime_completed: i32 = row.get("anime_completed");
    let manga_started: i32 = row.get("manga_started");
    let manga_completed: i32 = row.get("manga_completed");

    Ok(CompletionRateStats {
        anime_started,
        anime_completed,
        anime_rate: if anime_started > 0 { anime_completed as f64 / anime_started as f64 * 100.0 } else { 0.0 },
        manga_started,
        manga_completed,
        manga_rate: if manga_started > 0 { manga_completed as f64 / manga_started as f64 * 100.0 } else { 0.0 },
    })
}

pub async fn get_score_distribution(pool: &SqlitePool) -> Result<ScoreDistribution> {
    let rows = sqlx::query(
        "SELECT CAST(l.score AS INTEGER) as score, COUNT(*) as count
         FROM library l
         WHERE l.score > 0
         GROUP BY CAST(l.score AS INTEGER)
         ORDER BY score"
    )
    .fetch_all(pool)
    .await?;

    let avg_row = sqlx::query(
        "SELECT COALESCE(AVG(CAST(l.score AS REAL)), 0) as avg_score,
                COUNT(*) as total
         FROM library l WHERE l.score > 0"
    )
    .fetch_one(pool)
    .await?;

    use sqlx::Row;
    let entries: Vec<ScoreDistEntry> = rows.iter().map(|row| ScoreDistEntry {
        score: row.get("score"),
        count: row.get("count"),
    }).collect();

    Ok(ScoreDistribution {
        entries,
        average_score: avg_row.get("avg_score"),
        total_rated: avg_row.get("total"),
    })
}

pub async fn get_content_type_breakdown(pool: &SqlitePool) -> Result<Vec<ContentTypeEntry>> {
    let rows = sqlx::query(
        "SELECT
            COALESCE(m.content_type, 'Unknown') as content_type,
            COUNT(DISTINCT m.id) as count,
            COALESCE(SUM(w_time.total_time), 0) as time_seconds
         FROM library l
         JOIN media m ON l.media_id = m.id
         LEFT JOIN (
             SELECT media_id, SUM(progress_seconds) as total_time
             FROM watch_history GROUP BY media_id
         ) w_time ON w_time.media_id = m.id
         WHERE m.media_type = 'anime'
         GROUP BY COALESCE(m.content_type, 'Unknown')
         ORDER BY count DESC"
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| ContentTypeEntry {
        content_type: row.get("content_type"),
        count: row.get("count"),
        time_seconds: row.get("time_seconds"),
    }).collect())
}

pub async fn get_seasonal_trends(pool: &SqlitePool) -> Result<Vec<SeasonEntry>> {
    let rows = sqlx::query(
        "SELECT
            COALESCE(m.season_quarter, 'unknown') as season,
            COALESCE(m.season_year, m.year, 0) as year,
            COUNT(*) as count
         FROM library l
         JOIN media m ON l.media_id = m.id
         WHERE m.media_type = 'anime'
           AND (m.season_quarter IS NOT NULL OR m.season_year IS NOT NULL)
         GROUP BY season, year
         ORDER BY year DESC,
            CASE LOWER(COALESCE(m.season_quarter, ''))
                WHEN 'winter' THEN 1
                WHEN 'spring' THEN 2
                WHEN 'summer' THEN 3
                WHEN 'fall' THEN 4
                ELSE 5
            END DESC
         LIMIT 20"
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| SeasonEntry {
        season: row.get("season"),
        year: row.get("year"),
        count: row.get("count"),
    }).collect())
}

pub async fn get_watch_completion_rate(pool: &SqlitePool) -> Result<WatchCompletionRateStats> {
    let row = sqlx::query(
        "SELECT
            COALESCE(AVG(CASE WHEN duration > 0 THEN (progress_seconds * 100.0 / duration) ELSE NULL END), 0) as avg_pct,
            COALESCE(
                COUNT(CASE WHEN duration > 0 AND progress_seconds >= duration * 0.9 THEN 1 END) * 100.0
                / NULLIF(COUNT(CASE WHEN duration > 0 THEN 1 END), 0),
            0) as fully_pct,
            COUNT(*) as total
         FROM watch_history"
    )
    .fetch_one(pool)
    .await?;

    use sqlx::Row;
    Ok(WatchCompletionRateStats {
        avg_completion_percent: row.get("avg_pct"),
        fully_watched_percent: row.get("fully_pct"),
        total_episodes: row.get("total"),
    })
}

pub async fn get_favorites_stats(pool: &SqlitePool) -> Result<FavoritesStats> {
    let counts = sqlx::query(
        "SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN m.media_type = 'anime' THEN 1 END) as anime_fav,
            COUNT(CASE WHEN m.media_type = 'manga' THEN 1 END) as manga_fav
         FROM library l
         JOIN media m ON l.media_id = m.id
         WHERE l.favorite = 1"
    )
    .fetch_one(pool)
    .await?;

    let genre_rows = sqlx::query(
        "SELECT j.value as genre
         FROM library l
         JOIN media m ON l.media_id = m.id, json_each(m.genres) j
         WHERE l.favorite = 1 AND m.genres IS NOT NULL
         GROUP BY j.value
         ORDER BY COUNT(*) DESC
         LIMIT 5"
    )
    .fetch_all(pool)
    .await?;

    let recent = sqlx::query(
        "SELECT m.title FROM library l
         JOIN media m ON l.media_id = m.id
         WHERE l.favorite = 1
         ORDER BY l.updated_at DESC LIMIT 1"
    )
    .fetch_optional(pool)
    .await?;

    use sqlx::Row;
    Ok(FavoritesStats {
        total_favorites: counts.get("total"),
        anime_favorites: counts.get("anime_fav"),
        manga_favorites: counts.get("manga_fav"),
        top_genres: genre_rows.iter().map(|r| r.get::<String, _>("genre")).collect(),
        recent_favorite_title: recent.map(|r| r.get::<String, _>("title")),
    })
}

pub async fn get_time_to_completion(pool: &SqlitePool) -> Result<TimeToCompletion> {
    let rows = sqlx::query(
        "SELECT
            m.title,
            JULIANDAY(MAX(w.last_watched)) - JULIANDAY(MIN(w.last_watched)) as days_to_complete
         FROM watch_history w
         JOIN media m ON w.media_id = m.id
         JOIN library l ON l.media_id = m.id AND l.status = 'completed'
         GROUP BY m.id
         HAVING COUNT(*) > 1 AND days_to_complete >= 0
         ORDER BY days_to_complete"
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    if rows.is_empty() {
        return Ok(TimeToCompletion {
            avg_days: 0.0, fastest_title: String::new(), fastest_days: 0.0,
            slowest_title: String::new(), slowest_days: 0.0, total_completed: 0,
        });
    }

    let total = rows.len() as i32;
    let avg: f64 = rows.iter().map(|r| r.get::<f64, _>("days_to_complete")).sum::<f64>() / total as f64;
    let fastest = &rows[0];
    let slowest = &rows[rows.len() - 1];

    Ok(TimeToCompletion {
        avg_days: avg,
        fastest_title: fastest.get("title"),
        fastest_days: fastest.get("days_to_complete"),
        slowest_title: slowest.get("title"),
        slowest_days: slowest.get("days_to_complete"),
        total_completed: total,
    })
}

pub async fn get_year_distribution(pool: &SqlitePool) -> Result<Vec<YearDistEntry>> {
    let rows = sqlx::query(
        "SELECT
            COALESCE(m.year, m.aired_start_year) as release_year,
            COUNT(CASE WHEN m.media_type = 'anime' THEN 1 END) as anime_count,
            COUNT(CASE WHEN m.media_type = 'manga' THEN 1 END) as manga_count
         FROM library l
         JOIN media m ON l.media_id = m.id
         WHERE COALESCE(m.year, m.aired_start_year) IS NOT NULL
         GROUP BY release_year
         ORDER BY release_year"
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| YearDistEntry {
        year: row.get("release_year"),
        anime_count: row.get("anime_count"),
        manga_count: row.get("manga_count"),
    }).collect())
}

fn make_milestone(id: &str, title: &str, description: &str, current: i32, target: i32) -> Milestone {
    Milestone {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        achieved: current >= target,
        progress: (current as f64 / target as f64).min(1.0),
        target,
        current,
    }
}

pub async fn get_milestones(pool: &SqlitePool) -> Result<MilestoneStats> {
    use sqlx::Row;

    let ep_count: i32 = sqlx::query("SELECT COUNT(*) as cnt FROM watch_history WHERE completed = 1")
        .fetch_one(pool).await?.get("cnt");
    let ch_count: i32 = sqlx::query("SELECT COUNT(*) as cnt FROM reading_history WHERE completed = 1")
        .fetch_one(pool).await?.get("cnt");
    let series_count: i32 = sqlx::query("SELECT COUNT(*) as cnt FROM library WHERE status = 'completed'")
        .fetch_one(pool).await?.get("cnt");
    let genre_count: i32 = sqlx::query(
        "SELECT COUNT(DISTINCT j.value) as cnt FROM library l
         JOIN media m ON l.media_id = m.id, json_each(m.genres) j
         WHERE m.genres IS NOT NULL"
    ).fetch_one(pool).await?.get("cnt");

    let milestones = vec![
        make_milestone("ep_10", "First Steps", "Watch 10 episodes", ep_count, 10),
        make_milestone("ep_100", "Century Club", "Watch 100 episodes", ep_count, 100),
        make_milestone("ep_500", "Seasoned Viewer", "Watch 500 episodes", ep_count, 500),
        make_milestone("ep_1000", "Otaku Legend", "Watch 1,000 episodes", ep_count, 1000),
        make_milestone("ch_50", "Bookworm", "Read 50 chapters", ch_count, 50),
        make_milestone("ch_500", "Manga Master", "Read 500 chapters", ch_count, 500),
        make_milestone("series_5", "Getting Started", "Complete 5 series", series_count, 5),
        make_milestone("series_25", "Dedicated Fan", "Complete 25 series", series_count, 25),
        make_milestone("series_100", "Completionist", "Complete 100 series", series_count, 100),
        make_milestone("genre_10", "Genre Explorer", "Explore 10 different genres", genre_count, 10),
    ];

    let total_achieved = milestones.iter().filter(|m| m.achieved).count() as i32;
    Ok(MilestoneStats { milestones, total_achieved })
}

pub async fn get_monthly_recap(pool: &SqlitePool) -> Result<MonthlyRecap> {
    let month_str = Local::now().format("%Y-%m").to_string();
    let month_display = Local::now().format("%B %Y").to_string();

    use sqlx::Row;

    let watch_row = sqlx::query(
        "SELECT COUNT(*) as eps_watched,
                COALESCE(SUM(progress_seconds), 0) as time_seconds
         FROM watch_history
         WHERE strftime('%Y-%m', last_watched) = ?"
    ).bind(&month_str).fetch_one(pool).await?;

    let read_row = sqlx::query(
        "SELECT COUNT(*) as chapters_read
         FROM reading_history
         WHERE strftime('%Y-%m', last_read) = ?"
    ).bind(&month_str).fetch_one(pool).await?;

    let new_series_row = sqlx::query(
        "SELECT COUNT(*) as cnt FROM (
            SELECT media_id FROM watch_history
            GROUP BY media_id
            HAVING strftime('%Y-%m', MIN(last_watched)) = ?
            UNION
            SELECT media_id FROM reading_history
            GROUP BY media_id
            HAVING strftime('%Y-%m', MIN(last_read)) = ?
        )"
    ).bind(&month_str).bind(&month_str).fetch_one(pool).await?;

    let completed_row = sqlx::query(
        "SELECT COUNT(*) as cnt FROM library l
         WHERE l.status = 'completed' AND strftime('%Y-%m', l.updated_at) = ?"
    ).bind(&month_str).fetch_one(pool).await?;

    let genre_row = sqlx::query(
        "SELECT j.value as genre, COUNT(*) as cnt
         FROM watch_history w
         JOIN media m ON w.media_id = m.id, json_each(m.genres) j
         WHERE strftime('%Y-%m', w.last_watched) = ? AND m.genres IS NOT NULL
         GROUP BY j.value ORDER BY cnt DESC LIMIT 1"
    ).bind(&month_str).fetch_optional(pool).await?;

    Ok(MonthlyRecap {
        month: month_display,
        episodes_watched: watch_row.get("eps_watched"),
        chapters_read: read_row.get("chapters_read"),
        time_watched_seconds: watch_row.get("time_seconds"),
        new_series_started: new_series_row.get("cnt"),
        series_completed: completed_row.get("cnt"),
        top_genre: genre_row.map(|r| r.get::<String, _>("genre")).unwrap_or_default(),
    })
}

pub async fn get_rating_comparison(pool: &SqlitePool) -> Result<Vec<RatingComparisonEntry>> {
    let rows = sqlx::query(
        "SELECT m.title, m.cover_url,
                CAST(l.score AS REAL) as user_score,
                CAST(m.rating AS REAL) as public_rating,
                (CAST(l.score AS REAL) - CAST(m.rating AS REAL)) as difference
         FROM library l
         JOIN media m ON l.media_id = m.id
         WHERE l.score > 0 AND m.rating IS NOT NULL AND CAST(m.rating AS REAL) > 0
         ORDER BY ABS(CAST(l.score AS REAL) - CAST(m.rating AS REAL)) DESC
         LIMIT 10"
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| RatingComparisonEntry {
        title: row.get("title"),
        cover_url: row.get("cover_url"),
        user_score: row.get("user_score"),
        public_rating: row.get("public_rating"),
        difference: row.get("difference"),
    }).collect())
}

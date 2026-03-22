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
    // Use SQLite's built-in 'localtime' modifier to convert UTC to system local time

    // Watch minutes per day (using local date)
    let watch_rows = sqlx::query(
        &format!(
            "SELECT DATE(last_watched, 'localtime') as day, SUM(progress_seconds) / 60.0 as minutes
            FROM watch_history
            WHERE DATE(last_watched, 'localtime') >= DATE('now', 'localtime', '-{} days')
            GROUP BY day ORDER BY day",
            days
        )
    )
    .fetch_all(pool)
    .await?;

    // Read minutes per day (estimated from pages)
    let read_rows = sqlx::query(
        &format!(
            "SELECT DATE(last_read, 'localtime') as day,
                SUM(CASE WHEN completed = 1 THEN COALESCE(total_pages, 0) ELSE current_page END) * {} as minutes
            FROM reading_history
            WHERE DATE(last_read, 'localtime') >= DATE('now', 'localtime', '-{} days')
            GROUP BY day ORDER BY day",
            READING_MINUTES_PER_PAGE, days
        )
    )
    .fetch_all(pool)
    .await?;

    // Merge watch and read data into a single timeline
    use std::collections::BTreeMap;
    use sqlx::Row;
    let mut day_map: BTreeMap<String, DailyActivity> = BTreeMap::new();

    for row in &watch_rows {
        let day: String = row.get("day");
        let minutes: f64 = row.get("minutes");
        day_map.entry(day.clone()).or_insert(DailyActivity {
            date: day,
            watch_minutes: 0.0,
            read_minutes: 0.0,
        }).watch_minutes = minutes;
    }

    for row in &read_rows {
        let day: String = row.get("day");
        let minutes: f64 = row.get("minutes");
        day_map.entry(day.clone()).or_insert(DailyActivity {
            date: day,
            watch_minutes: 0.0,
            read_minutes: 0.0,
        }).read_minutes = minutes;
    }

    Ok(day_map.into_values().collect())
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
    // Get all unique active dates in local timezone
    // Use SQLite's built-in 'localtime' modifier to convert UTC to system local time

    let rows = sqlx::query(
            "SELECT DISTINCT day FROM (
                SELECT DATE(last_watched, 'localtime') as day FROM watch_history
                UNION
                SELECT DATE(last_read, 'localtime') as day FROM reading_history
            ) ORDER BY day DESC"
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    use chrono::NaiveDateTime;

    let dates: Vec<String> = rows.iter().map(|r| r.get::<String, _>("day")).collect();

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
    // Use SQLite's built-in 'localtime' modifier to convert UTC to system local time

    // Most active day of week
    let dow_rows = sqlx::query(
        &format!(
            "SELECT day_of_week, AVG(total_minutes) as avg_min FROM (
                SELECT strftime('%w', day) as day_of_week, SUM(minutes) as total_minutes FROM (
                    SELECT DATE(last_watched, 'localtime') as day, SUM(progress_seconds) / 60.0 as minutes
                    FROM watch_history GROUP BY day
                    UNION ALL
                    SELECT DATE(last_read, 'localtime') as day,
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
                    SELECT DATE(last_watched, 'localtime') as day, SUM(progress_seconds) / 60.0 as minutes
                    FROM watch_history GROUP BY day
                    UNION ALL
                    SELECT DATE(last_read, 'localtime') as day,
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
    // Use SQLite's built-in 'localtime' modifier to convert UTC to system local time

    // Most episodes in a single day
    let ep_row = sqlx::query(
            "SELECT m.title, DATE(w.last_watched, 'localtime') as day, COUNT(*) as cnt
            FROM watch_history w
            JOIN media m ON w.media_id = m.id
            GROUP BY m.id, day
            ORDER BY cnt DESC LIMIT 1"
    )
    .fetch_optional(pool)
    .await?;

    // Most chapters in a single day
    let ch_row = sqlx::query(
            "SELECT m.title, DATE(r.last_read, 'localtime') as day, COUNT(*) as cnt
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

// Database Module - SQLite integration
//
// Handles:
// - SQLite connection pool (sqlx)
// - Database migrations
// - CRUD operations for media, episodes, watch history, library, downloads
// - Tracker account storage

use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, SqlitePool, Row};
use std::path::PathBuf;
use anyhow::{Result, Context};

pub mod watch_history;
pub mod reading_history;
pub mod library;
pub mod media;
pub mod tags;
pub mod export_import;

/// Database manager with connection pooling
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    /// Initialize database with connection pooling
    pub async fn new(db_path: PathBuf) -> Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .context("Failed to create database directory")?;
        }

        log::debug!("Initializing database at: {:?}", db_path);

        // Configure SQLite connection options
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            // Enable WAL mode for concurrent reads
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            // Enable foreign key constraints
            .foreign_keys(true);

        // Create connection pool
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .context("Failed to create database pool")?;

        log::debug!("Database connection pool created");

        let db = Self { pool };

        // Run migrations
        db.run_migrations().await?;

        log::debug!("Database initialized successfully");

        Ok(db)
    }

    /// Run database migrations
    async fn run_migrations(&self) -> Result<()> {
        log::debug!("Running database migrations");

        // Create migrations tracking table if it doesn't exist
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            "#
        )
        .execute(&self.pool)
        .await
        .context("Failed to create migrations tracking table")?;

        // Read and run migration files in order
        let migrations = [
            ("001_initial.sql", include_str!("../../migrations/001_initial.sql")),
            ("002_fix_watch_history.sql", include_str!("../../migrations/002_fix_watch_history.sql")),
            ("003_rename_current_time.sql", include_str!("../../migrations/003_rename_current_time.sql")),
            ("004_downloads_table.sql", include_str!("../../migrations/004_downloads_table.sql")),
            ("005_fix_column_rename.sql", include_str!("../../migrations/005_fix_column_rename.sql")),
            ("006_fix_downloads_table.sql", include_str!("../../migrations/006_fix_downloads_table.sql")),
            ("007_reading_history.sql", include_str!("../../migrations/007_reading_history.sql")),
            ("008_add_manga_library_statuses.sql", include_str!("../../migrations/008_add_manga_library_statuses.sql")),
            ("009_notifications.sql", include_str!("../../migrations/009_notifications.sql")),
            ("010_app_settings.sql", include_str!("../../migrations/010_app_settings.sql")),
            ("011_release_tracking.sql", include_str!("../../migrations/011_release_tracking.sql")),
            ("012_library_tags.sql", include_str!("../../migrations/012_library_tags.sql")),
            ("013_release_tracking_v2.sql", include_str!("../../migrations/013_release_tracking_v2.sql")),
        ];

        for (name, migration_sql) in migrations {
            // Check if migration has already been run
            let already_run: bool = sqlx::query(
                "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = ?)"
            )
            .bind(name)
            .fetch_one(&self.pool)
            .await?
            .try_get(0)?;

            if already_run {
                log::debug!("Migration already applied: {}", name);
                continue;
            }

            log::debug!("Running migration: {}", name);

            // Run the migration
            sqlx::raw_sql(migration_sql)
                .execute(&self.pool)
                .await
                .with_context(|| format!("Failed to run migration: {}", name))?;

            // Record migration as completed
            sqlx::query("INSERT INTO _migrations (name) VALUES (?)")
                .bind(name)
                .execute(&self.pool)
                .await
                .with_context(|| format!("Failed to record migration: {}", name))?;

            log::debug!("Migration completed: {}", name);
        }

        log::debug!("All migrations completed successfully");

        Ok(())
    }

    /// Get a reference to the connection pool
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Check if database connection is healthy
    #[allow(dead_code)]
    pub async fn health_check(&self) -> Result<bool> {
        let result: i32 = sqlx::query("SELECT 1")
            .fetch_one(&self.pool)
            .await?
            .try_get(0)?;

        Ok(result == 1)
    }

    /// Get database file size in bytes
    pub async fn get_database_size(&self) -> Result<u64> {
        let size: i64 = sqlx::query_scalar("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()")
            .fetch_one(&self.pool)
            .await?;

        Ok(size as u64)
    }

    /// Optimize database (vacuum and analyze)
    pub async fn optimize(&self) -> Result<()> {
        log::debug!("Optimizing database");

        sqlx::query("VACUUM")
            .execute(&self.pool)
            .await
            .context("Failed to vacuum database")?;

        sqlx::query("ANALYZE")
            .execute(&self.pool)
            .await
            .context("Failed to analyze database")?;

        log::debug!("Database optimization completed");

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_database_initialization() {
        let temp_dir = tempdir().unwrap();
        let db_path = temp_dir.path().join("test.db");

        let db = Database::new(db_path).await.unwrap();

        assert!(db.health_check().await.unwrap());
    }

    #[tokio::test]
    async fn test_database_size() {
        let temp_dir = tempdir().unwrap();
        let db_path = temp_dir.path().join("test.db");

        let db = Database::new(db_path).await.unwrap();
        let size = db.get_database_size().await.unwrap();

        assert!(size > 0);
    }
}

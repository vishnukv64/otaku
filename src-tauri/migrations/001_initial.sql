-- Initial database schema for Otaku anime/manga viewer

-- Media table: Stores anime/manga metadata
CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY NOT NULL,
    extension_id TEXT NOT NULL,
    title TEXT NOT NULL,
    english_name TEXT,
    native_name TEXT,
    description TEXT,
    cover_url TEXT,
    banner_url TEXT,
    trailer_url TEXT,
    media_type TEXT CHECK(media_type IN ('anime', 'manga')) NOT NULL,
    content_type TEXT, -- TV, ONA, OVA, Movie, Special, Manga, Manhwa, etc.
    status TEXT, -- Ongoing, Completed, etc.
    year INTEGER,
    rating REAL,
    episode_count INTEGER,
    episode_duration INTEGER, -- in milliseconds
    season_quarter TEXT, -- Spring, Summer, Fall, Winter
    season_year INTEGER,
    aired_start_year INTEGER,
    aired_start_month INTEGER,
    aired_start_date INTEGER,
    genres TEXT, -- JSON array of genre strings
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
CREATE INDEX IF NOT EXISTS idx_media_extension ON media(extension_id);
CREATE INDEX IF NOT EXISTS idx_media_updated ON media(updated_at DESC);

-- Episodes table: Stores episode information
CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY NOT NULL,
    media_id TEXT NOT NULL,
    extension_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT,
    description TEXT,
    thumbnail_url TEXT,
    aired_date TEXT,
    duration INTEGER, -- in seconds
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_episodes_media ON episodes(media_id, number);

-- Watch history: Tracks video playback progress
CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    episode_number INTEGER NOT NULL,
    current_time REAL NOT NULL DEFAULT 0, -- in seconds
    duration REAL, -- total episode duration in seconds
    completed BOOLEAN NOT NULL DEFAULT 0,
    last_watched TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
    UNIQUE(media_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_watch_history_media ON watch_history(media_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_last_watched ON watch_history(last_watched DESC);
CREATE INDEX IF NOT EXISTS idx_watch_history_episode ON watch_history(episode_id);

-- Library: User's media collection
CREATE TABLE IF NOT EXISTS library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch')) DEFAULT 'plan_to_watch',
    favorite BOOLEAN NOT NULL DEFAULT 0,
    score REAL, -- User rating 0-10
    notes TEXT,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_library_status ON library(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_favorite ON library(favorite, updated_at DESC);

-- Downloads: Tracks downloaded episodes/chapters
CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL,
    episode_id TEXT,
    chapter_id TEXT,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0, -- in bytes
    download_status TEXT NOT NULL CHECK(download_status IN ('queued', 'downloading', 'paused', 'completed', 'failed')) DEFAULT 'queued',
    progress REAL NOT NULL DEFAULT 0, -- 0-100 percentage
    speed INTEGER DEFAULT 0, -- bytes per second
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_downloads_media ON downloads(media_id);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(download_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_downloads_episode ON downloads(episode_id);

-- Tracker accounts: AniList OAuth credentials
CREATE TABLE IF NOT EXISTS tracker_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracker_name TEXT NOT NULL UNIQUE CHECK(tracker_name IN ('anilist')),
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tracker mappings: Maps local media to tracker IDs
CREATE TABLE IF NOT EXISTS tracker_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL,
    tracker_name TEXT NOT NULL CHECK(tracker_name IN ('anilist')),
    tracker_media_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    UNIQUE(media_id, tracker_name)
);

CREATE INDEX IF NOT EXISTS idx_tracker_mappings_media ON tracker_mappings(media_id);
CREATE INDEX IF NOT EXISTS idx_tracker_mappings_tracker ON tracker_mappings(tracker_name, tracker_media_id);

-- Extensions: Installed extension metadata
CREATE TABLE IF NOT EXISTS extensions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    extension_type TEXT CHECK(extension_type IN ('anime', 'manga')) NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    enabled BOOLEAN NOT NULL DEFAULT 1,
    code TEXT NOT NULL, -- Extension JavaScript code
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extensions_type ON extensions(extension_type, enabled);
CREATE INDEX IF NOT EXISTS idx_extensions_enabled ON extensions(enabled);

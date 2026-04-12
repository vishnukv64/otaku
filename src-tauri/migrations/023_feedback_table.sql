-- User feedback (thumbs up/down) for improving recommendations
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL UNIQUE,
    sentiment TEXT NOT NULL CHECK(sentiment IN ('liked', 'disliked')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feedback_sentiment ON feedback(sentiment);

-- Pair & sync (phone <-> Mac). Triggers are created by sync::store::init.
CREATE TABLE IF NOT EXISTS paired_devices (
    id TEXT PRIMARY KEY,                 -- peer device id
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK(role IN ('mac', 'phone')), -- what the PEER is
    room_id TEXT NOT NULL,
    room_key TEXT NOT NULL,              -- base64url, 32 bytes
    write_token TEXT NOT NULL DEFAULT '',-- base64url, 16 bytes
    relay_url TEXT NOT NULL DEFAULT '',
    relay_token TEXT NOT NULL DEFAULT '',-- phone: token handed over in the QR
    lan_addr TEXT NOT NULL DEFAULT '',
    sync_progress INTEGER NOT NULL DEFAULT 1,
    sync_library INTEGER NOT NULL DEFAULT 1,
    sync_reading INTEGER NOT NULL DEFAULT 1,
    acked_seq INTEGER NOT NULL DEFAULT 0, -- highest local sync_changes.seq the peer acked
    items_in INTEGER NOT NULL DEFAULT 0,
    items_out INTEGER NOT NULL DEFAULT 0,
    last_synced TEXT,
    paired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- hlc/device_id are NULL until the engine stamps a trigger-written row.
CREATE TABLE IF NOT EXISTS sync_changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    tbl TEXT NOT NULL,
    key TEXT NOT NULL,
    payload TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    hlc INTEGER,
    device_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_changes_key ON sync_changes(tbl, key);

CREATE TABLE IF NOT EXISTS sync_ctl (applying INTEGER NOT NULL DEFAULT 0);
INSERT INTO sync_ctl (applying) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM sync_ctl);

CREATE TABLE IF NOT EXISTS sync_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tbl TEXT NOT NULL,
    key TEXT NOT NULL,
    lost_payload TEXT,
    lost_device TEXT,
    winner_device TEXT,
    created_at INTEGER NOT NULL           -- unix ms; pruned after 30 days
);

CREATE TABLE IF NOT EXISTS sync_peer_stats (
    device_id TEXT NOT NULL,
    day TEXT NOT NULL,
    watch_seconds REAL NOT NULL DEFAULT 0,
    chapters INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (device_id, day)
);

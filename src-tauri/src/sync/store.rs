// Change log: triggers record (tbl,key); `stamp` snapshots the row and assigns an HLC;
// `apply` merges remote changes (newest HLC wins, completed never reverts).
use super::hlc::{decide, merge_completed, Decision, Hlc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Row, SqlitePool};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Change {
    #[serde(default)]
    pub seq: i64,
    pub tbl: String,
    pub key: String,
    pub payload: Value,
    pub deleted: bool,
    pub hlc: i64,
    pub dev: String,
}

#[derive(Clone, Copy, Debug)]
pub struct Toggles {
    pub progress: bool,
    pub library: bool,
    pub reading: bool,
}

impl Toggles {
    pub fn allows(&self, tbl: &str) -> bool {
        match tbl {
            "watch" => self.progress,
            "reading" => self.reading,
            _ => self.library,
        }
    }
}

const MEDIA_COLS: [&str; 15] = [
    "id", "extension_id", "title", "english_name", "native_name", "description", "cover_url", "banner_url",
    "media_type", "content_type", "status", "year", "rating", "episode_count", "genres",
];

// (tbl, base table, key expression over row alias, row timestamp column)
const TABLES: [(&str, &str, &str, &str); 5] = [
    ("watch", "watch_history", "{r}.media_id||'|'||{r}.episode_id", "last_watched"),
    ("reading", "reading_history", "{r}.media_id||'|'||{r}.chapter_id", "last_read"),
    ("library", "library", "{r}.media_id", "updated_at"),
    ("tag", "library_tags", "{r}.name", "updated_at"),
    (
        "assign",
        "library_tag_assignments",
        "(SELECT media_id FROM library WHERE id={r}.library_entry_id)||'|'||(SELECT name FROM library_tags WHERE id={r}.tag_id)",
        "created_at",
    ),
];

pub async fn init(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    for (t, table, key, _) in TABLES {
        for (ev, r) in [("INSERT", "NEW"), ("UPDATE", "NEW"), ("DELETE", "OLD")] {
            let k = key.replace("{r}", r);
            sqlx::raw_sql(&format!(
                "CREATE TRIGGER IF NOT EXISTS sync_{t}_{ev} AFTER {ev} ON {table} \
                 WHEN (SELECT applying FROM sync_ctl)=0 BEGIN \
                 INSERT INTO sync_changes(tbl,key) SELECT '{t}', {k} WHERE {k} IS NOT NULL; END;"
            ))
            .execute(pool)
            .await?;
        }
    }
    let cutoff = chrono::Utc::now().timestamp_millis() - 30 * 24 * 3600 * 1000;
    sqlx::query("DELETE FROM sync_conflicts WHERE created_at < ?").bind(cutoff).execute(pool).await?;
    Ok(())
}

/// Log every existing row that has no change-log entry yet, so a newly paired device
/// receives history from before sync existed (triggers only see later edits; without
/// this, Mac → phone sent nothing). Stamped with the row's own time, not now, so older
/// data never beats a newer edit on the other device. Idempotent.
pub async fn backfill(pool: &SqlitePool, dev: &str) -> Result<usize, sqlx::Error> {
    let mut n = 0;
    for (t, table, key, ts) in TABLES {
        let k = key.replace("{r}", "r");
        let rows = sqlx::query(&format!(
            "SELECT {k} AS k, CAST(strftime('%s', COALESCE(r.{ts}, '1970-01-02')) AS INTEGER) AS sec FROM {table} r              WHERE {k} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sync_changes c WHERE c.tbl='{t}' AND c.key={k})"
        ))
        .fetch_all(pool)
        .await?;
        for (i, r) in rows.iter().enumerate() {
            let (key, sec): (String, i64) = (r.get("k"), r.get::<Option<i64>, _>("sec").unwrap_or(86_400));
            let Some(payload) = snapshot(pool, t, &key).await? else { continue };
            // unix ms << 16 like Hlc::tick; the low bits keep same-second rows distinct.
            let hlc = ((sec * 1000) << 16) | (i as i64 & 0xffff);
            sqlx::query("INSERT INTO sync_changes(tbl,key,payload,deleted,hlc,device_id) VALUES(?,?,?,0,?,?)")
                .bind(t)
                .bind(&key)
                .bind(payload)
                .bind(hlc)
                .bind(dev)
                .execute(pool)
                .await?;
            n += 1;
        }
    }
    Ok(n)
}

pub async fn max_hlc(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar::<_, Option<i64>>("SELECT MAX(hlc) FROM sync_changes")
        .fetch_one(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or(0)
}

fn media_json(alias: &str) -> String {
    let cols: Vec<String> = MEDIA_COLS.iter().map(|c| format!("'{c}',m.{c}")).collect();
    format!("json((SELECT json_object({}) FROM media m WHERE m.id={alias}))", cols.join(","))
}

/// Current row for (tbl,key) as JSON text, or None when the row is gone.
async fn snapshot(pool: &SqlitePool, tbl: &str, key: &str) -> Result<Option<String>, sqlx::Error> {
    let (a, b) = key.split_once('|').unwrap_or((key, ""));
    let sql = match tbl {
        "watch" => format!(
            "SELECT json_object('media_id',w.media_id,'episode_id',w.episode_id,'episode_number',w.episode_number,\
             'progress_seconds',w.progress_seconds,'duration',w.duration,'completed',w.completed,\
             'last_watched',w.last_watched,'media',{}) FROM watch_history w WHERE w.media_id=?1 AND w.episode_id=?2",
            media_json("w.media_id")
        ),
        "reading" => format!(
            "SELECT json_object('media_id',w.media_id,'chapter_id',w.chapter_id,'chapter_number',w.chapter_number,\
             'current_page',w.current_page,'total_pages',w.total_pages,'completed',w.completed,\
             'last_read',w.last_read,'media',{}) FROM reading_history w WHERE w.media_id=?1 AND w.chapter_id=?2",
            media_json("w.media_id")
        ),
        "library" => format!(
            "SELECT json_object('media_id',w.media_id,'status',w.status,'favorite',w.favorite,'score',w.score,\
             'notes',w.notes,'added_at',w.added_at,'auto_download',w.auto_download,'media',{}) \
             FROM library w WHERE w.media_id=?1 AND ?2=''",
            media_json("w.media_id")
        ),
        "tag" => "SELECT json_object('name',name,'color',color,'sort_order',sort_order) FROM library_tags WHERE name=?1 AND ?2=''".into(),
        "assign" => "SELECT json_object('media_id',l.media_id,'tag',t.name) FROM library_tag_assignments a \
             JOIN library l ON l.id=a.library_entry_id JOIN library_tags t ON t.id=a.tag_id \
             WHERE l.media_id=?1 AND t.name=?2"
            .into(),
        _ => return Ok(None),
    };
    // library/tag keys have no '|': ?2 is '' there. Tag names may contain '|'; re-join.
    let (a, b) = if tbl == "tag" { (key, "") } else { (a, b) };
    sqlx::query_scalar::<_, Option<String>>(&sql).bind(a).bind(b).fetch_optional(pool).await.map(|r| r.flatten())
}

/// Give every trigger-written row an HLC and a snapshot; keep one row per key.
pub async fn stamp(pool: &SqlitePool, hlc: &Hlc, dev: &str) -> Result<usize, sqlx::Error> {
    let rows = sqlx::query("SELECT MAX(seq) s, tbl, key FROM sync_changes WHERE hlc IS NULL GROUP BY tbl, key ORDER BY s")
        .fetch_all(pool)
        .await?;
    let n = rows.len();
    for r in rows {
        let (seq, tbl, key): (i64, String, String) = (r.get("s"), r.get("tbl"), r.get("key"));
        let payload = snapshot(pool, &tbl, &key).await?;
        let mut tx = pool.begin().await?;
        sqlx::query("UPDATE sync_changes SET payload=?, deleted=?, hlc=?, device_id=? WHERE seq=?")
            .bind(&payload)
            .bind(payload.is_none())
            .bind(hlc.tick())
            .bind(dev)
            .bind(seq)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM sync_changes WHERE tbl=? AND key=? AND seq<?")
            .bind(&tbl)
            .bind(&key)
            .bind(seq)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
    }
    Ok(n)
}

pub async fn queued(pool: &SqlitePool, peer: &str, acked: i64, t: Toggles) -> i64 {
    pending(pool, peer, acked, 100_000, t).await.map(|v| v.len() as i64).unwrap_or(0)
}

/// Changes the peer has not acked, excluding ones that came from the peer itself.
pub async fn pending(pool: &SqlitePool, peer: &str, after: i64, limit: i64, t: Toggles) -> Result<Vec<Change>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT seq,tbl,key,payload,deleted,hlc,device_id FROM sync_changes \
         WHERE seq>? AND hlc IS NOT NULL AND device_id<>? ORDER BY seq",
    )
    .bind(after)
    .bind(peer)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .filter(|r| t.allows(r.get::<String, _>("tbl").as_str()))
        .take(limit as usize)
        .map(|r| Change {
            seq: r.get("seq"),
            tbl: r.get("tbl"),
            key: r.get("key"),
            payload: r.get::<Option<String>, _>("payload").and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null),
            deleted: r.get::<bool, _>("deleted"),
            hlc: r.get("hlc"),
            dev: r.get("device_id"),
        })
        .collect())
}

fn j(path: &str) -> String {
    format!("json_extract(?1,'$.{path}')")
}

async fn upsert_media(tx: &mut sqlx::SqliteConnection, payload: &str) -> Result<(), sqlx::Error> {
    if serde_json::from_str::<Value>(payload).unwrap_or(Value::Null).get("media").map(|m| m.is_null()).unwrap_or(true) {
        return Ok(());
    }
    let vals: Vec<String> = MEDIA_COLS.iter().map(|c| j(&format!("media.{c}"))).collect();
    sqlx::query(&format!("INSERT OR IGNORE INTO media ({}) VALUES ({})", MEDIA_COLS.join(","), vals.join(",")))
        .bind(payload)
        .execute(tx)
        .await
        .map(|_| ())
}

async fn write_row(tx: &mut sqlx::SqliteConnection, c: &Change) -> Result<(), sqlx::Error> {
    let (a, b) = c.key.split_once('|').unwrap_or((&c.key, ""));
    if c.deleted {
        let (sql, binds): (&str, Vec<&str>) = match c.tbl.as_str() {
            "watch" => ("DELETE FROM watch_history WHERE media_id=?1 AND episode_id=?2", vec![a, b]),
            "reading" => ("DELETE FROM reading_history WHERE media_id=?1 AND chapter_id=?2", vec![a, b]),
            "library" => ("DELETE FROM library WHERE media_id=?1", vec![a]),
            "tag" => ("DELETE FROM library_tags WHERE name=?1", vec![c.key.as_str()]),
            _ => (
                "DELETE FROM library_tag_assignments WHERE library_entry_id IN (SELECT id FROM library WHERE media_id=?1) \
                 AND tag_id IN (SELECT id FROM library_tags WHERE name=?2)",
                vec![a, b],
            ),
        };
        let mut q = sqlx::query(sql);
        for v in binds {
            q = q.bind(v);
        }
        return q.execute(tx).await.map(|_| ());
    }
    let mut p = c.payload.clone();
    // completed never reverts to false through a merge
    let (table, wk) = match c.tbl.as_str() {
        "watch" => ("watch_history", "media_id=?1 AND episode_id=?2"),
        "reading" => ("reading_history", "media_id=?1 AND chapter_id=?2"),
        _ => ("", ""),
    };
    if !table.is_empty() {
        let local: Option<bool> = sqlx::query_scalar(&format!("SELECT completed FROM {table} WHERE {wk}"))
            .bind(a)
            .bind(b)
            .fetch_optional(&mut *tx)
            .await?;
        let inc = p["completed"].as_bool().unwrap_or_else(|| p["completed"].as_i64().unwrap_or(0) != 0);
        p["completed"] = Value::from(merge_completed(local.unwrap_or(false), inc));
    }
    let p = p.to_string();
    if c.tbl != "tag" && c.tbl != "assign" {
        upsert_media(&mut *tx, &p).await?;
    }
    let sql = match c.tbl.as_str() {
        "watch" => format!(
            "INSERT INTO watch_history(media_id,episode_id,episode_number,progress_seconds,duration,completed,last_watched) \
             VALUES({},{},{},{},{},{},{}) ON CONFLICT(media_id,episode_id) DO UPDATE SET episode_number=excluded.episode_number,\
             progress_seconds=excluded.progress_seconds,duration=excluded.duration,completed=excluded.completed,last_watched=excluded.last_watched",
            j("media_id"), j("episode_id"), j("episode_number"), j("progress_seconds"), j("duration"), j("completed"), j("last_watched")
        ),
        "reading" => format!(
            "INSERT INTO reading_history(media_id,chapter_id,chapter_number,current_page,total_pages,completed,last_read) \
             VALUES({},{},{},{},{},{},{}) ON CONFLICT(media_id,chapter_id) DO UPDATE SET chapter_number=excluded.chapter_number,\
             current_page=excluded.current_page,total_pages=excluded.total_pages,completed=excluded.completed,last_read=excluded.last_read",
            j("media_id"), j("chapter_id"), j("chapter_number"), j("current_page"), j("total_pages"), j("completed"), j("last_read")
        ),
        "library" => format!(
            "INSERT INTO library(media_id,status,favorite,score,notes,added_at,auto_download) VALUES({},{},{},{},{},{},{}) \
             ON CONFLICT(media_id) DO UPDATE SET status=excluded.status,favorite=excluded.favorite,score=excluded.score,\
             notes=excluded.notes,auto_download=excluded.auto_download,updated_at=CURRENT_TIMESTAMP",
            j("media_id"), j("status"), j("favorite"), j("score"), j("notes"), j("added_at"), j("auto_download")
        ),
        "tag" => format!(
            "INSERT INTO library_tags(name,color,sort_order) VALUES({},{},{}) ON CONFLICT(name) DO UPDATE SET \
             color=excluded.color,sort_order=excluded.sort_order,updated_at=CURRENT_TIMESTAMP",
            j("name"), j("color"), j("sort_order")
        ),
        _ => format!(
            "INSERT OR IGNORE INTO library_tag_assignments(library_entry_id,tag_id) \
             SELECT l.id,t.id FROM library l, library_tags t WHERE l.media_id={} AND t.name={}",
            j("media_id"), j("tag")
        ),
    };
    sqlx::query(&sql).bind(&p).execute(tx).await.map(|_| ())
}

/// Merge remote changes. Returns (applied, conflicts recorded).
pub async fn apply(pool: &SqlitePool, hlc: &Hlc, changes: &[Change], t: Toggles) -> Result<(usize, usize), sqlx::Error> {
    let (mut applied, mut conflicts) = (0, 0);
    for c in changes.iter().filter(|c| t.allows(&c.tbl)) {
        hlc.observe(c.hlc);
        let local = sqlx::query("SELECT hlc,device_id,payload FROM sync_changes WHERE tbl=? AND key=? AND hlc IS NOT NULL ORDER BY hlc DESC LIMIT 1")
            .bind(&c.tbl)
            .bind(&c.key)
            .fetch_optional(pool)
            .await?;
        let lw: Option<(i64, String, Option<String>)> = local.map(|r| (r.get("hlc"), r.get("device_id"), r.get("payload")));
        let d = decide(lw.as_ref().map(|l| (l.0, l.1.as_str())), (c.hlc, &c.dev));
        let inc_payload = if c.deleted { None } else { Some(c.payload.to_string()) };
        if let Some((_, ldev, lp)) = &lw {
            let differs = lp.as_deref().map(|s| serde_json::from_str::<Value>(s).ok()) != inc_payload.as_deref().map(|s| serde_json::from_str::<Value>(s).ok());
            if differs && *ldev != c.dev {
                let (lost, lost_dev, winner) = if d == Decision::Apply { (lp.clone(), ldev, &c.dev) } else { (inc_payload.clone(), &c.dev, ldev) };
                sqlx::query("INSERT INTO sync_conflicts(tbl,key,lost_payload,lost_device,winner_device,created_at) VALUES(?,?,?,?,?,?)")
                    .bind(&c.tbl)
                    .bind(&c.key)
                    .bind(lost)
                    .bind(lost_dev)
                    .bind(winner)
                    .bind(chrono::Utc::now().timestamp_millis())
                    .execute(pool)
                    .await?;
                conflicts += 1;
            }
        }
        if d == Decision::Skip {
            continue;
        }
        let mut tx = pool.begin().await?;
        sqlx::query("UPDATE sync_ctl SET applying=1").execute(&mut *tx).await?;
        write_row(&mut tx, c).await?;
        sqlx::query("UPDATE sync_ctl SET applying=0").execute(&mut *tx).await?;
        sqlx::query("DELETE FROM sync_changes WHERE tbl=? AND key=?").bind(&c.tbl).bind(&c.key).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO sync_changes(tbl,key,payload,deleted,hlc,device_id) VALUES(?,?,?,?,?,?)")
            .bind(&c.tbl)
            .bind(&c.key)
            .bind(inc_payload)
            .bind(c.deleted)
            .bind(c.hlc)
            .bind(&c.dev)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        applied += 1;
    }
    Ok((applied, conflicts))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DayStat {
    pub day: String,
    pub watch: f64,
    pub chapters: i64,
}

/// Daily watch seconds and chapters read, last 60 days, for this device.
pub async fn local_stats(pool: &SqlitePool) -> Vec<DayStat> {
    let rows = sqlx::query(
        "SELECT d day, SUM(w) watch, SUM(c) chapters FROM (\
           SELECT date(last_watched) d, progress_seconds w, 0 c FROM watch_history \
           UNION ALL SELECT date(last_read) d, 0 w, completed c FROM reading_history) \
         WHERE d >= date('now','-60 day') GROUP BY d",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter().map(|r| DayStat { day: r.get("day"), watch: r.get::<f64, _>("watch"), chapters: r.get::<i64, _>("chapters") }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;

    async fn db(dir: &tempfile::TempDir, n: &str) -> SqlitePool {
        let d = Database::new(dir.path().join(n)).await.unwrap();
        let p = d.pool().clone();
        init(&p).await.unwrap();
        p
    }

    async fn seed(p: &SqlitePool, completed: i64, pos: f64) {
        sqlx::query("INSERT OR IGNORE INTO media(id,extension_id,title,media_type) VALUES('m1','x','Show','anime')").execute(p).await.unwrap();
        sqlx::query(
            "INSERT INTO watch_history(media_id,episode_id,episode_number,progress_seconds,completed) VALUES('m1','e1',1,?,?) \
             ON CONFLICT(media_id,episode_id) DO UPDATE SET progress_seconds=excluded.progress_seconds,completed=excluded.completed",
        )
        .bind(pos)
        .bind(completed)
        .execute(p)
        .await
        .unwrap();
    }

    const ALL: Toggles = Toggles { progress: true, library: true, reading: true };

    #[tokio::test]
    async fn backfill_sends_history_from_before_pairing_without_beating_newer_edits() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (db(&dir, "a.db").await, db(&dir, "b.db").await);
        // History written before the change log existed: no trigger rows.
        sqlx::query("DELETE FROM sync_changes").execute(&a).await.unwrap();
        sqlx::query("INSERT INTO media(id,extension_id,title,media_type) VALUES('m1','x','Show','anime')").execute(&a).await.unwrap();
        sqlx::query("UPDATE sync_ctl SET applying=1").execute(&a).await.unwrap();
        sqlx::query(
            "INSERT INTO watch_history(media_id,episode_id,episode_number,progress_seconds,completed,last_watched)              VALUES('m1','e1',1,600,0,'2020-01-01 00:00:00')",
        )
        .execute(&a)
        .await
        .unwrap();
        sqlx::query("UPDATE sync_ctl SET applying=0").execute(&a).await.unwrap();
        assert!(pending(&a, "B", 0, 100, ALL).await.unwrap().is_empty());

        assert_eq!(backfill(&a, "A").await.unwrap(), 1);
        assert_eq!(backfill(&a, "A").await.unwrap(), 0, "idempotent");
        let out = pending(&a, "B", 0, 100, ALL).await.unwrap();
        assert_eq!(out.len(), 1);

        // B already has a newer position for the same episode: the old row must lose.
        let hb = Hlc::new(0);
        seed(&b, 0, 900.0).await;
        stamp(&b, &hb, "B").await.unwrap();
        apply(&b, &hb, &out, ALL).await.unwrap();
        let pos: f64 = sqlx::query_scalar("SELECT progress_seconds FROM watch_history").fetch_one(&b).await.unwrap();
        assert_eq!(pos, 900.0);
    }

    #[tokio::test]
    async fn two_devices_converge_and_completed_sticks() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (db(&dir, "a.db").await, db(&dir, "b.db").await);
        let (ha, hb) = (Hlc::new(0), Hlc::new(0));

        seed(&a, 1, 1400.0).await; // A completes the episode
        stamp(&a, &ha, "A").await.unwrap();
        let out = pending(&a, "B", 0, 100, ALL).await.unwrap();
        assert_eq!(out.len(), 1);
        let (n, _) = apply(&b, &hb, &out, ALL).await.unwrap();
        assert_eq!(n, 1);
        let (done, pos): (bool, f64) = sqlx::query_as("SELECT completed,progress_seconds FROM watch_history").fetch_one(&b).await.unwrap();
        assert!(done && pos == 1400.0);
        // applying remote change must not be logged as a local one
        assert_eq!(stamp(&b, &hb, "B").await.unwrap(), 0);

        // B rewinds later (newer hlc, completed=false): position moves, completed stays, conflict logged
        seed(&b, 0, 30.0).await;
        stamp(&b, &hb, "B").await.unwrap();
        let back = pending(&b, "A", 0, 100, ALL).await.unwrap();
        assert_eq!(back.len(), 1);
        let (_, conflicts) = apply(&a, &ha, &back, ALL).await.unwrap();
        assert_eq!(conflicts, 1);
        let (done, pos): (bool, f64) = sqlx::query_as("SELECT completed,progress_seconds FROM watch_history").fetch_one(&a).await.unwrap();
        assert!(done, "completed must not revert");
        assert_eq!(pos, 30.0);

        // replaying an older change is skipped
        let (n, _) = apply(&a, &ha, &out, ALL).await.unwrap();
        assert_eq!(n, 0);
        // toggle off blocks apply
        let off = Toggles { progress: false, ..ALL };
        assert_eq!(apply(&b, &hb, &out, off).await.unwrap().0, 0);
    }
}

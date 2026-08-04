use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::Result;

const FINISHED_RATIO: f64 = 0.92;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchProgress {
    pub source: String,
    pub anime_key: String,
    pub anime_title: String,
    #[serde(default)]
    pub poster: Option<String>,
    pub episode_ordinal: i64,
    #[serde(default)]
    pub episode_title: Option<String>,
    pub position_sec: f64,
    pub duration_sec: f64,
    #[serde(default)]
    pub studio: Option<String>,
    #[serde(default)]
    pub updated_at: i64,
}

impl WatchProgress {
    pub fn is_finished(&self) -> bool {
        self.duration_sec > 0.0 && self.position_sec >= self.duration_sec * FINISHED_RATIO
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinueItem {
    #[serde(flatten)]
    pub progress: WatchProgress,
    pub finished: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub source: String,
    pub anime_key: String,
    pub title: String,
    #[serde(default)]
    pub poster: Option<String>,
    pub status: String,
    #[serde(default)]
    pub score: Option<i64>,
    #[serde(default)]
    pub shikimori_id: Option<i64>,
    #[serde(default)]
    pub updated_at: i64,
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| crate::error::CoreError::Database(e.to_string()))?;
        }
        let conn = Connection::open(path)?;
        Self::from_connection(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.lock();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS watch_progress (
                source           TEXT NOT NULL,
                anime_key        TEXT NOT NULL,
                anime_title      TEXT NOT NULL,
                poster           TEXT,
                episode_ordinal  INTEGER NOT NULL,
                episode_title    TEXT,
                position_sec     REAL NOT NULL DEFAULT 0,
                duration_sec     REAL NOT NULL DEFAULT 0,
                studio           TEXT,
                updated_at       INTEGER NOT NULL,
                PRIMARY KEY (source, anime_key, episode_ordinal)
            );

            CREATE INDEX IF NOT EXISTS idx_progress_recent
                ON watch_progress (updated_at DESC);

            CREATE TABLE IF NOT EXISTS library (
                source        TEXT NOT NULL,
                anime_key     TEXT NOT NULL,
                title         TEXT NOT NULL,
                poster        TEXT,
                status        TEXT NOT NULL,
                score         INTEGER,
                shikimori_id  INTEGER,
                updated_at    INTEGER NOT NULL,
                PRIMARY KEY (source, anime_key)
            );

            CREATE INDEX IF NOT EXISTS idx_library_status
                ON library (status, updated_at DESC);

            CREATE TABLE IF NOT EXISTS settings (
                key    TEXT PRIMARY KEY,
                value  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS downloads (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                source           TEXT NOT NULL,
                anime_key        TEXT NOT NULL,
                anime_title      TEXT NOT NULL,
                poster           TEXT,
                episode_ordinal  INTEGER NOT NULL,
                episode_title    TEXT,
                studio           TEXT,
                quality          INTEGER NOT NULL DEFAULT 0,
                file_path        TEXT NOT NULL,
                status           TEXT NOT NULL,
                progress         REAL NOT NULL DEFAULT 0,
                error            TEXT,
                created_at       INTEGER NOT NULL,
                UNIQUE (source, anime_key, episode_ordinal, quality)
            );
            "#,
        )?;
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn raw_connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.lock()
    }

    pub fn save_progress(&self, progress: &WatchProgress) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            r#"
            INSERT INTO watch_progress
                (source, anime_key, anime_title, poster, episode_ordinal,
                 episode_title, position_sec, duration_sec, studio, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT (source, anime_key, episode_ordinal) DO UPDATE SET
                anime_title  = excluded.anime_title,
                poster       = COALESCE(excluded.poster, watch_progress.poster),
                episode_title= COALESCE(excluded.episode_title, watch_progress.episode_title),
                position_sec = excluded.position_sec,
                duration_sec = MAX(excluded.duration_sec, watch_progress.duration_sec),
                studio       = COALESCE(excluded.studio, watch_progress.studio),
                updated_at   = excluded.updated_at
            "#,
            params![
                progress.source,
                progress.anime_key,
                progress.anime_title,
                progress.poster,
                progress.episode_ordinal,
                progress.episode_title,
                progress.position_sec,
                progress.duration_sec,
                progress.studio,
                now(),
            ],
        )?;
        Ok(())
    }

    pub fn get_progress(
        &self,
        source: &str,
        anime_key: &str,
        episode_ordinal: i64,
    ) -> Result<Option<WatchProgress>> {
        let conn = self.lock();
        let found = conn
            .query_row(
                "SELECT * FROM watch_progress
                 WHERE source = ?1 AND anime_key = ?2 AND episode_ordinal = ?3",
                params![source, anime_key, episode_ordinal],
                row_to_progress,
            )
            .optional()?;
        Ok(found)
    }

    pub fn anime_progress(&self, source: &str, anime_key: &str) -> Result<Vec<WatchProgress>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT * FROM watch_progress
             WHERE source = ?1 AND anime_key = ?2
             ORDER BY episode_ordinal",
        )?;
        let rows = stmt.query_map(params![source, anime_key], row_to_progress)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn continue_watching(&self, limit: i64) -> Result<Vec<ContinueItem>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT wp.* FROM watch_progress wp
             WHERE wp.rowid = (
                 SELECT latest.rowid FROM watch_progress latest
                 WHERE latest.source = wp.source AND latest.anime_key = wp.anime_key
                 ORDER BY latest.updated_at DESC, latest.episode_ordinal DESC
                 LIMIT 1
             )
             ORDER BY wp.updated_at DESC, wp.episode_ordinal DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], row_to_progress)?;
        Ok(rows
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .map(|progress| ContinueItem {
                finished: progress.is_finished(),
                progress,
            })
            .collect())
    }

    pub fn history(&self, limit: i64) -> Result<Vec<WatchProgress>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT * FROM watch_progress
             ORDER BY updated_at DESC, episode_ordinal DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], row_to_progress)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn clear_history(&self) -> Result<()> {
        let conn = self.lock();
        conn.execute("DELETE FROM watch_progress", [])?;
        Ok(())
    }

    pub fn forget_anime(&self, source: &str, anime_key: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "DELETE FROM watch_progress WHERE source = ?1 AND anime_key = ?2",
            params![source, anime_key],
        )?;
        Ok(())
    }

    pub fn library_upsert(&self, entry: &LibraryEntry) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            r#"
            INSERT INTO library
                (source, anime_key, title, poster, status, score, shikimori_id, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT (source, anime_key) DO UPDATE SET
                title        = excluded.title,
                poster       = COALESCE(excluded.poster, library.poster),
                status       = excluded.status,
                score        = COALESCE(excluded.score, library.score),
                shikimori_id = COALESCE(excluded.shikimori_id, library.shikimori_id),
                updated_at   = excluded.updated_at
            "#,
            params![
                entry.source,
                entry.anime_key,
                entry.title,
                entry.poster,
                entry.status,
                entry.score,
                entry.shikimori_id,
                now(),
            ],
        )?;
        Ok(())
    }

    pub fn library_remove(&self, source: &str, anime_key: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "DELETE FROM library WHERE source = ?1 AND anime_key = ?2",
            params![source, anime_key],
        )?;
        Ok(())
    }

    pub fn library_get(&self, source: &str, anime_key: &str) -> Result<Option<LibraryEntry>> {
        let conn = self.lock();
        let found = conn
            .query_row(
                "SELECT * FROM library WHERE source = ?1 AND anime_key = ?2",
                params![source, anime_key],
                row_to_library,
            )
            .optional()?;
        Ok(found)
    }

    pub fn library_list(&self, status: Option<&str>) -> Result<Vec<LibraryEntry>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT * FROM library
             WHERE ?1 IS NULL OR status = ?1
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![status], row_to_library)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn setting_set(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn setting_get(&self, key: &str) -> Result<Option<String>> {
        let conn = self.lock();
        let found = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(found)
    }

    pub fn setting_delete(&self, key: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

fn row_to_progress(row: &Row<'_>) -> rusqlite::Result<WatchProgress> {
    Ok(WatchProgress {
        source: row.get("source")?,
        anime_key: row.get("anime_key")?,
        anime_title: row.get("anime_title")?,
        poster: row.get("poster")?,
        episode_ordinal: row.get("episode_ordinal")?,
        episode_title: row.get("episode_title")?,
        position_sec: row.get("position_sec")?,
        duration_sec: row.get("duration_sec")?,
        studio: row.get("studio")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_library(row: &Row<'_>) -> rusqlite::Result<LibraryEntry> {
    Ok(LibraryEntry {
        source: row.get("source")?,
        anime_key: row.get("anime_key")?,
        title: row.get("title")?,
        poster: row.get("poster")?,
        status: row.get("status")?,
        score: row.get("score")?,
        shikimori_id: row.get("shikimori_id")?,
        updated_at: row.get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn progress(episode: i64, position: f64, duration: f64) -> WatchProgress {
        WatchProgress {
            source: "anilibria".into(),
            anime_key: "https://site/a/1".into(),
            anime_title: "Атака титанов".into(),
            poster: Some("p.jpg".into()),
            episode_ordinal: episode,
            episode_title: Some(format!("Серия {episode}")),
            position_sec: position,
            duration_sec: duration,
            studio: Some("AniLibria".into()),
            updated_at: 0,
        }
    }

    #[test]
    fn saves_and_reads_back_progress() {
        let db = Db::open_in_memory().unwrap();
        db.save_progress(&progress(1, 300.0, 1440.0)).unwrap();

        let found = db
            .get_progress("anilibria", "https://site/a/1", 1)
            .unwrap()
            .unwrap();
        assert_eq!(found.position_sec, 300.0);
        assert_eq!(found.episode_title.as_deref(), Some("Серия 1"));
        assert!(found.updated_at > 0);
    }

    #[test]
    fn repeated_save_updates_position_in_place() {
        let db = Db::open_in_memory().unwrap();
        db.save_progress(&progress(1, 100.0, 1440.0)).unwrap();
        db.save_progress(&progress(1, 800.0, 1440.0)).unwrap();

        let all = db.anime_progress("anilibria", "https://site/a/1").unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].position_sec, 800.0);
    }

    #[test]
    fn duration_is_never_overwritten_with_a_smaller_value() {
        let db = Db::open_in_memory().unwrap();
        db.save_progress(&progress(1, 10.0, 1440.0)).unwrap();
        db.save_progress(&progress(1, 20.0, 0.0)).unwrap();

        let found = db
            .get_progress("anilibria", "https://site/a/1", 1)
            .unwrap()
            .unwrap();
        assert_eq!(found.duration_sec, 1440.0);
    }

    #[test]
    fn poster_survives_an_update_without_one() {
        let db = Db::open_in_memory().unwrap();
        db.save_progress(&progress(1, 10.0, 1440.0)).unwrap();

        let mut without = progress(1, 20.0, 1440.0);
        without.poster = None;
        db.save_progress(&without).unwrap();

        let found = db
            .get_progress("anilibria", "https://site/a/1", 1)
            .unwrap()
            .unwrap();
        assert_eq!(found.poster.as_deref(), Some("p.jpg"));
    }

    #[test]
    fn finished_flag_uses_completion_threshold() {
        assert!(!progress(1, 1200.0, 1440.0).is_finished());
        assert!(progress(1, 1400.0, 1440.0).is_finished());
        assert!(!progress(1, 1400.0, 0.0).is_finished());
    }

    #[test]
    fn continue_watching_keeps_one_row_per_anime() {
        let db = Db::open_in_memory().unwrap();
        db.save_progress(&progress(1, 1400.0, 1440.0)).unwrap();
        db.save_progress(&progress(2, 120.0, 1440.0)).unwrap();

        let items = db.continue_watching(10).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].progress.episode_ordinal, 2);
        assert!(!items[0].finished);
    }

    #[test]
    fn continue_watching_survives_same_second_saves() {
        let db = Db::open_in_memory().unwrap();
        for episode in 1..=4 {
            db.save_progress(&progress(episode, 60.0, 1440.0)).unwrap();
        }

        let items = db.continue_watching(10).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].progress.episode_ordinal, 4);
    }

    #[test]
    fn continue_watching_separates_different_anime() {
        let db = Db::open_in_memory().unwrap();
        db.save_progress(&progress(1, 100.0, 1440.0)).unwrap();

        let mut other = progress(1, 50.0, 1440.0);
        other.anime_key = "https://site/a/2".into();
        other.anime_title = "Другой тайтл".into();
        db.save_progress(&other).unwrap();

        assert_eq!(db.continue_watching(10).unwrap().len(), 2);
    }

    #[test]
    fn continue_watching_reports_finished_episodes() {
        let db = Db::open_in_memory().unwrap();
        db.save_progress(&progress(3, 1430.0, 1440.0)).unwrap();

        let items = db.continue_watching(10).unwrap();
        assert!(items[0].finished);
    }

    #[test]
    fn forgetting_anime_clears_every_episode() {
        let db = Db::open_in_memory().unwrap();
        db.save_progress(&progress(1, 10.0, 1440.0)).unwrap();
        db.save_progress(&progress(2, 10.0, 1440.0)).unwrap();

        db.forget_anime("anilibria", "https://site/a/1").unwrap();
        assert!(db
            .anime_progress("anilibria", "https://site/a/1")
            .unwrap()
            .is_empty());
    }

    fn library_entry(status: &str) -> LibraryEntry {
        LibraryEntry {
            source: "yummy_anime".into(),
            anime_key: "https://y/a/7".into(),
            title: "Ван-Пис".into(),
            poster: Some("p.jpg".into()),
            status: status.into(),
            score: Some(9),
            shikimori_id: Some(21),
            updated_at: 0,
        }
    }

    #[test]
    fn history_lists_every_episode_newest_first() {
        let db = Db::open_in_memory().unwrap();
        db.save_progress(&progress(1, 100.0, 1440.0)).unwrap();
        db.save_progress(&progress(2, 200.0, 1440.0)).unwrap();

        let mut other = progress(5, 50.0, 1440.0);
        other.anime_key = "https://site/a/2".into();
        db.save_progress(&other).unwrap();

        let history = db.history(10).unwrap();
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].episode_ordinal, 5);
    }

    #[test]
    fn history_respects_the_limit() {
        let db = Db::open_in_memory().unwrap();
        for episode in 1..=6 {
            db.save_progress(&progress(episode, 10.0, 1440.0)).unwrap();
        }
        assert_eq!(db.history(3).unwrap().len(), 3);
    }

    #[test]
    fn clearing_history_leaves_the_library_alone() {
        let db = Db::open_in_memory().unwrap();
        db.save_progress(&progress(1, 100.0, 1440.0)).unwrap();
        db.library_upsert(&library_entry("watching")).unwrap();

        db.clear_history().unwrap();
        assert!(db.history(10).unwrap().is_empty());
        assert_eq!(db.library_list(None).unwrap().len(), 1);
    }

    #[test]
    fn library_upsert_changes_status_in_place() {
        let db = Db::open_in_memory().unwrap();
        db.library_upsert(&library_entry("planned")).unwrap();
        db.library_upsert(&library_entry("watching")).unwrap();

        let all = db.library_list(None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].status, "watching");
        assert_eq!(all[0].shikimori_id, Some(21));
    }

    #[test]
    fn library_filters_by_status() {
        let db = Db::open_in_memory().unwrap();
        db.library_upsert(&library_entry("watching")).unwrap();

        let mut planned = library_entry("planned");
        planned.anime_key = "https://y/a/8".into();
        db.library_upsert(&planned).unwrap();

        assert_eq!(db.library_list(Some("planned")).unwrap().len(), 1);
        assert_eq!(db.library_list(None).unwrap().len(), 2);
    }

    #[test]
    fn library_remove_deletes_entry() {
        let db = Db::open_in_memory().unwrap();
        db.library_upsert(&library_entry("watching")).unwrap();
        db.library_remove("yummy_anime", "https://y/a/7").unwrap();
        assert!(db
            .library_get("yummy_anime", "https://y/a/7")
            .unwrap()
            .is_none());
    }

    #[test]
    fn settings_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.setting_get("theme").unwrap().is_none());

        db.setting_set("theme", "midnight").unwrap();
        db.setting_set("theme", "aurora").unwrap();
        assert_eq!(db.setting_get("theme").unwrap().as_deref(), Some("aurora"));

        db.setting_delete("theme").unwrap();
        assert!(db.setting_get("theme").unwrap().is_none());
    }

    #[test]
    fn schema_survives_reopening_the_same_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state").join("anilume.db");

        let db = Db::open(&path).unwrap();
        db.save_progress(&progress(1, 42.0, 1440.0)).unwrap();
        drop(db);

        let reopened = Db::open(&path).unwrap();
        let found = reopened
            .get_progress("anilibria", "https://site/a/1", 1)
            .unwrap()
            .unwrap();
        assert_eq!(found.position_sec, 42.0);
    }
}

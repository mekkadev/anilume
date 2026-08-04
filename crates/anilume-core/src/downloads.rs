use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use dashmap::DashMap;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, Semaphore};

use crate::db::Db;
use crate::error::{CoreError, Result};

const MAX_PARALLEL_DOWNLOADS: usize = 2;
const EVENT_CHANNEL_CAPACITY: usize = 256;

pub const STATUS_QUEUED: &str = "queued";
pub const STATUS_RUNNING: &str = "running";
pub const STATUS_DONE: &str = "done";
pub const STATUS_ERROR: &str = "error";
pub const STATUS_CANCELED: &str = "canceled";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub source: String,
    pub anime_key: String,
    pub anime_title: String,
    #[serde(default)]
    pub poster: Option<String>,
    pub episode_ordinal: i64,
    #[serde(default)]
    pub episode_title: Option<String>,
    #[serde(default)]
    pub studio: Option<String>,
    pub quality: i64,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: i64,
    pub source: String,
    pub anime_key: String,
    pub anime_title: String,
    pub poster: Option<String>,
    pub episode_ordinal: i64,
    pub episode_title: Option<String>,
    pub studio: Option<String>,
    pub quality: i64,
    pub file_path: String,
    pub status: String,
    pub progress: f64,
    pub error: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEvent {
    pub id: i64,
    pub status: String,
    pub progress: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct DownloadManager {
    db: Arc<Db>,
    ffmpeg: PathBuf,
    root: PathBuf,
    events: broadcast::Sender<DownloadEvent>,
    running: Arc<DashMap<i64, Arc<tokio::sync::Notify>>>,
    slots: Arc<Semaphore>,
}

impl DownloadManager {
    pub fn new(db: Arc<Db>, ffmpeg: PathBuf, root: PathBuf) -> Self {
        let (events, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            db,
            ffmpeg,
            root,
            events,
            running: Arc::new(DashMap::new()),
            slots: Arc::new(Semaphore::new(MAX_PARALLEL_DOWNLOADS)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DownloadEvent> {
        self.events.subscribe()
    }

    pub fn ffmpeg_available(&self) -> bool {
        self.ffmpeg.exists() || which(&self.ffmpeg).is_some()
    }

    pub fn enqueue(self: &Arc<Self>, request: DownloadRequest) -> Result<DownloadItem> {
        if !self.ffmpeg_available() {
            return Err(CoreError::Other(
                "Не найден ffmpeg — без него скачивание недоступно".into(),
            ));
        }

        let file_path = self.root.join(target_file_name(&request));
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::Other(e.to_string()))?;
        }

        let item = self.insert(&request, &file_path)?;
        let manager = self.clone();
        let id = item.id;
        tokio::spawn(async move {
            manager.run_job(id, request, file_path).await;
        });
        Ok(item)
    }

    pub fn cancel(&self, id: i64) -> Result<()> {
        if let Some(entry) = self.running.get(&id) {
            entry.notify_waiters();
        }
        self.update_status(id, STATUS_CANCELED, 0.0, None)?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<DownloadItem>> {
        let conn = self.db_conn();
        let mut stmt = conn.prepare("SELECT * FROM downloads ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], row_to_item)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn find_completed(
        &self,
        source: &str,
        anime_key: &str,
        episode_ordinal: i64,
    ) -> Result<Option<DownloadItem>> {
        let conn = self.db_conn();
        let found = conn
            .query_row(
                "SELECT * FROM downloads
                 WHERE source = ?1 AND anime_key = ?2 AND episode_ordinal = ?3
                   AND status = ?4
                 ORDER BY quality DESC LIMIT 1",
                params![source, anime_key, episode_ordinal, STATUS_DONE],
                row_to_item,
            )
            .optional()?;

        Ok(found.filter(|item| Path::new(&item.file_path).exists()))
    }

    pub fn remove(&self, id: i64, delete_file: bool) -> Result<()> {
        if delete_file {
            if let Some(item) = self.get(id)? {
                let _ = std::fs::remove_file(&item.file_path);
            }
        }
        let conn = self.db_conn();
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get(&self, id: i64) -> Result<Option<DownloadItem>> {
        let conn = self.db_conn();
        Ok(conn
            .query_row("SELECT * FROM downloads WHERE id = ?1", params![id], row_to_item)
            .optional()?)
    }

    async fn run_job(&self, id: i64, request: DownloadRequest, file_path: PathBuf) {
        let Ok(_permit) = self.slots.clone().acquire_owned().await else {
            return;
        };

        if matches!(self.get(id), Ok(Some(item)) if item.status == STATUS_CANCELED) {
            return;
        }

        let cancel = Arc::new(tokio::sync::Notify::new());
        self.running.insert(id, cancel.clone());
        let _ = self.update_status(id, STATUS_RUNNING, 0.0, None);

        let outcome = self.spawn_ffmpeg(id, &request, &file_path, cancel).await;
        self.running.remove(&id);

        match outcome {
            Ok(true) => {
                let _ = self.update_status(id, STATUS_DONE, 1.0, None);
            }
            Ok(false) => {
                let _ = std::fs::remove_file(&file_path);
                let _ = self.update_status(id, STATUS_CANCELED, 0.0, None);
            }
            Err(error) => {
                let _ = std::fs::remove_file(&file_path);
                let _ = self.update_status(id, STATUS_ERROR, 0.0, Some(error.to_string()));
            }
        }
    }

    async fn spawn_ffmpeg(
        &self,
        id: i64,
        request: &DownloadRequest,
        file_path: &Path,
        cancel: Arc<tokio::sync::Notify>,
    ) -> Result<bool> {
        let mut command = Command::new(&self.ffmpeg);
        command
            .args(ffmpeg_args(request, file_path))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }

        let mut child = command
            .spawn()
            .map_err(|e| CoreError::Other(format!("Не удалось запустить ffmpeg: {e}")))?;

        let stderr = child.stderr.take().ok_or_else(|| {
            CoreError::Other("ffmpeg не отдал поток диагностики".into())
        })?;

        let events = self.events.clone();
        let db = self.db.clone();
        let reporter = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            let mut tracker = ProgressTracker::default();
            let mut tail = String::new();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(progress) = tracker.feed(&line) {
                    let _ = events.send(DownloadEvent {
                        id,
                        status: STATUS_RUNNING.into(),
                        progress,
                        error: None,
                    });
                    let _ = write_progress(&db, id, progress);
                }
                if line.contains("Error") || line.contains("error") || line.contains("Invalid") {
                    tail = line;
                }
            }
            tail
        });

        let status = tokio::select! {
            status = child.wait() => status,
            _ = cancel.notified() => {
                let _ = child.kill().await;
                let _ = reporter.await;
                return Ok(false);
            }
        };

        let detail = reporter.await.unwrap_or_default();
        let status = status.map_err(|e| CoreError::Other(e.to_string()))?;

        if status.success() {
            Ok(true)
        } else if detail.is_empty() {
            Err(CoreError::Other(format!("ffmpeg завершился с ошибкой ({status})")))
        } else {
            Err(CoreError::Other(detail))
        }
    }

    fn insert(&self, request: &DownloadRequest, file_path: &Path) -> Result<DownloadItem> {
        let conn = self.db_conn();
        conn.execute(
            r#"
            INSERT INTO downloads
                (source, anime_key, anime_title, poster, episode_ordinal, episode_title,
                 studio, quality, file_path, status, progress, error, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, NULL,
                    CAST(strftime('%s','now') AS INTEGER))
            ON CONFLICT (source, anime_key, episode_ordinal, quality) DO UPDATE SET
                status    = excluded.status,
                progress  = 0,
                error     = NULL,
                file_path = excluded.file_path
            "#,
            params![
                request.source,
                request.anime_key,
                request.anime_title,
                request.poster,
                request.episode_ordinal,
                request.episode_title,
                request.studio,
                request.quality,
                file_path.to_string_lossy(),
                STATUS_QUEUED,
            ],
        )?;

        conn.query_row(
            "SELECT * FROM downloads
             WHERE source = ?1 AND anime_key = ?2 AND episode_ordinal = ?3 AND quality = ?4",
            params![
                request.source,
                request.anime_key,
                request.episode_ordinal,
                request.quality
            ],
            row_to_item,
        )
        .map_err(Into::into)
    }

    fn update_status(
        &self,
        id: i64,
        status: &str,
        progress: f64,
        error: Option<String>,
    ) -> Result<()> {
        {
            let conn = self.db_conn();
            conn.execute(
                "UPDATE downloads SET status = ?2, progress = ?3, error = ?4 WHERE id = ?1",
                params![id, status, progress, error],
            )?;
        }
        let _ = self.events.send(DownloadEvent {
            id,
            status: status.to_owned(),
            progress,
            error,
        });
        Ok(())
    }

    fn db_conn(&self) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
        self.db.raw_connection()
    }
}

fn write_progress(db: &Db, id: i64, progress: f64) -> Result<()> {
    let conn = db.raw_connection();
    conn.execute(
        "UPDATE downloads SET progress = ?2 WHERE id = ?1",
        params![id, progress],
    )?;
    Ok(())
}

pub fn ffmpeg_args(request: &DownloadRequest, file_path: &Path) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    let mut extra_headers = String::new();
    for (name, value) in &request.headers {
        if name.eq_ignore_ascii_case("user-agent") {
            args.push("-user_agent".into());
            args.push(value.clone());
        } else {
            extra_headers.push_str(&format!("{name}: {value}\r\n"));
        }
    }
    if !extra_headers.is_empty() {
        args.push("-headers".into());
        args.push(extra_headers);
    }

    args.push("-i".into());
    args.push(request.url.clone());
    args.push("-c".into());
    args.push("copy".into());
    if request.url.contains(".m3u8") {
        args.push("-bsf:a".into());
        args.push("aac_adtstoasc".into());
    }
    args.push("-movflags".into());
    args.push("+faststart".into());
    args.push("-y".into());
    args.push(file_path.to_string_lossy().into_owned());
    args
}

pub fn target_file_name(request: &DownloadRequest) -> String {
    let title = sanitize(&request.anime_title);
    let studio = request
        .studio
        .as_deref()
        .map(sanitize)
        .filter(|s| !s.is_empty())
        .map(|s| format!(" [{s}]"))
        .unwrap_or_default();
    format!(
        "{title}/{title} - {:02} серия{studio} [{}p].mp4",
        request.episode_ordinal, request.quality
    )
}

fn sanitize(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn which(binary: &Path) -> Option<PathBuf> {
    let name = binary.file_name()?;
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

#[derive(Default)]
pub struct ProgressTracker {
    total_sec: Option<f64>,
    last_reported: f64,
}

impl ProgressTracker {
    pub fn feed(&mut self, line: &str) -> Option<f64> {
        if self.total_sec.is_none() {
            if let Some(total) = parse_labeled_time(line, "Duration:") {
                self.total_sec = Some(total);
            }
        }

        let current = parse_labeled_time(line, "time=")?;
        let total = self.total_sec.filter(|t| *t > 0.0)?;

        let progress = (current / total).clamp(0.0, 1.0);
        if progress - self.last_reported < 0.005 && progress < 1.0 {
            return None;
        }
        self.last_reported = progress;
        Some(progress)
    }
}

fn parse_labeled_time(line: &str, label: &str) -> Option<f64> {
    let start = line.find(label)? + label.len();
    let value: String = line[start..]
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == ':' || *c == '.')
        .collect();

    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadItem> {
    Ok(DownloadItem {
        id: row.get("id")?,
        source: row.get("source")?,
        anime_key: row.get("anime_key")?,
        anime_title: row.get("anime_title")?,
        poster: row.get("poster")?,
        episode_ordinal: row.get("episode_ordinal")?,
        episode_title: row.get("episode_title")?,
        studio: row.get("studio")?,
        quality: row.get("quality")?,
        file_path: row.get("file_path")?,
        status: row.get("status")?,
        progress: row.get("progress")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> DownloadRequest {
        DownloadRequest {
            source: "anilibria".into(),
            anime_key: "https://site/a/1".into(),
            anime_title: "Атака титанов".into(),
            poster: None,
            episode_ordinal: 3,
            episode_title: Some("Серия 3".into()),
            studio: Some("AniLibria".into()),
            quality: 1080,
            url: "https://cdn/master.m3u8".into(),
            headers: HashMap::new(),
        }
    }

    #[test]
    fn file_name_groups_episodes_under_the_title() {
        assert_eq!(
            target_file_name(&request()),
            "Атака титанов/Атака титанов - 03 серия [AniLibria] [1080p].mp4"
        );
    }

    #[test]
    fn file_name_strips_path_separators() {
        let mut request = request();
        request.anime_title = "Re:Zero / Жизнь с нуля".into();
        request.studio = None;

        let name = target_file_name(&request);
        assert!(!name.contains(':'));
        assert_eq!(name.matches('/').count(), 1);
    }

    #[test]
    fn hls_download_gets_the_adts_bitstream_filter() {
        let args = ffmpeg_args(&request(), Path::new("/tmp/out.mp4"));
        assert!(args.windows(2).any(|w| w == ["-bsf:a", "aac_adtstoasc"]));
        assert!(args.windows(2).any(|w| w == ["-c", "copy"]));
        assert_eq!(args.last().unwrap(), "/tmp/out.mp4");
    }

    #[test]
    fn direct_mp4_download_skips_the_filter() {
        let mut request = request();
        request.url = "https://cdn/video.mp4".into();
        let args = ffmpeg_args(&request, Path::new("/tmp/out.mp4"));
        assert!(!args.iter().any(|a| a == "aac_adtstoasc"));
    }

    #[test]
    fn referer_goes_into_headers_and_user_agent_into_its_own_flag() {
        let mut request = request();
        request
            .headers
            .insert("Referer".into(), "https://kodik.info/".into());
        request
            .headers
            .insert("User-Agent".into(), "anilume/1.0".into());

        let args = ffmpeg_args(&request, Path::new("/tmp/out.mp4"));
        let headers_index = args.iter().position(|a| a == "-headers").unwrap();
        assert_eq!(args[headers_index + 1], "Referer: https://kodik.info/\r\n");

        let ua_index = args.iter().position(|a| a == "-user_agent").unwrap();
        assert_eq!(args[ua_index + 1], "anilume/1.0");
    }

    #[test]
    fn progress_needs_duration_before_reporting() {
        let mut tracker = ProgressTracker::default();
        assert_eq!(tracker.feed("frame=1 time=00:00:10.00 bitrate=1"), None);
    }

    #[test]
    fn progress_is_reported_once_duration_is_known() {
        let mut tracker = ProgressTracker::default();
        tracker.feed("  Duration: 00:20:00.00, start: 0.000000, bitrate: 1200 kb/s");

        let progress = tracker.feed("frame=1 fps=25 time=00:10:00.00 bitrate=1").unwrap();
        assert!((progress - 0.5).abs() < 1e-9);
    }

    #[test]
    fn tiny_progress_steps_are_not_reported() {
        let mut tracker = ProgressTracker::default();
        tracker.feed("  Duration: 01:00:00.00, start: 0.0");
        tracker.feed("time=00:30:00.00").unwrap();

        assert_eq!(tracker.feed("time=00:30:01.00"), None);
        assert!(tracker.feed("time=00:45:00.00").is_some());
    }

    #[test]
    fn progress_never_exceeds_one() {
        let mut tracker = ProgressTracker::default();
        tracker.feed("  Duration: 00:10:00.00");
        assert_eq!(tracker.feed("time=00:12:00.00").unwrap(), 1.0);
    }

    #[test]
    fn unknown_duration_keeps_progress_silent() {
        let mut tracker = ProgressTracker::default();
        tracker.feed("  Duration: N/A, start: 0.000000");
        assert_eq!(tracker.feed("time=00:01:00.00"), None);
    }

    #[test]
    fn labeled_time_parsing_handles_ffmpeg_shapes() {
        assert_eq!(parse_labeled_time("time=00:01:30.50 bitrate=x", "time="), Some(90.5));
        assert_eq!(parse_labeled_time("  Duration: 00:23:40.00,", "Duration:"), Some(1420.0));
        assert_eq!(parse_labeled_time("Duration: N/A", "Duration:"), None);
        assert_eq!(parse_labeled_time("no marker here", "time="), None);
    }
}

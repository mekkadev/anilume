use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anilume_core::{
    newly_aired, watched_ids, Aired, Artworks, CoreError, Db, Discover, DownloadManager,
    ProxyHandle, Result, Shikimori, SidecarClient, SidecarSpec,
};
use tokio::sync::Mutex;

const CACHE_LIFETIME: i64 = 30 * 24 * 60 * 60;
const SEEN_EPISODES: &str = "notify.seen";
pub const NOTIFY_SETTING: &str = "notify.episodes";

pub struct AppState {
    pub sidecar: Arc<SidecarClient>,
    pub proxy: ProxyHandle,
    pub db: Arc<Db>,
    pub shikimori: Arc<Shikimori>,
    pub discover: Arc<Discover>,
    pub artworks: Arc<Artworks>,
    pub downloads: Arc<DownloadManager>,
    pub playback_session: Mutex<Option<String>>,
}

impl AppState {
    pub async fn initialize(data_dir: PathBuf, downloads_dir: PathBuf) -> Result<Self> {
        let db = Arc::new(Db::open(&data_dir.join("anilume.db"))?);
        if let Ok(dropped) = db.cache_purge(CACHE_LIFETIME) {
            if dropped > 0 {
                tracing::info!("кэш каталога: удалено записей — {dropped}");
            }
        }
        let sidecar = SidecarClient::spawn(&resolve_sidecar()?).await?;
        let proxy = ProxyHandle::start().await?;
        let shikimori = Arc::new(Shikimori::new(db.clone())?);
        let discover = Arc::new(Discover::new(db.clone())?);
        let artworks = Arc::new(Artworks::new(db.clone())?);
        let downloads = Arc::new(DownloadManager::new(
            db.clone(),
            resolve_ffmpeg(),
            downloads_dir,
        ));

        if let Ok(count) = downloads.recover_interrupted() {
            if count > 0 {
                tracing::info!("незавершённых загрузок восстановлено: {count}");
            }
        }

        Ok(Self {
            sidecar,
            proxy,
            db,
            shikimori,
            discover,
            artworks,
            downloads,
            playback_session: Mutex::new(None),
        })
    }

    pub async fn open_playback(
        &self,
        url: &str,
        headers: std::collections::HashMap<String, String>,
    ) -> String {
        let mut current = self.playback_session.lock().await;
        if let Some(previous) = current.take() {
            self.proxy.close_session(&previous);
        }

        let session = self.proxy.open_session(headers);
        let proxied = self.proxy.proxied_url(&session, url);
        *current = Some(session);
        proxied
    }

    pub fn notifications_on(&self) -> bool {
        !matches!(
            self.db
                .setting_get(NOTIFY_SETTING)
                .ok()
                .flatten()
                .as_deref(),
            Some("off")
        )
    }

    pub async fn check_airing(&self) -> Result<Vec<Aired>> {
        if !self.notifications_on() {
            return Ok(Vec::new());
        }

        let followed = watched_ids(
            self.db
                .library_list(None)?
                .iter()
                .map(|entry| (entry.status.as_str(), entry.shikimori_id))
                .collect::<Vec<_>>(),
        );
        if followed.is_empty() {
            return Ok(Vec::new());
        }

        let calendar = self.discover.calendar().await?;
        let seen: HashMap<i64, i64> = self
            .db
            .setting_get(SEEN_EPISODES)?
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();

        let (found, next) = newly_aired(&calendar, &followed, &seen);
        if let Ok(encoded) = serde_json::to_string(&next) {
            self.db.setting_set(SEEN_EPISODES, &encoded)?;
        }
        Ok(found)
    }

    pub async fn close_playback(&self) {
        let mut current = self.playback_session.lock().await;
        if let Some(session) = current.take() {
            self.proxy.close_session(&session);
        }
    }
}

fn executable_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
}

fn binary_name(stem: &str) -> String {
    if cfg!(windows) {
        format!("{stem}.exe")
    } else {
        stem.to_owned()
    }
}

fn resolve_sidecar() -> Result<SidecarSpec> {
    if let Some(explicit) = std::env::var_os("ANILUME_SIDECAR") {
        return Ok(SidecarSpec::binary(PathBuf::from(explicit)));
    }

    if let Some(dir) = executable_dir() {
        let bundled = dir.join(binary_name("anilume-sidecar"));
        if bundled.is_file() {
            return Ok(SidecarSpec::binary(bundled));
        }
    }

    let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar");
    if dev_root.join("anilume_sidecar").is_dir() {
        let interpreter = if cfg!(windows) { "python" } else { "python3" };
        return Ok(SidecarSpec::python_module(interpreter, &dev_root));
    }

    Err(CoreError::Other(
        "Не найден сайдкар: соберите его командой `npm run sidecar:build`".into(),
    ))
}

fn resolve_ffmpeg() -> PathBuf {
    if let Some(explicit) = std::env::var_os("ANILUME_FFMPEG") {
        return PathBuf::from(explicit);
    }

    if let Some(dir) = executable_dir() {
        let bundled = dir.join(binary_name("ffmpeg"));
        if bundled.is_file() {
            return bundled;
        }
    }

    PathBuf::from(binary_name("ffmpeg"))
}

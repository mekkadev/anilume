use std::collections::HashMap;

use anilume_core::error::CoreErrorWire;
use anilume_core::{
    ContinueItem, DownloadItem, DownloadRequest, LibraryEntry, WatchProgress,
};
use anilume_core::shikimori::{Account, ShikimoriConfig, UserRate};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

type Answer<T> = std::result::Result<T, CoreErrorWire>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackTarget {
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShikimoriStatus {
    pub configured: bool,
    pub logged_in: bool,
    pub account: Option<Account>,
}

#[tauri::command]
pub async fn sources_list(state: State<'_, AppState>) -> Answer<Value> {
    Ok(state.sidecar.call("sources.list", json!({})).await?)
}

#[tauri::command]
pub async fn catalog_ongoing(state: State<'_, AppState>, source: String) -> Answer<Value> {
    Ok(state
        .sidecar
        .call("catalog.ongoing", json!({ "source": source }))
        .await?)
}

#[tauri::command]
pub async fn catalog_search(
    state: State<'_, AppState>,
    source: String,
    query: String,
) -> Answer<Value> {
    Ok(state
        .sidecar
        .call("catalog.search", json!({ "source": source, "query": query }))
        .await?)
}

#[tauri::command]
pub async fn catalog_search_multi(
    state: State<'_, AppState>,
    sources: Vec<String>,
    query: String,
) -> Answer<Value> {
    Ok(state
        .sidecar
        .call(
            "catalog.searchMulti",
            json!({ "sources": sources, "query": query }),
        )
        .await?)
}

#[tauri::command]
pub async fn anime_get(state: State<'_, AppState>, handle: String) -> Answer<Value> {
    Ok(state
        .sidecar
        .call("anime.get", json!({ "handle": handle }))
        .await?)
}

#[tauri::command]
pub async fn episode_studios(state: State<'_, AppState>, handle: String) -> Answer<Value> {
    Ok(state
        .sidecar
        .call("episode.studios", json!({ "handle": handle }))
        .await?)
}

#[tauri::command]
pub async fn studio_videos(state: State<'_, AppState>, handle: String) -> Answer<Value> {
    Ok(state
        .sidecar
        .call("studio.videos", json!({ "handle": handle }))
        .await?)
}

#[tauri::command]
pub async fn playback_open(
    state: State<'_, AppState>,
    url: String,
    headers: HashMap<String, String>,
) -> Answer<PlaybackTarget> {
    Ok(PlaybackTarget {
        url: state.open_playback(&url, headers).await,
    })
}

#[tauri::command]
pub async fn playback_close(state: State<'_, AppState>) -> Answer<()> {
    state.close_playback().await;
    Ok(())
}

#[tauri::command]
pub async fn progress_save(state: State<'_, AppState>, progress: WatchProgress) -> Answer<()> {
    state.db.save_progress(&progress)?;
    Ok(())
}

#[tauri::command]
pub async fn progress_for_anime(
    state: State<'_, AppState>,
    source: String,
    anime_key: String,
) -> Answer<Vec<WatchProgress>> {
    Ok(state.db.anime_progress(&source, &anime_key)?)
}

#[tauri::command]
pub async fn continue_watching(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Answer<Vec<ContinueItem>> {
    Ok(state.db.continue_watching(limit.unwrap_or(20))?)
}

#[tauri::command]
pub async fn forget_anime(
    state: State<'_, AppState>,
    source: String,
    anime_key: String,
) -> Answer<()> {
    state.db.forget_anime(&source, &anime_key)?;
    Ok(())
}

#[tauri::command]
pub async fn library_list(
    state: State<'_, AppState>,
    status: Option<String>,
) -> Answer<Vec<LibraryEntry>> {
    Ok(state.db.library_list(status.as_deref())?)
}

#[tauri::command]
pub async fn library_get(
    state: State<'_, AppState>,
    source: String,
    anime_key: String,
) -> Answer<Option<LibraryEntry>> {
    Ok(state.db.library_get(&source, &anime_key)?)
}

#[tauri::command]
pub async fn library_upsert(state: State<'_, AppState>, entry: LibraryEntry) -> Answer<()> {
    state.db.library_upsert(&entry)?;
    Ok(())
}

#[tauri::command]
pub async fn library_remove(
    state: State<'_, AppState>,
    source: String,
    anime_key: String,
) -> Answer<()> {
    state.db.library_remove(&source, &anime_key)?;
    Ok(())
}

#[tauri::command]
pub async fn setting_get(state: State<'_, AppState>, key: String) -> Answer<Option<String>> {
    Ok(state.db.setting_get(&key)?)
}

#[tauri::command]
pub async fn setting_set(state: State<'_, AppState>, key: String, value: String) -> Answer<()> {
    state.db.setting_set(&key, &value)?;
    Ok(())
}

#[tauri::command]
pub async fn shikimori_status(state: State<'_, AppState>) -> Answer<ShikimoriStatus> {
    let configured = state.shikimori.is_configured();
    let logged_in = state.shikimori.is_logged_in();
    let account = if logged_in {
        state.shikimori.whoami().await.ok()
    } else {
        None
    };
    Ok(ShikimoriStatus {
        configured,
        logged_in,
        account,
    })
}

#[tauri::command]
pub async fn shikimori_configure(
    state: State<'_, AppState>,
    config: ShikimoriConfig,
) -> Answer<()> {
    state.shikimori.save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn shikimori_authorize_url(state: State<'_, AppState>) -> Answer<String> {
    Ok(state.shikimori.authorize_url()?)
}

#[tauri::command]
pub async fn shikimori_login_with_code(
    state: State<'_, AppState>,
    code: String,
) -> Answer<Account> {
    Ok(state.shikimori.login_with_code(&code).await?)
}

#[tauri::command]
pub async fn shikimori_login_loopback(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Answer<Account> {
    let opener = app.clone();
    Ok(state
        .shikimori
        .login_via_loopback(move |url| {
            use tauri_plugin_opener::OpenerExt;
            let _ = opener.opener().open_url(url, None::<&str>);
        })
        .await?)
}

#[tauri::command]
pub async fn shikimori_logout(state: State<'_, AppState>) -> Answer<()> {
    state.shikimori.logout()?;
    Ok(())
}

#[tauri::command]
pub async fn shikimori_get_rate(
    state: State<'_, AppState>,
    target_id: i64,
) -> Answer<Option<UserRate>> {
    Ok(state.shikimori.get_rate(target_id).await?)
}

#[tauri::command]
pub async fn shikimori_set_rate(
    state: State<'_, AppState>,
    target_id: i64,
    status: String,
    episodes: Option<i64>,
    score: Option<i64>,
) -> Answer<UserRate> {
    Ok(state
        .shikimori
        .set_rate(target_id, &status, episodes, score)
        .await?)
}

#[tauri::command]
pub async fn downloads_available(state: State<'_, AppState>) -> Answer<bool> {
    Ok(state.downloads.ffmpeg_available())
}

#[tauri::command]
pub async fn downloads_list(state: State<'_, AppState>) -> Answer<Vec<DownloadItem>> {
    Ok(state.downloads.list()?)
}

#[tauri::command]
pub async fn downloads_enqueue(
    state: State<'_, AppState>,
    request: DownloadRequest,
) -> Answer<DownloadItem> {
    Ok(state.downloads.enqueue(request)?)
}

#[tauri::command]
pub async fn downloads_cancel(state: State<'_, AppState>, id: i64) -> Answer<()> {
    state.downloads.cancel(id)?;
    Ok(())
}

#[tauri::command]
pub async fn downloads_remove(
    state: State<'_, AppState>,
    id: i64,
    delete_file: bool,
) -> Answer<()> {
    state.downloads.remove(id, delete_file)?;
    Ok(())
}

#[tauri::command]
pub async fn downloads_find_completed(
    state: State<'_, AppState>,
    source: String,
    anime_key: String,
    episode_ordinal: i64,
) -> Answer<Option<DownloadItem>> {
    Ok(state
        .downloads
        .find_completed(&source, &anime_key, episode_ordinal)?)
}

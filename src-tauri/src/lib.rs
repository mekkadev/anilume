mod commands;
mod state;

use tauri::{Emitter, Manager};

use state::AppState;

pub const DOWNLOAD_EVENT: &str = "anilume://download-progress";

fn override_dir(variable: &str) -> Option<std::path::PathBuf> {
    let raw = std::env::var_os(variable)?;
    let path = std::path::PathBuf::from(raw);
    if path.as_os_str().is_empty() {
        return None;
    }
    std::fs::create_dir_all(&path).ok()?;
    Some(path)
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("ANILUME_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = override_dir("ANILUME_DATA_DIR").unwrap_or_else(|| {
                handle
                    .path()
                    .app_data_dir()
                    .unwrap_or_else(|_| std::env::temp_dir().join("anilume"))
            });
            let downloads_dir = override_dir("ANILUME_DOWNLOADS_DIR").unwrap_or_else(|| {
                handle
                    .path()
                    .video_dir()
                    .map(|dir| dir.join("anilume"))
                    .unwrap_or_else(|_| data_dir.join("downloads"))
            });

            let state = tauri::async_runtime::block_on(AppState::initialize(
                data_dir,
                downloads_dir,
            ))?;

            let mut events = state.downloads.subscribe();
            let emitter = handle.clone();
            tauri::async_runtime::spawn(async move {
                while let Ok(event) = events.recv().await {
                    let _ = emitter.emit(DOWNLOAD_EVENT, event);
                }
            });

            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sources_list,
            commands::catalog_ongoing,
            commands::catalog_search,
            commands::catalog_search_multi,
            commands::catalog_probe,
            commands::anime_get,
            commands::source_config_set,
            commands::animelib_servers,
            commands::episode_studios,
            commands::studio_videos,
            commands::discover_options,
            commands::discover_search,
            commands::discover_title,
            commands::artwork_lookup,
            commands::discover_similar,
            commands::discover_related,
            commands::discover_comments,
            commands::discover_match,
            commands::skip_times,
            commands::playback_open,
            commands::playback_close,
            commands::progress_save,
            commands::progress_for_anime,
            commands::continue_watching,
            commands::forget_anime,
            commands::watch_history,
            commands::clear_history,
            commands::library_list,
            commands::library_get,
            commands::library_upsert,
            commands::library_remove,
            commands::setting_get,
            commands::setting_set,
            commands::cache_stats,
            commands::cache_clear,
            commands::shikimori_status,
            commands::shikimori_configure,
            commands::shikimori_authorize_url,
            commands::shikimori_login_with_code,
            commands::shikimori_login_loopback,
            commands::shikimori_logout,
            commands::shikimori_get_rate,
            commands::shikimori_set_rate,
            commands::downloads_available,
            commands::downloads_list,
            commands::downloads_enqueue,
            commands::downloads_cancel,
            commands::downloads_remove,
            commands::downloads_find_completed,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить anilume");
}

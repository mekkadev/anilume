import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  AnimeCard,
  AnimeDetail,
  AppError,
  ContinueItem,
  DownloadEvent,
  DownloadItem,
  DownloadRequest,
  EpisodeInfo,
  LibraryEntry,
  ShikimoriAccount,
  ShikimoriConfig,
  ShikimoriStatus,
  SourceInfo,
  StudioInfo,
  UserRate,
  VideoInfo,
  WatchProgress,
} from "./types";

export const DOWNLOAD_EVENT = "anilume://download-progress";

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value
  );
}

export function errorMessage(value: unknown): string {
  if (isAppError(value)) return value.message;
  if (value instanceof Error) return value.message;
  return String(value);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export const api = {
  sources: () =>
    call<{ sources: SourceInfo[]; default: string }>("sources_list"),

  ongoing: (source: string) =>
    call<{ items: AnimeCard[] }>("catalog_ongoing", { source }),

  search: (source: string, query: string) =>
    call<{ items: AnimeCard[]; query: string }>("catalog_search", {
      source,
      query,
    }),

  searchMulti: (sources: string[], query: string) =>
    call<{
      query: string;
      groups: { source: string; items: AnimeCard[] }[];
      failures: { source: string; error: { message: string } }[];
    }>("catalog_search_multi", { sources, query }),

  anime: (handle: string) => call<AnimeDetail>("anime_get", { handle }),

  studios: (handle: string) =>
    call<{ studios: StudioInfo[] }>("episode_studios", { handle }),

  videos: (handle: string) =>
    call<{ videos: VideoInfo[] }>("studio_videos", { handle }),

  openPlayback: (url: string, headers: Record<string, string>) =>
    call<{ url: string }>("playback_open", { url, headers }),

  closePlayback: () => call<void>("playback_close"),

  saveProgress: (progress: WatchProgress) =>
    call<void>("progress_save", { progress }),

  animeProgress: (source: string, animeKey: string) =>
    call<WatchProgress[]>("progress_for_anime", { source, animeKey }),

  continueWatching: (limit = 20) =>
    call<ContinueItem[]>("continue_watching", { limit }),

  watchHistory: (limit = 200) => call<WatchProgress[]>("watch_history", { limit }),

  clearHistory: () => call<void>("clear_history"),

  forgetAnime: (source: string, animeKey: string) =>
    call<void>("forget_anime", { source, animeKey }),

  libraryList: (status?: string) => call<LibraryEntry[]>("library_list", { status }),

  libraryGet: (source: string, animeKey: string) =>
    call<LibraryEntry | null>("library_get", { source, animeKey }),

  libraryUpsert: (entry: LibraryEntry) => call<void>("library_upsert", { entry }),

  libraryRemove: (source: string, animeKey: string) =>
    call<void>("library_remove", { source, animeKey }),

  settingGet: (key: string) => call<string | null>("setting_get", { key }),

  settingSet: (key: string, value: string) =>
    call<void>("setting_set", { key, value }),

  shikimoriStatus: () => call<ShikimoriStatus>("shikimori_status"),

  shikimoriConfigure: (config: ShikimoriConfig) =>
    call<void>("shikimori_configure", { config }),

  shikimoriAuthorizeUrl: () => call<string>("shikimori_authorize_url"),

  shikimoriLoginWithCode: (code: string) =>
    call<ShikimoriAccount>("shikimori_login_with_code", { code }),

  shikimoriLoginLoopback: () =>
    call<ShikimoriAccount>("shikimori_login_loopback"),

  shikimoriLogout: () => call<void>("shikimori_logout"),

  shikimoriGetRate: (targetId: number) =>
    call<UserRate | null>("shikimori_get_rate", { targetId }),

  shikimoriSetRate: (
    targetId: number,
    status: string,
    episodes?: number,
    score?: number,
  ) => call<UserRate>("shikimori_set_rate", { targetId, status, episodes, score }),

  downloadsAvailable: () => call<boolean>("downloads_available"),

  downloadsList: () => call<DownloadItem[]>("downloads_list"),

  downloadsEnqueue: (request: DownloadRequest) =>
    call<DownloadItem>("downloads_enqueue", { request }),

  downloadsCancel: (id: number) => call<void>("downloads_cancel", { id }),

  downloadsRemove: (id: number, deleteFile: boolean) =>
    call<void>("downloads_remove", { id, deleteFile }),

  downloadsFindCompleted: (
    source: string,
    animeKey: string,
    episodeOrdinal: number,
  ) =>
    call<DownloadItem | null>("downloads_find_completed", {
      source,
      animeKey,
      episodeOrdinal,
    }),

  onDownloadProgress: (handler: (event: DownloadEvent) => void) =>
    listen<DownloadEvent>(DOWNLOAD_EVENT, (event) => handler(event.payload)),
};

export type { EpisodeInfo };

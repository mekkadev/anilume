export interface SourceInfo {
  key: string;
  name: string;
  description: string;
  geoRestricted: boolean;
  notes: string[];
}

export interface AnimeMeta {
  year: number | null;
  genres: string[];
  score: number | null;
  episodesTotal: number | null;
  kind: string | null;
  ageRating: string | null;
  status: string | null;
  altTitle: string | null;
  shikimoriId: number | null;
  episodeDurationMin: number | null;
  tags: string[];
}

export interface AnimeCard {
  handle: string;
  source: string;
  title: string;
  poster: string | null;
  key: string;
  episodeBadge: string | null;
  dubBadge: string | null;
  meta: AnimeMeta;
}

export interface EpisodeInfo {
  handle: string;
  ordinal: number;
  title: string;
}

export interface AnimeDetail {
  handle: string;
  source: string;
  key: string;
  title: string;
  poster: string | null;
  description: string;
  meta: AnimeMeta;
  episodes: EpisodeInfo[];
}

export interface StudioInfo {
  handle: string;
  title: string;
  player: string;
  url: string;
}

export interface VideoInfo {
  type: "m3u8" | "mp4" | "mpd" | "audio" | "webm";
  quality: number;
  url: string;
  headers: Record<string, string>;
}

export interface WatchProgress {
  source: string;
  animeKey: string;
  animeTitle: string;
  poster: string | null;
  episodeOrdinal: number;
  episodeTitle: string | null;
  positionSec: number;
  durationSec: number;
  studio: string | null;
  updatedAt: number;
}

export interface ContinueItem extends WatchProgress {
  finished: boolean;
}

export interface LibraryEntry {
  source: string;
  animeKey: string;
  title: string;
  poster: string | null;
  status: LibraryStatus;
  score: number | null;
  shikimoriId: number | null;
  updatedAt: number;
}

export type LibraryStatus =
  | "watching"
  | "planned"
  | "completed"
  | "on_hold"
  | "dropped";

export interface ShikimoriAccount {
  id: number;
  nickname: string;
  avatar: string | null;
}

export interface ShikimoriStatus {
  configured: boolean;
  loggedIn: boolean;
  account: ShikimoriAccount | null;
}

export interface ShikimoriConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  userAgent: string;
}

export interface UserRate {
  id: number | null;
  targetId: number;
  status: string;
  episodes: number;
  score: number;
}

export type DownloadStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "canceled";

export interface DownloadItem {
  id: number;
  source: string;
  animeKey: string;
  animeTitle: string;
  poster: string | null;
  episodeOrdinal: number;
  episodeTitle: string | null;
  studio: string | null;
  quality: number;
  filePath: string;
  status: DownloadStatus;
  progress: number;
  error: string | null;
  createdAt: number;
}

export interface DownloadEvent {
  id: number;
  status: DownloadStatus;
  progress: number;
  error?: string;
}

export interface DownloadRequest {
  source: string;
  animeKey: string;
  animeTitle: string;
  poster: string | null;
  episodeOrdinal: number;
  episodeTitle: string | null;
  studio: string | null;
  quality: number;
  url: string;
  headers: Record<string, string>;
}

export type ErrorKind =
  | "sidecarDown"
  | "sidecarTimeout"
  | "upstream"
  | "handleExpired"
  | "network"
  | "database"
  | "shikimoriUnauthorized"
  | "shikimoriNotConfigured"
  | "other";

export interface AppError {
  kind: ErrorKind;
  message: string;
  hint?: string;
}

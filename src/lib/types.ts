export interface SourceInfo {
  key: string;
  name: string;
  description: string;
  geoRestricted: boolean;
  priority: number;
  notes: string[];
}

export interface Aired {
  shikimoriId: number;
  title: string;
  episode: number;
}

export interface Upcoming {
  card: DiscoverCard;
  episode: number;
  airsAt: string;
  duration: number | null;
}

export interface CacheStats {
  entries: number;
  bytes: number;
}

export interface StudioQuality {
  handle: string;
  quality: number | null;
  error: string | null;
}

export interface SourceProbe {
  source: string;
  handle: string;
  quality: number | null;
  dubs: number;
  episodes: number;
  error: string | null;
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
  malId: number | null;
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

export interface DiscoverCard {
  id: number;
  title: string;
  originalTitle: string;
  poster: string | null;
  score: number | null;
  kind: string | null;
  status: string | null;
  year: number | null;
  episodes: number | null;
}

export interface DiscoverNamed {
  id: number;
  name: string;
}

export interface DiscoverOptions {
  genres: DiscoverNamed[];
  studios: DiscoverNamed[];
}

export interface DiscoverQuery {
  query?: string;
  genres?: number[];
  studios?: number[];
  kinds?: string[];
  status?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  order?: string;
  page?: number;
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

export interface TitleDetail {
  id: number;
  title: string;
  originalTitle: string;
  japanese: string | null;
  poster: string | null;
  art: string[];
  description: string;
  score: number | null;
  kind: string | null;
  status: string | null;
  year: number | null;
  episodes: number | null;
  episodesAired: number | null;
  duration: number | null;
  rating: string | null;
  genres: string[];
  studios: DiscoverNamed[];
  nextEpisodeAt: string | null;
  topicId: number | null;
}

export interface RelatedTitle {
  relation: string;
  card: DiscoverCard;
}

export interface ShikiComment {
  id: number;
  author: string;
  avatar: string | null;
  body: string;
  createdAt: string;
}

export interface Artwork {
  malId: number;
  cover: string | null;
  banner: string | null;
}

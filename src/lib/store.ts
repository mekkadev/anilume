import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";

import { api, errorMessage } from "./api";
import type { AnimeCard, SourceInfo, VideoInfo } from "./types";

export type Route =
  | { name: "home" }
  | { name: "search"; query: string }
  | { name: "discover" }
  | { name: "schedule" }
  | {
      name: "title";
      query: string;
      aliases?: string[];
      card?: AnimeCard;
      source?: string;
      year?: number | null;
      shikiId?: number | null;
    }
  | { name: "library" }
  | { name: "history" }
  | { name: "downloads" }
  | { name: "settings" };

const [route, setRoute] = createSignal<Route>({ name: "home" });
const [stack, setStack] = createSignal<Route[]>([]);

export { route };

export function navigate(next: Route) {
  setStack([...stack(), route()].slice(-50));
  setRoute(next);
}

export function goBack() {
  const current = stack();
  const previous = current[current.length - 1];
  setStack(current.slice(0, -1));
  setRoute(previous ?? { name: "home" });
}

export function canGoBack() {
  return stack().length > 0;
}

export type RouteName = Route["name"];

export function matchRoute<K extends RouteName>(
  current: Route,
  name: K,
): Extract<Route, { name: K }> | false {
  return current.name === name ? (current as Extract<Route, { name: K }>) : false;
}

const [paletteOpen, setPaletteOpen] = createSignal(false);

export { paletteOpen };

export function openPalette() {
  setPaletteOpen(true);
}

export function closePalette() {
  setPaletteOpen(false);
}

const [sources, setSources] = createSignal<SourceInfo[]>([]);
const [activeSource, setActiveSourceSignal] = createSignal<string>("anilibria");

export { activeSource, sources };

export async function loadSources() {
  const result = await api.sources();
  setSources(result.sources);
  setActiveSourceSignal(result.default);
}

export function sourceName(key: string) {
  return sources().find((s) => s.key === key)?.name ?? key;
}

const [ambient, setAmbientSignal] = createSignal<string | null>(null);

export { ambient };

export function setAmbient(url: string | null) {
  setAmbientSignal(url);
}

export interface Toast {
  id: number;
  tone: "info" | "error" | "success";
  message: string;
  hint?: string;
  action?: () => void;
}

const [toasts, setToasts] = createStore<Toast[]>([]);
let toastId = 0;

export { toasts };

export function pushToast(
  message: string,
  tone: Toast["tone"] = "info",
  hint?: string,
  action?: () => void,
) {
  const id = ++toastId;
  setToasts((current) => [...current, { id, tone, message, hint, action }]);
  if (!action) {
    setTimeout(() => dismissToast(id), tone === "error" ? 7000 : 3800);
  }
}

export function dismissToast(id: number) {
  setToasts((current) => current.filter((toast) => toast.id !== id));
}

export function reportError(error: unknown) {
  const hint =
    typeof error === "object" && error !== null && "hint" in error
      ? (error as { hint?: string }).hint
      : undefined;
  pushToast(errorMessage(error), "error", hint);
}

export interface PlaybackRequest {
  source: string;
  animeKey: string;
  animeTitle: string;
  poster: string | null;
  episodes: { handle: string; ordinal: number; title: string }[];
  episodeIndex: number;
  studioTitle: string | null;
  videos: VideoInfo[];
  startAt: number;
  qualityIndex: number;
  autoplayNext: boolean;
  offline: boolean;
  malId: number | null;
  episodeNumbers: number[];
}

const [playback, setPlayback] = createSignal<PlaybackRequest | null>(null);

export { playback };

export function openPlayer(request: PlaybackRequest) {
  setPlayback(request);
}

export function closePlayer() {
  setPlayback(null);
  void api.closePlayback();
}

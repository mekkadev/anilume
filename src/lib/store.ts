import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";

import { api, errorMessage } from "./api";
import type { AnimeCard, SourceInfo, VideoInfo } from "./types";

export type Route =
  | { name: "home" }
  | { name: "search"; query: string }
  | { name: "title"; card: AnimeCard }
  | { name: "library" }
  | { name: "history" }
  | { name: "downloads" }
  | { name: "settings" };

const [route, setRoute] = createSignal<Route>({ name: "home" });
const history: Route[] = [];

export { route };

export function navigate(next: Route) {
  history.push(route());
  if (history.length > 50) history.shift();
  setRoute(next);
}

export function goBack() {
  const previous = history.pop();
  setRoute(previous ?? { name: "home" });
}

export function canGoBack() {
  return history.length > 0;
}

export type RouteName = Route["name"];

export function matchRoute<K extends RouteName>(
  current: Route,
  name: K,
): Extract<Route, { name: K }> | false {
  return current.name === name ? (current as Extract<Route, { name: K }>) : false;
}

const [sources, setSources] = createSignal<SourceInfo[]>([]);
const [activeSource, setActiveSourceSignal] = createSignal<string>("anilibria");

export { activeSource, sources };

const SOURCE_SETTING = "ui.source";

export async function loadSources() {
  const result = await api.sources();
  setSources(result.sources);

  const stored = await api.settingGet(SOURCE_SETTING);
  const known = result.sources.some((s) => s.key === stored);
  setActiveSourceSignal(known && stored ? stored : result.default);
}

export function setActiveSource(key: string) {
  setActiveSourceSignal(key);
  void api.settingSet(SOURCE_SETTING, key);
}

export function sourceName(key: string) {
  return sources().find((s) => s.key === key)?.name ?? key;
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

import { createSignal } from "solid-js";

import { api } from "./api";
import type { VideoInfo } from "./types";

export type QualityPref = "max" | "1080" | "720" | "480" | "min";
export type EpisodeOrder = "asc" | "desc";

const KEY_AUTOPLAY = "player.autoplayNext";
const KEY_QUALITY = "player.quality";
const KEY_ORDER = "ui.episodeOrder";
const KEY_SKIP = "player.rememberDub";

const [autoplayNext, setAutoplaySignal] = createSignal(true);
const [qualityPref, setQualitySignal] = createSignal<QualityPref>("max");
const [episodeOrder, setOrderSignal] = createSignal<EpisodeOrder>("asc");
const [rememberDub, setRememberSignal] = createSignal(true);

export { autoplayNext, episodeOrder, qualityPref, rememberDub };

export const QUALITY_LABELS: Record<QualityPref, string> = {
  max: "Максимальное",
  "1080": "1080p",
  "720": "720p",
  "480": "480p",
  min: "Минимальное",
};

export const QUALITY_ORDER: QualityPref[] = ["min", "480", "720", "1080", "max"];

export const QUALITY_SHORT: Record<QualityPref, string> = {
  min: "Мин",
  "480": "480",
  "720": "720",
  "1080": "1080",
  max: "Макс",
};

export async function loadPrefs() {
  const [autoplay, quality, order, remember] = await Promise.all([
    api.settingGet(KEY_AUTOPLAY),
    api.settingGet(KEY_QUALITY),
    api.settingGet(KEY_ORDER),
    api.settingGet(KEY_SKIP),
  ]);

  if (autoplay !== null) setAutoplaySignal(autoplay === "true");
  if (quality !== null && quality in QUALITY_LABELS) {
    setQualitySignal(quality as QualityPref);
  }
  if (order === "asc" || order === "desc") setOrderSignal(order);
  if (remember !== null) setRememberSignal(remember === "true");
}

export function setAutoplayNext(value: boolean) {
  setAutoplaySignal(value);
  void api.settingSet(KEY_AUTOPLAY, String(value));
}

export function setQualityPref(value: QualityPref) {
  setQualitySignal(value);
  void api.settingSet(KEY_QUALITY, value);
}

export function setEpisodeOrder(value: EpisodeOrder) {
  setOrderSignal(value);
  void api.settingSet(KEY_ORDER, value);
}

export function setRememberDub(value: boolean) {
  setRememberSignal(value);
  void api.settingSet(KEY_SKIP, String(value));
}

export function pickQualityIndex(videos: VideoInfo[], pref: QualityPref): number {
  if (videos.length === 0) return 0;
  if (pref === "max") return 0;
  if (pref === "min") return videos.length - 1;

  const target = Number(pref);
  const atMost = videos.findIndex((video) => video.quality <= target);
  return atMost >= 0 ? atMost : videos.length - 1;
}

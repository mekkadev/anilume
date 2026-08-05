import { createSignal } from "solid-js";

import { api } from "./api";
import type { Artwork } from "./types";

const [table, setTable] = createSignal<Record<number, Artwork>>({});
const requested = new Set<number>();

export function artFor(malId: number | null | undefined) {
  if (!malId || malId <= 0) return null;
  return table()[malId] ?? null;
}

export function coverFor(malId: number | null | undefined, fallback: string | null) {
  const found = artFor(malId);
  return found?.thumb ?? found?.cover ?? fallback;
}

export function posterFor(malId: number | null | undefined, fallback: string | null) {
  const found = artFor(malId);
  return found?.cover ?? found?.thumb ?? fallback;
}

export function bannerFor(malId: number | null | undefined) {
  return artFor(malId)?.banner ?? null;
}

export async function ensureArt(ids: (number | null | undefined)[]) {
  const missing = ids.filter(
    (id): id is number => Boolean(id) && id! > 0 && !requested.has(id!),
  );
  if (missing.length === 0) return;

  for (const id of missing) requested.add(id);

  try {
    const found = await api.artworkLookup(missing);
    if (found.length === 0) return;

    const next = { ...table() };
    for (const art of found) next[art.malId] = art;
    setTable(next);
  } catch {
    for (const id of missing) requested.delete(id);
  }
}

const JUNK = /[^\p{L}\p{N}]+/gu;

const NOISE = new Set([
  "tv",
  "the",
  "movie",
  "season",
  "сезон",
  "часть",
  "part",
  "anime",
  "аниме",
]);

const YEAR = /\b(19[5-9]\d|20[0-4]\d)\b/g;

export function yearOf(value: string): number | null {
  const found = value.match(YEAR);
  if (!found || found.length === 0) return null;
  return Number(found[found.length - 1]);
}

export function normalise(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(YEAR, " ")
    .replace(JUNK, " ")
    .trim();
}

export function words(value: string) {
  return normalise(value)
    .split(" ")
    .filter((word) => word.length > 0 && !NOISE.has(word));
}

function overlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0;
  const pool = new Set(right);
  const common = left.filter((word) => pool.has(word)).length;
  return common / Math.min(left.length, right.length);
}

function textScore(candidate: string, aliases: string[]): number {
  const flat = normalise(candidate);
  if (!flat) return 0;
  const mine = words(candidate);

  let best = 0;
  for (const alias of aliases) {
    const other = normalise(alias);
    if (!other) continue;

    if (other === flat) return 100;

    const theirs = words(alias);
    const shared = overlap(mine, theirs);

    if (shared < 0.7) continue;
    if (Math.abs(mine.length - theirs.length) > 2) continue;

    const gap = Math.abs(mine.length - theirs.length);
    best = Math.max(best, Math.round(shared * 60) - gap * 6);
  }
  return best;
}

export function score(
  candidate: string,
  aliases: string[],
  want?: number | null,
  has?: number | null,
): number {
  const base = textScore(candidate, aliases);
  if (base === 0) return 0;

  const mine = has ?? yearOf(candidate);
  const theirs = want ?? aliases.map(yearOf).find((value) => value !== null) ?? null;
  if (mine === null || theirs === null) return base;

  const gap = Math.abs(mine - theirs);
  if (gap === 0) return base + 40;
  if (gap === 1) return base;
  return Math.max(1, base - gap * 25);
}

export function pickMatch<T>(
  items: T[],
  aliases: string[],
  nameOf: (item: T) => string,
  want?: number | null,
  yearFor?: (item: T) => number | null | undefined,
): T | null {
  const clean = aliases.map((alias) => alias.trim()).filter(Boolean);
  if (clean.length === 0 || items.length === 0) return null;

  let winner: T | null = null;
  let top = 0;

  for (const item of items) {
    const value = score(nameOf(item), clean, want, yearFor?.(item) ?? null);
    if (value > top) {
      top = value;
      winner = item;
    }
  }

  return top > 0 ? winner : null;
}

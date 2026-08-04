import { api } from "./api";
import type { AnimeCard } from "./types";

export async function resolveCard(
  source: string,
  animeKey: string,
  title: string,
): Promise<AnimeCard> {
  const { items } = await api.search(source, title);
  if (items.length === 0) {
    throw {
      kind: "upstream",
      message: `«${title}» больше не находится в источнике`,
      hint: "Тайтл могли убрать или переименовать — попробуйте другой источник",
    };
  }

  const exact = items.find((item) => item.key === animeKey);
  if (exact) return exact;

  const byTitle = items.find(
    (item) => item.title.toLowerCase() === title.toLowerCase(),
  );
  return byTitle ?? items[0]!;
}

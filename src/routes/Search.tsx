import {
  For,
  Index,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Icon } from "../components/Icon";
import { PosterCard, PosterSkeleton } from "../components/PosterCard";
import { ShikiCard } from "../components/ShikiCard";
import { api } from "../lib/api";
import { ensureArt } from "../lib/art";
import { normalise } from "../lib/match";
import { broke, pending } from "../lib/resource";
import { navigate, sources } from "../lib/store";
import type { AnimeCard, DiscoverCard } from "../lib/types";

const DEBOUNCE = 300;

interface Results {
  shiki: DiscoverCard[];
  fallback: AnimeCard[];
}

export function Search(props: { query: string }) {
  const [draft, setDraft] = createSignal(props.query);
  const [needle, setNeedle] = createSignal(props.query);
  let field: HTMLInputElement | undefined;
  let timer: number | undefined;

  onMount(() => field?.focus());

  createEffect(() => {
    const value = draft();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setNeedle(value.trim()), DEBOUNCE);
  });

  onCleanup(() => window.clearTimeout(timer));

  createEffect(() => setDraft(props.query));

  const submit = (event: Event) => {
    event.preventDefault();
    window.clearTimeout(timer);
    setNeedle(draft().trim());
  };

  const [resultsRes] = createResource(
    needle,
    async (query): Promise<Results> => {
      if (query.length === 0) return { shiki: [], fallback: [] };

      let shiki: DiscoverCard[] = [];
      try {
        shiki = await api.discoverSearch({ query, order: "popularity" });
      } catch {
        shiki = [];
      }
      if (shiki.length > 0) return { shiki, fallback: [] };

      const keys = sources().map((item) => item.key);
      const result = await api.searchMulti(keys, query).catch(() => null);
      if (!result) return { shiki: [], fallback: [] };

      const seen = new Set<string>();
      const flat: AnimeCard[] = [];
      for (const group of result.groups) {
        for (const card of group.items) {
          const key = `${normalise(card.title)}:${card.meta.year ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          flat.push(card);
        }
      }
      return { shiki: [], fallback: flat };
    },
  );

  const results = () =>
    resultsRes.state === "errored" ? undefined : resultsRes.latest;
  const busy = () => pending(resultsRes);

  createEffect(() => {
    const ids = (results()?.shiki ?? []).map((card) => card.id);
    if (ids.length > 0) void ensureArt(ids);
  });

  const total = () => {
    const found = results();
    return found ? found.shiki.length + found.fallback.length : 0;
  };

  const openShiki = (card: DiscoverCard) =>
    navigate({
      name: "title",
      query: card.title,
      aliases: [card.originalTitle],
      year: card.year,
      shikiId: card.id,
    });

  const openCard = (card: AnimeCard) =>
    navigate({
      name: "title",
      query: card.title,
      aliases: [card.meta.altTitle ?? ""],
      card,
      year: card.meta.year,
    });

  return (
    <div class="fade-in">
      <div class="page-head">
        <div>
          <h1 class="page-title">Поиск</h1>
          <p class="page-sub">
            <Show when={needle().length > 0} fallback="По названию — на русском, ромадзи или английском">
              <Show when={!pending(resultsRes)} fallback="Ищем…">
                «{needle()}» — найдено: {total()}
              </Show>
            </Show>
          </p>
        </div>
      </div>

      <form class="search-field" onSubmit={submit}>
        <Icon name="search" size={16} />
        <input
          ref={field}
          type="search"
          placeholder="Название аниме"
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          spellcheck={false}
          autocomplete="off"
        />
        <span class="kbd">⌘K</span>
      </form>

      <Show
        when={needle().length > 0}
        fallback={
          <div class="empty">
            <div class="empty__title">Начните вводить название</div>
            <p>Работают русское, английское и ромадзи — минимум две буквы</p>
          </div>
        }
      >
        <Show
          when={results()}
          fallback={
            <Show
              when={!broke(resultsRes)}
              fallback={
                <div class="empty">
                  <div class="empty__title">Поиск не ответил</div>
                  <p>Проверьте сеть и попробуйте ещё раз</p>
                </div>
              }
            >
              <div class="poster-grid">
                <Index each={Array(10).fill(0)}>{() => <PosterSkeleton />}</Index>
              </div>
            </Show>
          }
        >
          <Show
            when={total() > 0}
            fallback={
              <Show when={!busy()}>
                <div class="empty">
                  <div class="empty__title">Ничего не найдено</div>
                  <p>Попробуйте оригинальное или английское название</p>
                </div>
              </Show>
            }
          >
            <Show when={(results()?.shiki ?? []).length > 0}>
              <div class="poster-grid" data-busy={busy()}>
                <For each={results()?.shiki}>
                  {(card) => <ShikiCard card={card} onOpen={openShiki} />}
                </For>
              </div>
            </Show>

            <Show when={(results()?.fallback ?? []).length > 0}>
              <section class="section">
                <div class="section__head">
                  <span class="page-sub">
                    Каталог не ответил — результаты напрямую из плееров
                  </span>
                </div>
                <div class="poster-grid">
                  <For each={results()?.fallback}>
                    {(card) => <PosterCard card={card} onOpen={openCard} />}
                  </For>
                </div>
              </section>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";

import { api } from "../lib/api";
import { coverFor, ensureArt } from "../lib/art";
import { KIND_LABELS } from "./ShikiCard";
import { normalise } from "../lib/match";
import { closePalette, navigate, sources } from "../lib/store";
import type { AnimeCard, DiscoverCard } from "../lib/types";
import { Art } from "./Art";
import { Icon } from "./Icon";

const DEBOUNCE = 300;
const LIMIT = 8;

type Hit =
  | { kind: "shiki"; card: DiscoverCard }
  | { kind: "source"; card: AnimeCard };

export function Palette() {
  const [draft, setDraft] = createSignal("");
  const [needle, setNeedle] = createSignal("");
  const [hits, setHits] = createSignal<Hit[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [fallback, setFallback] = createSignal(false);
  const [cursor, setCursor] = createSignal(0);

  let field: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  let timer: number | undefined;
  let generation = 0;

  onMount(() => field?.focus());

  createEffect(() => {
    const value = draft();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setNeedle(value.trim()), DEBOUNCE);
  });

  onCleanup(() => window.clearTimeout(timer));

  createEffect(() => {
    const query = needle();
    const ticket = ++generation;

    if (query.length < 2) {
      setHits([]);
      setBusy(false);
      setFallback(false);
      return;
    }

    setBusy(true);
    void (async () => {
      let found: Hit[] = [];
      let usedFallback = false;

      try {
        const cards = await api.discoverSearch({ query, order: "popularity" });
        found = cards.slice(0, LIMIT).map((card) => ({ kind: "shiki", card }) as Hit);
      } catch {
        usedFallback = true;
      }

      if (found.length === 0) {
        try {
          const keys = sources().map((item) => item.key);
          const result = await api.searchMulti(keys, query);
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
          found = flat.slice(0, LIMIT).map((card) => ({ kind: "source", card }) as Hit);
          usedFallback = true;
        } catch {
          found = [];
        }
      }

      if (ticket !== generation) return;
      setHits(found);
      setFallback(usedFallback);
      setCursor(0);
      setBusy(false);

      const ids = found
        .filter((hit): hit is Extract<Hit, { kind: "shiki" }> => hit.kind === "shiki")
        .map((hit) => hit.card.id);
      if (ids.length > 0) void ensureArt(ids);
    })();
  });

  createEffect(() => {
    const index = cursor();
    const node = list?.children[index];
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
  });

  const open = (hit: Hit) => {
    closePalette();
    if (hit.kind === "shiki") {
      navigate({
        name: "title",
        query: hit.card.title,
        aliases: [hit.card.originalTitle],
        year: hit.card.year,
        shikiId: hit.card.id,
      });
    } else {
      navigate({
        name: "title",
        query: hit.card.title,
        aliases: [hit.card.meta.altTitle ?? ""],
        card: hit.card,
        year: hit.card.meta.year,
      });
    }
  };

  const openFullSearch = () => {
    const query = draft().trim();
    closePalette();
    navigate({ name: "search", query });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const total = hits().length;

    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (total > 0) setCursor((cursor() + 1) % total);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (total > 0) setCursor((cursor() - 1 + total) % total);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const target = hits()[cursor()];
      if (target) open(target);
      else if (draft().trim().length > 0) openFullSearch();
    }
  };

  return (
    <div class="palette" onKeyDown={onKeyDown}>
      <div class="palette__backdrop" onClick={closePalette} />

      <div class="palette__panel">
        <div class="palette__field">
          <Icon name="search" size={17} />
          <input
            ref={field}
            type="search"
            placeholder="Название аниме"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            spellcheck={false}
            autocomplete="off"
          />
          <Show when={busy()}>
            <span class="spinner" />
          </Show>
          <span class="kbd">Esc</span>
        </div>

        <Show when={draft().trim().length >= 2}>
          <div class="palette__body">
            <Show
              when={hits().length > 0}
              fallback={
                <Show when={!busy()}>
                  <div class="palette__empty">
                    Ничего не нашлось — попробуйте оригинальное название
                  </div>
                </Show>
              }
            >
              <div class="palette__list" ref={list}>
                <For each={hits()}>
                  {(hit, index) => (
                    <button
                      class="palette__hit"
                      data-active={cursor() === index()}
                      onMouseEnter={() => setCursor(index())}
                      onClick={() => open(hit)}
                    >
                      <div class="palette__art">
                        <Art src={artFor(hit)} title={titleOf(hit)} />
                      </div>
                      <div class="palette__text">
                        <div class="palette__name">{titleOf(hit)}</div>
                        <div class="palette__meta">{metaOf(hit)}</div>
                      </div>
                      <Icon name="enter" size={14} />
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <button class="palette__foot" onClick={openFullSearch}>
              <Icon name="sliders" size={14} />
              Открыть полный поиск
              <Show when={fallback()}>
                <span class="palette__note">
                  каталог не ответил — результаты из плееров
                </span>
              </Show>
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}

function titleOf(hit: Hit) {
  return hit.card.title;
}

function artFor(hit: Hit) {
  return hit.kind === "shiki"
    ? coverFor(hit.card.id, hit.card.poster)
    : hit.card.poster;
}

function metaOf(hit: Hit) {
  if (hit.kind === "source") {
    const parts: string[] = [];
    if (hit.card.meta.year) parts.push(String(hit.card.meta.year));
    if (hit.card.episodeBadge) parts.push(hit.card.episodeBadge);
    return parts.join(" · ");
  }

  const parts: string[] = [];
  if (hit.card.kind) parts.push(KIND_LABELS[hit.card.kind] ?? hit.card.kind);
  if (hit.card.year) parts.push(String(hit.card.year));
  if (hit.card.episodes) parts.push(`${hit.card.episodes} сер.`);
  if (hit.card.score) parts.push(`★ ${hit.card.score.toFixed(1)}`);
  return parts.join(" · ");
}

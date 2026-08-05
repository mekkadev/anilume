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
import { api } from "../lib/api";
import { activeSource, navigate, sourceName, sources } from "../lib/store";
import type { AnimeCard } from "../lib/types";

const DEBOUNCE = 300;

export function Search(props: { query: string }) {
  const [everywhere, setEverywhere] = createSignal(false);
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

  const [results] = createResource(
    () => [needle(), everywhere(), activeSource()] as const,
    async ([query, all, source]) => {
      if (query.trim().length === 0) return { groups: [], failures: [] };
      if (!all) {
        const { items } = await api.search(source, query);
        return { groups: [{ source, items }], failures: [] };
      }

      const keys = sources().map((item) => item.key);
      const result = await api.searchMulti(keys, query);
      return {
        groups: result.groups.filter((group) => group.items.length > 0),
        failures: result.failures,
      };
    },
  );

  const total = () =>
    (results()?.groups ?? []).reduce((sum, group) => sum + group.items.length, 0);

  const openCard = (card: AnimeCard) =>
    navigate({ name: "title", query: card.title, card });

  return (
    <div class="fade-in">
      <div class="page-head">
        <div>
          <h1 class="page-title">Поиск</h1>
          <p class="page-sub">
            <Show when={needle().length > 0} fallback="По названию, в выбранном источнике или во всех сразу">
              <Show when={!results.loading} fallback="Ищем…">
                «{needle()}» — найдено: {total()}
              </Show>
            </Show>
          </p>
        </div>

        <div class="segment">
          <button data-active={!everywhere()} onClick={() => setEverywhere(false)}>
            {sourceName(activeSource())}
          </button>
          <button data-active={everywhere()} onClick={() => setEverywhere(true)}>
            Везде
          </button>
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

      <Show when={needle().length > 0} fallback={<div class="empty" />}>
      <Show
        when={!results.loading}
        fallback={
          <div class="poster-grid">
            <Index each={Array(10).fill(0)}>{() => <PosterSkeleton />}</Index>
          </div>
        }
      >
        <Show
          when={total() > 0}
          fallback={
            <div class="empty">
              <div class="empty__title">Ничего не найдено</div>
              <p>Попробуйте другое написание или поищите во всех источниках</p>
              <Show when={!everywhere()}>
                <button class="btn btn--primary" onClick={() => setEverywhere(true)}>
                  Искать везде
                </button>
              </Show>
            </div>
          }
        >
          <For each={results()?.groups}>
            {(group) => (
              <section class="section">
                <Show when={everywhere()}>
                  <div class="section__head">
                    <h2 class="section__title">{sourceName(group.source)}</h2>
                    <span class="page-sub">{group.items.length}</span>
                  </div>
                </Show>
                <div class="poster-grid">
                  <For each={group.items}>
                    {(card) => <PosterCard card={card} onOpen={openCard} />}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>

        <Show when={(results()?.failures ?? []).length > 0}>
          <div class="failures">
            <For each={results()?.failures}>
              {(failure) => (
                <span class="chip chip--warning">
                  {sourceName(failure.source)}: {failure.error.message}
                </span>
              )}
            </For>
          </div>
        </Show>
      </Show>
      </Show>
    </div>
  );
}

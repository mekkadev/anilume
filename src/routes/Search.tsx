import { For, Index, Show, createResource, createSignal } from "solid-js";

import { PosterCard, PosterSkeleton } from "../components/PosterCard";
import { api } from "../lib/api";
import { activeSource, navigate, sourceName, sources } from "../lib/store";
import type { AnimeCard } from "../lib/types";

export function Search(props: { query: string }) {
  const [everywhere, setEverywhere] = createSignal(false);

  const [results] = createResource(
    () => [props.query, everywhere(), activeSource()] as const,
    async ([query, all, source]) => {
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

  const openCard = (card: AnimeCard) => navigate({ name: "title", card });

  return (
    <div class="fade-in">
      <div class="page-head">
        <div>
          <h1 class="page-title">«{props.query}»</h1>
          <p class="page-sub">
            <Show when={!results.loading} fallback="Ищем…">
              Найдено: {total()}
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
    </div>
  );
}

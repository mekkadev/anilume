import { For, Show, createResource, createSignal } from "solid-js";

import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { navigate, reportError, sourceName } from "../lib/store";
import type { LibraryEntry, LibraryStatus } from "../lib/types";

const TABS: { key: LibraryStatus | "all"; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "watching", label: "Смотрю" },
  { key: "planned", label: "В планах" },
  { key: "completed", label: "Просмотрено" },
  { key: "on_hold", label: "Отложено" },
  { key: "dropped", label: "Брошено" },
];

export function Library() {
  const [tab, setTab] = createSignal<LibraryStatus | "all">("all");
  const [opening, setOpening] = createSignal<string | null>(null);

  const [entries, { refetch }] = createResource(tab, (status) =>
    api.libraryList(status === "all" ? undefined : status),
  );

  const open = async (entry: LibraryEntry) => {
    setOpening(entry.animeKey);
    try {
      navigate({ name: "title", query: entry.title, source: entry.source });
    } catch (error) {
      reportError(error);
    } finally {
      setOpening(null);
    }
  };

  const remove = async (entry: LibraryEntry) => {
    try {
      await api.libraryRemove(entry.source, entry.animeKey);
      await refetch();
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div class="fade-in">
      <div class="page-head">
        <div>
          <h1 class="page-title">Библиотека</h1>
          <p class="page-sub">Сохранённые тайтлы</p>
        </div>
      </div>

      <div class="segment segment--wide">
        <For each={TABS}>
          {(item) => (
            <button data-active={tab() === item.key} onClick={() => setTab(item.key)}>
              {item.label}
            </button>
          )}
        </For>
      </div>

      <Show
        when={(entries() ?? []).length > 0}
        fallback={
          <div class="empty">
            <div class="empty__title">Здесь пусто</div>
            <p>Добавляйте тайтлы кнопкой «В библиотеку» на странице аниме</p>
          </div>
        }
      >
        <div class="library-list">
          <For each={entries()}>
            {(entry) => (
              <div class="library-row">
                <button
                  class="library-row__main"
                  onClick={() => void open(entry)}
                  disabled={opening() === entry.animeKey}
                >
                  <div class="library-row__art">
                    <Show when={entry.poster}>
                      <img src={entry.poster!} alt="" loading="lazy" decoding="async" />
                    </Show>
                  </div>
                  <div class="library-row__body">
                    <div class="library-row__title">{entry.title}</div>
                    <div class="library-row__meta">
                      {sourceName(entry.source)} · обновлено {relativeTime(entry.updatedAt)}
                    </div>
                  </div>
                </button>

                <button
                  class="tool-btn btn--danger"
                  title="Убрать"
                  onClick={() => void remove(entry)}
                >
                  <Icon name="trash" size={17} />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

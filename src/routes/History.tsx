import { For, Show, createMemo, createResource, createSignal } from "solid-js";

import { Art } from "../components/Art";
import { RowsSkeleton } from "../components/PosterCard";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { pending, settled } from "../lib/resource";
import { formatTime, plural, relativeTime } from "../lib/format";
import { navigate, openPalette, pushToast, reportError } from "../lib/store";
import type { WatchProgress } from "../lib/types";

interface Bucket {
  label: string;
  items: WatchProgress[];
}

function bucketOf(unixSeconds: number): string {
  const now = new Date();
  const when = new Date(unixSeconds * 1000);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((startOfToday.getTime() - when.getTime()) / 86_400_000);

  if (when >= startOfToday) return "Сегодня";
  if (days < 1) return "Вчера";
  if (days < 7) return "На этой неделе";
  if (days < 30) return "В этом месяце";
  return "Раньше";
}

export function History() {
  const [historyRes, { refetch }] = createResource(() => api.watchHistory(300));
  const history = () => settled(historyRes);
  const [opening, setOpening] = createSignal<string | null>(null);

  const buckets = createMemo<Bucket[]>(() => {
    const groups = new Map<string, WatchProgress[]>();
    for (const item of history() ?? []) {
      const label = bucketOf(item.updatedAt);
      const list = groups.get(label);
      if (list) list.push(item);
      else groups.set(label, [item]);
    }
    return [...groups].map(([label, items]) => ({ label, items }));
  });

  const total = () => (history() ?? []).length;

  const open = async (item: WatchProgress) => {
    setOpening(`${item.animeKey}:${item.episodeOrdinal}`);
    try {
      navigate({
        name: "title",
        query: item.animeTitle,
        source: item.source,
      });
    } catch (error) {
      reportError(error);
    } finally {
      setOpening(null);
    }
  };

  const forget = async (item: WatchProgress) => {
    try {
      await api.forgetAnime(item.source, item.animeKey);
      await refetch();
      pushToast(`«${item.animeTitle}» убран из истории`);
    } catch (error) {
      reportError(error);
    }
  };

  const clearAll = async () => {
    try {
      await api.clearHistory();
      await refetch();
      pushToast("История очищена");
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div class="fade-in">
      <div class="page-head">
        <div>
          <h1 class="page-title">История</h1>
          <p class="page-sub">
            <Show when={total() > 0} fallback="Пока ничего не просмотрено">
              {total()} {plural(total(), "запись", "записи", "записей")}
            </Show>
          </p>
        </div>
        <Show when={total() > 0}>
          <button class="btn btn--danger" onClick={() => void clearAll()}>
            <Icon name="trash" size={14} />
            Очистить
          </button>
        </Show>
      </div>

      <Show when={!pending(historyRes)} fallback={<RowsSkeleton />}>
      <Show
        when={total() > 0}
        fallback={
          <div class="empty">
            <div class="empty__title">История пуста</div>
            <p>Здесь появятся серии, которые вы смотрели</p>
            <div class="empty__actions">
              <button class="btn btn--primary" onClick={openPalette}>
                Найти аниме
              </button>
            </div>
          </div>
        }
      >
        <For each={buckets()}>
          {(bucket) => (
            <section class="section">
              <div class="section__head">
                <h2 class="section__title">{bucket.label}</h2>
                <span class="page-sub">{bucket.items.length}</span>
              </div>

              <div class="library-list">
                <For each={bucket.items}>
                  {(item) => {
                    const percent = () =>
                      item.durationSec > 0
                        ? Math.min((item.positionSec / item.durationSec) * 100, 100)
                        : 0;
                    const finished = () => percent() >= 92;

                    return (
                      <div class="library-row">
                        <button
                          class="library-row__main"
                          disabled={opening() === `${item.animeKey}:${item.episodeOrdinal}`}
                          onClick={() => void open(item)}
                        >
                          <div class="library-row__art">
                            <Show when={item.poster}>
                              <Art src={item.poster} title={item.animeTitle} />
                            </Show>
                          </div>

                          <div class="library-row__body">
                            <div class="library-row__title">{item.animeTitle}</div>
                            <div class="library-row__meta">
                              {[`Серия ${item.episodeOrdinal}`, item.studio]
                                .filter(
                                  (part, index, all) =>
                                    part && all.indexOf(part) === index,
                                )
                                .join(" · ")}
                            </div>
                            <div class="history-row__foot">
                              <Show
                                when={!finished()}
                                fallback={<span class="history-row__done">Просмотрено</span>}
                              >
                                <span>
                                  {formatTime(item.positionSec)} из{" "}
                                  {formatTime(item.durationSec)}
                                </span>
                              </Show>
                              <span>{relativeTime(item.updatedAt)}</span>
                            </div>
                            <Show when={percent() > 1 && !finished()}>
                              <div class="download-row__bar">
                                <span style={{ width: `${percent()}%` }} />
                              </div>
                            </Show>
                          </div>
                        </button>

                        <button
                          class="tool-btn btn--danger"
                          title="Забыть этот тайтл"
                          onClick={() => void forget(item)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    );
                  }}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>
      </Show>
    </div>
  );
}

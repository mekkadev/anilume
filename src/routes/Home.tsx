import { For, Index, Show, createResource, createSignal } from "solid-js";

import { Icon } from "../components/Icon";
import { PosterCard, PosterSkeleton } from "../components/PosterCard";
import { api } from "../lib/api";
import { formatTime, relativeTime } from "../lib/format";
import { resolveCard } from "../lib/resolve";
import {
  activeSource,
  navigate,
  reportError,
  sourceName,
  sources,
} from "../lib/store";
import type { AnimeCard, ContinueItem } from "../lib/types";

export function Home() {
  const [ongoing, { refetch }] = createResource(activeSource, async (source) => {
    const result = await api.ongoing(source);
    return result.items;
  });

  const [resuming, setResuming] = createSignal<string | null>(null);
  const [continueList, { refetch: refetchContinue }] = createResource(() =>
    api.continueWatching(12),
  );

  const openCard = (card: AnimeCard) => navigate({ name: "title", card });

  const openContinue = async (item: ContinueItem) => {
    setResuming(item.animeKey);
    try {
      const card = await resolveCard(item.source, item.animeKey, item.animeTitle);
      openCard(card);
    } catch (error) {
      reportError(error);
    } finally {
      setResuming(null);
    }
  };

  const geoNote = () =>
    sources().find((source) => source.key === activeSource())?.geoRestricted ??
    false;

  return (
    <div class="fade-in">
      <Show when={(continueList() ?? []).length > 0}>
        <section class="section">
          <div class="section__head">
            <h2 class="section__title">Продолжить смотреть</h2>
            <button class="btn btn--ghost" onClick={() => void refetchContinue()}>
              <Icon name="refresh" size={16} />
              Обновить
            </button>
          </div>

          <div class="resume-rail">
            <For each={continueList()}>
              {(item) => (
                <ResumeCard
                  item={item}
                  busy={resuming() === item.animeKey}
                  onOpen={() => void openContinue(item)}
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      <section class="section">
        <div class="page-head">
          <div>
            <h1 class="page-title">Онгоинги</h1>
            <p class="page-sub">
              Свежие серии — {sourceName(activeSource())}
              <Show when={geoNote()}> · нужен IP СНГ</Show>
            </p>
          </div>
          <button class="btn btn--ghost" onClick={() => void refetch()}>
            <Icon name="refresh" size={16} />
            Обновить
          </button>
        </div>

        <Show
          when={!ongoing.loading}
          fallback={
            <div class="poster-grid">
              <Index each={Array(12).fill(0)}>{() => <PosterSkeleton />}</Index>
            </div>
          }
        >
          <Show
            when={!ongoing.error}
            fallback={
              <div class="empty">
                <div class="empty__title">Источник не ответил</div>
                <p>
                  {(ongoing.error as { message?: string })?.message ??
                    "Попробуйте другой источник в боковой панели"}
                </p>
                <button class="btn btn--primary" onClick={() => void refetch()}>
                  Повторить
                </button>
              </div>
            }
          >
            <Show
              when={(ongoing() ?? []).length > 0}
              fallback={
                <div class="empty">
                  <div class="empty__title">Пусто</div>
                  <p>Источник не вернул онгоингов</p>
                </div>
              }
            >
              <div class="poster-grid">
                <For each={ongoing()}>
                  {(card) => <PosterCard card={card} onOpen={openCard} />}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </section>
    </div>
  );
}

function ResumeCard(props: {
  item: ContinueItem;
  busy: boolean;
  onOpen: () => void;
}) {
  const percent = () =>
    props.item.durationSec > 0
      ? Math.min((props.item.positionSec / props.item.durationSec) * 100, 100)
      : 0;

  const label = () =>
    props.item.finished
      ? `Серия ${props.item.episodeOrdinal} просмотрена`
      : `Серия ${props.item.episodeOrdinal} · ${formatTime(props.item.positionSec)}`;

  return (
    <button class="resume" onClick={props.onOpen} disabled={props.busy}>
      <div class="resume__art">
        <Show when={props.item.poster}>
          <img src={props.item.poster!} alt="" loading="lazy" decoding="async" />
        </Show>
        <div class="resume__shade" />
        <div class="resume__play">
          <Icon name={props.busy ? "clock" : "play"} size={18} />
        </div>
      </div>

      <div class="resume__body">
        <div class="resume__title">{props.item.animeTitle}</div>
        <div class="resume__meta">{label()}</div>
        <div class="resume__bar">
          <span style={{ width: `${percent()}%` }} />
        </div>
        <div class="resume__foot">
          <span>{sourceName(props.item.source)}</span>
          <span>{relativeTime(props.item.updatedAt)}</span>
        </div>
      </div>
    </button>
  );
}

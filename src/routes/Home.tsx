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
import { KIND_LABELS, Score, ShikiCard } from "../components/ShikiCard";
import { api } from "../lib/api";
import { formatTime, relativeTime } from "../lib/format";
import { resolveCard } from "../lib/resolve";
import {
  activeSource,
  navigate,
  pushToast,
  reportError,
  setAmbient,
  sourceName,
} from "../lib/store";
import type { AnimeCard, ContinueItem, DiscoverCard } from "../lib/types";

const HERO_COUNT = 5;
const HERO_INTERVAL = 9000;
const CURRENT_YEAR = new Date().getFullYear();

export function Home() {
  const [popular] = createResource(() =>
    api.discoverSearch({ order: "popularity" }),
  );
  const [fresh] = createResource(() =>
    api.discoverSearch({ order: "aired_on", yearFrom: CURRENT_YEAR - 1 }),
  );
  const [best] = createResource(() => api.discoverSearch({ order: "ranked" }));
  const [ongoing, { refetch: refetchOngoing }] = createResource(
    activeSource,
    async (source) => (await api.ongoing(source)).items,
  );
  const [continueList] = createResource(() => api.continueWatching(12));

  const [forYou] = createResource(
    () => continueList()?.[0]?.animeTitle ?? null,
    async (title) => {
      const anchor = await api.discoverMatch(title);
      if (!anchor) return null;
      const items = await api.discoverSimilar(anchor.id, 18);
      return { anchor, items };
    },
  );

  const [opening, setOpening] = createSignal<number | null>(null);
  const [resuming, setResuming] = createSignal<string | null>(null);

  const heroes = () => (popular() ?? []).slice(0, HERO_COUNT);
  const [heroIndex, setHeroIndex] = createSignal(0);
  const [details, setDetails] = createSignal<Record<number, HeroDetail>>({});

  const hero = () => heroes()[heroIndex()] ?? null;
  const heroDetail = () => {
    const current = hero();
    return current ? (details()[current.id] ?? null) : null;
  };

  const loadDetail = async (card: DiscoverCard) => {
    if (details()[card.id]) return;
    try {
      const detail = await api.discoverTitle(card.id);
      setDetails({
        ...details(),
        [card.id]: {
          art: detail.art,
          description: detail.description,
          genres: detail.genres,
          studio: detail.studios[0]?.name ?? null,
        },
      });
    } catch {
      setDetails({
        ...details(),
        [card.id]: { art: [], description: "", genres: [], studio: null },
      });
    }
  };

  createEffect(() => {
    const current = hero();
    if (!current) return;
    void loadDetail(current);
    const next = heroes()[heroIndex() + 1];
    if (next) void loadDetail(next);
    setAmbient(heroDetail()?.art[0] ?? current.poster);
  });

  onMount(() => {
    const timer = window.setInterval(() => {
      const total = heroes().length;
      if (total > 1) setHeroIndex((heroIndex() + 1) % total);
    }, HERO_INTERVAL);
    onCleanup(() => window.clearInterval(timer));
  });

  onCleanup(() => setAmbient(null));

  const openCard = (card: AnimeCard) => navigate({ name: "title", card });

  const openShiki = async (card: DiscoverCard) => {
    setOpening(card.id);
    try {
      navigate({
        name: "title",
        card: await resolveCard(activeSource(), "", card.title),
      });
    } catch {
      try {
        navigate({
          name: "title",
          card: await resolveCard(activeSource(), "", card.originalTitle),
        });
      } catch {
        pushToast(
          `«${card.title}» не нашлось в источнике ${sourceName(activeSource())}`,
          "error",
          "Выберите другой источник внизу боковой панели",
        );
      }
    } finally {
      setOpening(null);
    }
  };

  const openContinue = async (item: ContinueItem) => {
    setResuming(item.animeKey);
    try {
      openCard(await resolveCard(item.source, item.animeKey, item.animeTitle));
    } catch (error) {
      reportError(error);
    } finally {
      setResuming(null);
    }
  };

  return (
    <div class="fade-in">
      <Show when={hero()} fallback={<div class="hero hero--empty" />}>
        {(current) => (
          <section class="hero">
            <div class="hero__art">
              <Show when={heroDetail()?.art[0] ?? current().poster}>
                <HeroArt src={(heroDetail()?.art[0] ?? current().poster)!} />
              </Show>
            </div>
            <div class="hero__fade" />

            <div class="hero__body">
              <div class="hero__thumbs">
                <For each={(heroDetail()?.art ?? []).slice(1, 4)}>
                  {(shot) => (
                    <div class="hero__thumb">
                      <img src={shot} alt="" loading="lazy" decoding="async" />
                    </div>
                  )}
                </For>
              </div>

              <h1 class="hero__title">{current().title}</h1>

              <div class="hero__facts">
                <Show when={current().score}>
                  <div class="score-block">
                    <span class="score-block__label">Оценка</span>
                    <Score value={current().score!} />
                  </div>
                </Show>
                <Show when={current().kind}>
                  <span class="chip">
                    {KIND_LABELS[current().kind!] ?? current().kind}
                  </span>
                </Show>
                <For each={(heroDetail()?.genres ?? []).slice(0, 3)}>
                  {(genre) => <span class="chip">{genre}</span>}
                </For>
              </div>

              <p class="hero__text">
                {heroDetail()?.description || "Описание пока не подгрузилось."}
              </p>

              <div class="hero__foot">
                <div class="hero__dots">
                  <For each={heroes()}>
                    {(_, index) => (
                      <button
                        class="hero__dot"
                        data-active={heroIndex() === index()}
                        onClick={() => setHeroIndex(index())}
                      />
                    )}
                  </For>
                </div>

                <button
                  class="btn btn--primary btn--lg"
                  disabled={opening() === current().id}
                  onClick={() => void openShiki(current())}
                >
                  <Icon name="play" size={14} />
                  Смотреть
                </button>
              </div>
            </div>
          </section>
        )}
      </Show>

      <Show when={(continueList() ?? []).length > 0}>
        <Row title="Продолжить смотреть">
          <div class="row__track row__track--wide">
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
        </Row>
      </Show>

      <ShikiRow
        title="Популярное"
        items={popular()}
        loading={popular.loading}
        opening={opening()}
        onOpen={openShiki}
      />

      <ShikiRow
        title="Новинки"
        items={fresh()}
        loading={fresh.loading}
        opening={opening()}
        onOpen={openShiki}
      />

      <Row title="Сейчас выходит" hint={sourceName(activeSource())}>
        <Show
          when={!ongoing.loading}
          fallback={<SkeletonTrack />}
        >
          <Show
            when={(ongoing() ?? []).length > 0}
            fallback={
              <div class="empty">
                <div class="empty__title">Источник не ответил</div>
                <p>Выберите другой внизу боковой панели</p>
                <button class="btn btn--primary" onClick={() => void refetchOngoing()}>
                  Повторить
                </button>
              </div>
            }
          >
            <div class="row__track">
              <For each={ongoing()}>
                {(card) => <PosterCard card={card} onOpen={openCard} />}
              </For>
            </div>
          </Show>
        </Show>
      </Row>

      <ShikiRow
        title="Лучшее"
        items={best()}
        loading={best.loading}
        opening={opening()}
        onOpen={openShiki}
      />

      <Show when={forYou()}>
        {(found) => (
          <ShikiRow
            title="Для вас"
            hint={`похоже на «${found().anchor.title}»`}
            items={found().items}
            loading={false}
            opening={opening()}
            onOpen={openShiki}
          />
        )}
      </Show>
    </div>
  );
}

interface HeroDetail {
  art: string[];
  description: string;
  genres: string[];
  studio: string | null;
}

function HeroArt(props: { src: string }) {
  const [loaded, setLoaded] = createSignal(false);

  return (
    <img
      src={props.src}
      alt=""
      decoding="async"
      data-loaded={loaded()}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
    />
  );
}

function Row(props: { title: string; hint?: string; children: any }) {
  return (
    <section class="row">
      <div class="row__head">
        <h2 class="section__title">{props.title}</h2>
        <Show when={props.hint}>
          <span class="page-sub">{props.hint}</span>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

function SkeletonTrack() {
  return (
    <div class="row__track">
      <Index each={Array(8).fill(0)}>{() => <PosterSkeleton />}</Index>
    </div>
  );
}

function ShikiRow(props: {
  title: string;
  hint?: string;
  items: DiscoverCard[] | undefined;
  loading: boolean;
  opening: number | null;
  onOpen: (card: DiscoverCard) => void;
}) {
  return (
    <Show when={props.loading || (props.items ?? []).length > 0}>
      <Row title={props.title} hint={props.hint}>
        <Show when={!props.loading} fallback={<SkeletonTrack />}>
          <div class="row__track">
            <For each={props.items}>
              {(card) => (
                <ShikiCard
                  card={card}
                  busy={props.opening === card.id}
                  onOpen={props.onOpen}
                />
              )}
            </For>
          </div>
        </Show>
      </Row>
    </Show>
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

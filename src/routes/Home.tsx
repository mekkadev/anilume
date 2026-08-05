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

import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { PosterCard, PosterSkeleton } from "../components/PosterCard";
import { KIND_LABELS, Score, ShikiCard } from "../components/ShikiCard";
import { api } from "../lib/api";
import { bannerFor, coverFor, ensureArt } from "../lib/art";
import { broke, pending, settled } from "../lib/resource";
import { formatTime, relativeTime } from "../lib/format";
import { activeSource, navigate, setAmbient, sourceName } from "../lib/store";
import type { AnimeCard, ContinueItem, DiscoverCard } from "../lib/types";

const HERO_COUNT = 5;
const HERO_INTERVAL = 9000;
const CURRENT_YEAR = new Date().getFullYear();

export function Home() {
  const [popularRes] = createResource(() =>
    api.discoverSearch({ order: "popularity" }),
  );
  const [freshRes] = createResource(() =>
    api.discoverSearch({ order: "aired_on", yearFrom: CURRENT_YEAR - 1 }),
  );
  const [bestRes] = createResource(() => api.discoverSearch({ order: "ranked" }));
  const [ongoingRes, { refetch: refetchOngoing }] = createResource(
    activeSource,
    async (source) => (await api.ongoing(source)).items,
  );
  const [continueRes] = createResource(() => api.continueWatching(12));

  const popular = () => settled(popularRes);
  const fresh = () => settled(freshRes);
  const best = () => settled(bestRes);
  const ongoing = () => settled(ongoingRes);
  const continueList = () => settled(continueRes);

  const [forYouRes] = createResource(
    () => continueList()?.[0]?.animeTitle ?? null,
    async (title) => {
      const anchor = await api.discoverMatch(title);
      if (!anchor) return null;
      const items = await api.discoverSimilar(anchor.id, 18);
      return { anchor, items };
    },
  );
  const forYou = () => settled(forYouRes);


  createEffect(() => {
    const ids = [
      ...(popular() ?? []),
      ...(fresh() ?? []),
      ...(best() ?? []),
      ...(forYou()?.items ?? []),
    ].map((card) => card.id);
    if (ids.length > 0) void ensureArt(ids);
  });

  const heroes = () => (popular() ?? []).slice(0, HERO_COUNT);
  const [heroIndex, setHeroIndex] = createSignal(0);
  const [details, setDetails] = createSignal<Record<number, HeroDetail>>({});

  const hero = () => heroes()[heroIndex()] ?? null;
  const heroDetail = () => {
    const current = hero();
    const found = current ? (details()[current.id] ?? null) : null;
    return found && found.loaded ? found : null;
  };

  const heroArt = () => {
    const current = hero();
    if (!current) return null;
    return heroDetail()?.art[0] ?? bannerFor(current.id) ?? null;
  };

  const loadDetail = async (card: DiscoverCard) => {
    if (details()[card.id]) return;
    try {
      const detail = await api.discoverTitle(card.id);
      setDetails({
        ...details(),
        [card.id]: {
          loaded: true,
          art: detail.art,
          description: detail.description,
          genres: detail.genres,
          studio: detail.studios[0]?.name ?? null,
        },
      });
    } catch {
      setDetails({
        ...details(),
        [card.id]: { loaded: false, art: [], description: "", genres: [], studio: null },
      });
    }
  };

  createEffect(() => {
    const current = hero();
    if (!current) return;
    void loadDetail(current);
    const next = heroes()[heroIndex() + 1];
    if (next) void loadDetail(next);
    setAmbient(heroArt() ?? coverFor(current.id, current.poster));
  });

  onMount(() => {
    const timer = window.setInterval(() => {
      const total = heroes().length;
      if (total > 1) setHeroIndex((heroIndex() + 1) % total);
    }, HERO_INTERVAL);
    onCleanup(() => window.clearInterval(timer));
  });

  onCleanup(() => setAmbient(null));

  const openCard = (card: AnimeCard) =>
    navigate({ name: "title", query: card.title, card });

  const openShiki = (card: DiscoverCard) =>
    navigate({ name: "title", query: card.title });

  const openContinue = (item: ContinueItem) =>
    navigate({ name: "title", query: item.animeTitle, source: item.source });

  return (
    <div class="fade-in">
      <Show when={hero()} fallback={<Show when={pending(popularRes)}><div class="hero hero--empty" /></Show>}>
        {(current) => (
          <section class="hero">
            <div class="hero__art" data-fallback={!heroArt()}>
              <Show
                when={heroArt()}
                fallback={
                  <Show when={coverFor(current().id, current().poster)}>
                    <HeroArt src={coverFor(current().id, current().poster)!} />
                  </Show>
                }
              >
                <HeroArt src={heroArt()!} />
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

              <Show when={heroDetail()?.description}>
                <p class="hero__text">{heroDetail()!.description}</p>
              </Show>

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
                  onClick={() => openShiki(current())}
                >
                  <Icon name="play" size={14} />
                  Смотреть
                </button>
              </div>
            </div>
          </section>
        )}
      </Show>

      <Show when={broke(popularRes)}>
        <div class="page-head">
          <div>
            <h1 class="page-title">Главная</h1>
            <p class="page-sub">Что смотреть сегодня</p>
          </div>
        </div>

        <div class="empty">
          <div class="empty__title">Каталог Shikimori не отвечает</div>
          <p>
            Подборки и описания подтянутся, когда он вернётся. Список ниже —
            из выбранного источника, он работает сам по себе.
          </p>
        </div>
      </Show>

      <Show when={(continueList() ?? []).length > 0}>
        <Row title="Продолжить смотреть">
          <div class="row__track row__track--wide">
            <For each={continueList()}>
              {(item) => (
                <ResumeCard item={item} onOpen={() => openContinue(item)} />
              )}
            </For>
          </div>
        </Row>
      </Show>

      <ShikiRow
        title="Популярное"
        items={popular()}
        loading={pending(popularRes)}
        onOpen={openShiki}
      />

      <ShikiRow
        title="Новинки"
        items={fresh()}
        loading={pending(freshRes)}
        onOpen={openShiki}
      />

      <Row title="Сейчас выходит" hint={sourceName(activeSource())}>
        <Show
          when={!pending(ongoingRes)}
          fallback={<SkeletonTrack />}
        >
          <Show
            when={(ongoing() ?? []).length > 0}
            fallback={
              <div class="empty">
                <div class="empty__title">Источник не ответил</div>
                <p>Выберите другой источник внизу рельса</p>
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
        loading={pending(bestRes)}
        onOpen={openShiki}
      />

      <Show when={forYou()}>
        {(found) => (
          <ShikiRow
            title="Для вас"
            hint={`похоже на «${found().anchor.title}»`}
            items={found().items}
            loading={false}
                onOpen={openShiki}
          />
        )}
      </Show>
    </div>
  );
}

interface HeroDetail {
  loaded: boolean;
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
  onOpen: (card: DiscoverCard) => void;
}) {
  return (
    <Show when={props.loading || (props.items ?? []).length > 0}>
      <Row title={props.title} hint={props.hint}>
        <Show when={!props.loading} fallback={<SkeletonTrack />}>
          <div class="row__track">
            <For each={props.items}>
              {(card) => <ShikiCard card={card} onOpen={props.onOpen} />}
            </For>
          </div>
        </Show>
      </Row>
    </Show>
  );
}

function ResumeCard(props: { item: ContinueItem; onOpen: () => void }) {
  const percent = () =>
    props.item.durationSec > 0
      ? Math.min((props.item.positionSec / props.item.durationSec) * 100, 100)
      : 0;

  const label = () =>
    props.item.finished
      ? `Серия ${props.item.episodeOrdinal} просмотрена`
      : `Серия ${props.item.episodeOrdinal} · ${formatTime(props.item.positionSec)}`;

  return (
    <button class="resume" onClick={props.onOpen}>
      <div class="resume__art">
        <Art src={props.item.poster} title={props.item.animeTitle} />
        <div class="resume__shade" />
        <div class="resume__play">
          <Icon name="play" size={18} />
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

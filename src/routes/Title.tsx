import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";

import { Icon } from "../components/Icon";
import { Score, ShikiCard } from "../components/ShikiCard";
import { Toggle } from "../components/Toggle";
import { api } from "../lib/api";
import { episodesLabel, plural, qualityLabel } from "../lib/format";
import {
  QUALITY_LABELS,
  QUALITY_ORDER,
  QUALITY_SHORT,
  autoplayNext,
  episodeOrder,
  pickQualityIndex,
  qualityPref,
  rememberDub,
  setAutoplayNext,
  setEpisodeOrder,
  setQualityPref,
  setRememberDub,
} from "../lib/prefs";
import { resolveCard } from "../lib/resolve";
import {
  activeSource,
  navigate,
  openPlayer,
  pushToast,
  reportError,
  setAmbient,
  sourceName,
} from "../lib/store";
import type {
  AnimeCard,
  DiscoverCard,
  VideoInfo,
  AnimeDetail,
  EpisodeInfo,
  LibraryEntry,
  LibraryStatus,
  StudioInfo,
  WatchProgress,
} from "../lib/types";

const LIBRARY_LABELS: Record<LibraryStatus, string> = {
  watching: "Смотрю",
  planned: "В планах",
  completed: "Просмотрено",
  on_hold: "Отложено",
  dropped: "Брошено",
};

function studioSettingKey(source: string, animeKey: string) {
  return `studio:${source}:${animeKey}`;
}

export function Title(props: { card: AnimeCard }) {
  const [detail] = createResource(
    () => props.card.handle,
    (handle) => api.anime(handle),
  );

  const [progress, { refetch: refetchProgress }] = createResource(
    () => [props.card.source, props.card.key] as const,
    ([source, key]) => api.animeProgress(source, key),
  );

  const [libraryEntry, { refetch: refetchLibrary }] = createResource(
    () => [props.card.source, props.card.key] as const,
    ([source, key]) => api.libraryGet(source, key),
  );

  const [shiki] = createResource(
    () => detail(),
    async (info) => {
      const known = info.meta.shikimoriId ?? info.meta.malId;
      const id =
        known ??
        (await api.discoverMatch(info.title, info.meta.year ?? undefined))?.id ??
        null;
      return id ? await api.discoverTitle(id) : null;
    },
  );

  const [related] = createResource(
    () => shiki()?.id ?? null,
    (id) => api.discoverRelated(id),
  );

  const [similar] = createResource(
    () => shiki()?.id ?? null,
    (id) => api.discoverSimilar(id, 16),
  );

  const [comments] = createResource(
    () => shiki()?.topicId ?? null,
    (topicId) => api.discoverComments(topicId, 15),
  );

  createEffect(() => setAmbient(shiki()?.art[0] ?? detail()?.poster ?? null));
  onCleanup(() => setAmbient(null));

  const [opening, setOpening] = createSignal<number | null>(null);

  const openShiki = async (card: DiscoverCard) => {
    setOpening(card.id);
    try {
      navigate({
        name: "title",
        card: await resolveCard(activeSource(), "", card.title),
      });
    } catch {
      pushToast(
        `«${card.title}» не нашлось в источнике ${sourceName(activeSource())}`,
        "error",
        "Выберите другой источник внизу боковой панели",
      );
    } finally {
      setOpening(null);
    }
  };

  const [selectedDub, setSelectedDub] = createSignal<string | null>(null);
  const [busyEpisode, setBusyEpisode] = createSignal<number | null>(null);
  const [batch, setBatch] = createSignal<{ done: number; total: number } | null>(null);
  const [expanded, setExpanded] = createSignal(false);

  const progressFor = (ordinal: number): WatchProgress | undefined =>
    (progress() ?? []).find((item) => item.episodeOrdinal === ordinal);

  const nextEpisode = (): EpisodeInfo | undefined => {
    const episodes = detail()?.episodes ?? [];
    const watched = progress() ?? [];
    if (watched.length === 0) return episodes[0];

    const latest = watched.reduce((best, item) =>
      item.updatedAt > best.updatedAt ? item : best,
    );
    const index = episodes.findIndex((ep) => ep.ordinal === latest.episodeOrdinal);
    if (index < 0) return episodes[0];

    const finished =
      latest.durationSec > 0 && latest.positionSec >= latest.durationSec * 0.92;
    return finished ? episodes[index + 1] ?? episodes[index] : episodes[index];
  };

  const [studios] = createResource(
    () => nextEpisode()?.handle,
    (handle) => api.studios(handle).then((result) => result.studios),
  );

  const orderedEpisodes = createMemo(() => {
    const episodes = [...(detail()?.episodes ?? [])];
    return episodeOrder() === "desc" ? episodes.reverse() : episodes;
  });

  createEffect(() => {
    const available = studios();
    if (!available || available.length === 0) return;
    if (selectedDub() && available.some((item) => item.title === selectedDub())) return;

    void (async () => {
      const remembered = rememberDub()
        ? await api.settingGet(studioSettingKey(props.card.source, props.card.key))
        : null;
      const match = available.find((item) => item.title === remembered);
      setSelectedDub((match ?? available[0]!).title);
    })();
  });

  const chooseDub = (studio: StudioInfo) => {
    setSelectedDub(studio.title);
    if (rememberDub()) {
      void api.settingSet(
        studioSettingKey(props.card.source, props.card.key),
        studio.title,
      );
    }
  };

  async function resolveStudio(episode: EpisodeInfo): Promise<StudioInfo | null> {
    const { studios: available } = await api.studios(episode.handle);
    if (available.length === 0) {
      pushToast("Для этой серии нет доступных плееров", "error");
      return null;
    }
    return available.find((item) => item.title === selectedDub()) ?? available[0]!;
  }

  const play = async (episode: EpisodeInfo) => {
    const info = detail();
    if (!info) return;

    setBusyEpisode(episode.ordinal);
    try {
      const downloaded = await api
        .downloadsFindCompleted(props.card.source, props.card.key, episode.ordinal)
        .catch(() => null);

      let studioTitle: string | null = null;
      let videos: VideoInfo[];

      if (downloaded) {
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        studioTitle = downloaded.studio;
        videos = [
          {
            type: "mp4",
            quality: downloaded.quality,
            url: convertFileSrc(downloaded.filePath),
            headers: {},
          },
        ];
      } else {
        const studio = await resolveStudio(episode);
        if (!studio) return;

        studioTitle = studio.title;
        const resolved = await api.videos(studio.handle);
        if (resolved.videos.length === 0) {
          pushToast(`«${studio.title}» не отдал видео — выберите другую озвучку`, "error");
          return;
        }
        videos = resolved.videos;
      }

      const saved = progressFor(episode.ordinal);
      const resumeAt =
        saved && saved.durationSec > 0 && saved.positionSec < saved.durationSec * 0.92
          ? saved.positionSec
          : 0;

      openPlayer({
        source: props.card.source,
        animeKey: props.card.key,
        animeTitle: info.title,
        poster: info.poster,
        episodes: info.episodes,
        episodeIndex: info.episodes.findIndex((ep) => ep.ordinal === episode.ordinal),
        studioTitle,
        videos,
        startAt: resumeAt,
        qualityIndex: downloaded ? 0 : pickQualityIndex(videos, qualityPref()),
        autoplayNext: autoplayNext(),
        offline: Boolean(downloaded),
        malId: info.meta.malId ?? null,
        episodeNumbers: info.episodes.map((item) => item.ordinal),
      });
    } catch (error) {
      reportError(error);
    } finally {
      setBusyEpisode(null);
    }
  };

  const download = async (episode: EpisodeInfo) => {
    const info = detail();
    if (!info) return;

    setBusyEpisode(episode.ordinal);
    try {
      if (!(await api.downloadsAvailable())) {
        pushToast("Не найден ffmpeg — скачивание недоступно", "error");
        return;
      }

      const studio = await resolveStudio(episode);
      if (!studio) return;

      const { videos } = await api.videos(studio.handle);
      const target = videos[pickQualityIndex(videos, qualityPref())];
      if (!target) {
        pushToast("Озвучка не отдала видео", "error");
        return;
      }

      await api.downloadsEnqueue({
        source: props.card.source,
        animeKey: props.card.key,
        animeTitle: info.title,
        poster: info.poster,
        episodeOrdinal: episode.ordinal,
        episodeTitle: episode.title,
        studio: studio.title,
        quality: target.quality,
        url: target.url,
        headers: target.headers,
      });
      pushToast(
        `Серия ${episode.ordinal} в очереди · ${qualityLabel(target.quality)}`,
        "success",
      );
    } catch (error) {
      reportError(error);
    } finally {
      setBusyEpisode(null);
    }
  };

  const downloadSeason = async () => {
    const info = detail();
    if (!info || batch()) return;

    if (!(await api.downloadsAvailable())) {
      pushToast("Не найден ffmpeg — скачивание недоступно", "error");
      return;
    }

    const pending = info.episodes.filter((episode) => {
      const saved = progressFor(episode.ordinal);
      return !(saved && saved.durationSec > 0 && saved.positionSec >= saved.durationSec * 0.92);
    });

    if (pending.length === 0) {
      pushToast("Все серии уже просмотрены", "info");
      return;
    }

    setBatch({ done: 0, total: pending.length });
    let queued = 0;
    let failed = 0;

    for (const episode of pending) {
      try {
        const studio = await resolveStudio(episode);
        if (!studio) {
          failed += 1;
          continue;
        }

        const { videos } = await api.videos(studio.handle);
        const target = videos[pickQualityIndex(videos, qualityPref())];
        if (!target) {
          failed += 1;
          continue;
        }

        await api.downloadsEnqueue({
          source: props.card.source,
          animeKey: props.card.key,
          animeTitle: info.title,
          poster: info.poster,
          episodeOrdinal: episode.ordinal,
          episodeTitle: episode.title,
          studio: studio.title,
          quality: target.quality,
          url: target.url,
          headers: target.headers,
        });
        queued += 1;
      } catch {
        failed += 1;
      }
      setBatch({ done: queued + failed, total: pending.length });
    }

    setBatch(null);
    if (queued === 0) {
      pushToast("Ни одну серию не удалось поставить в очередь", "error");
    } else {
      pushToast(
        failed === 0
          ? `В очереди ${queued} ${plural(queued, "серия", "серии", "серий")}`
          : `В очереди ${queued}, не вышло ${failed}`,
        failed === 0 ? "success" : "info",
      );
    }
  };

  const setLibraryStatus = async (status: LibraryStatus) => {
    const info = detail();
    if (!info) return;

    const entry: LibraryEntry = {
      source: props.card.source,
      animeKey: props.card.key,
      title: info.title,
      poster: info.poster,
      status,
      score: libraryEntry()?.score ?? null,
      shikimoriId: info.meta.shikimoriId,
      updatedAt: 0,
    };

    try {
      await api.libraryUpsert(entry);
      await refetchLibrary();
      pushToast(`Добавлено: ${LIBRARY_LABELS[status]}`, "success");
      void syncShikimori(info, status);
    } catch (error) {
      reportError(error);
    }
  };

  const removeFromLibrary = async () => {
    try {
      await api.libraryRemove(props.card.source, props.card.key);
      await refetchLibrary();
      pushToast("Убрано из библиотеки");
    } catch (error) {
      reportError(error);
    }
  };

  const syncShikimori = async (info: AnimeDetail, status: LibraryStatus) => {
    if (!info.meta.shikimoriId) return;
    try {
      const account = await api.shikimoriStatus();
      if (!account.loggedIn) return;
      await api.shikimoriSetRate(info.meta.shikimoriId, status, undefined, undefined);
    } catch {
      // Синхронизация не должна мешать локальной работе.
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") void refetchProgress();
  };
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));

  return (
    <div class="fade-in">
      <Show when={detail()} fallback={<TitleSkeleton />}>
        {(info) => (
          <>
            <section class="title-hero">
              <div class="title-hero__art">
                <Show when={shiki()?.art[0]}>
                  <img src={shiki()!.art[0]} alt="" decoding="async" />
                </Show>
              </div>
              <div class="title-hero__fade" />

              <div class="title-hero__grid">
                <div class="title-poster">
                  <Show when={info().poster} fallback={<div class="skeleton" />}>
                    <img src={info().poster!} alt={info().title} decoding="async" />
                  </Show>
                </div>

                <div class="title-info">
                  <div>
                    <h1 class="title-info__name">{info().title}</h1>
                    <Show when={shiki()?.japanese ?? info().meta.altTitle}>
                      <div class="title-info__alt">
                        {shiki()?.japanese ?? info().meta.altTitle}
                      </div>
                    </Show>
                  </div>

                  <div class="title-info__row">
                    <Show when={shiki()?.score ?? info().meta.score}>
                      {(value) => (
                        <div class="score-block">
                          <span class="score-block__label">Оценка</span>
                          <Score value={value()} />
                        </div>
                      )}
                    </Show>

                    <div class="facts">
                      <Show when={(shiki()?.studios ?? []).length > 0}>
                        <div>
                          <div class="fact__label">Студия</div>
                          <div class="fact__value">
                            {shiki()!.studios.map((studio) => studio.name).join(", ")}
                          </div>
                        </div>
                      </Show>
                      <div>
                        <div class="fact__label">Серии</div>
                        <div class="fact__value">
                          {episodesLabel(info().episodes.length)}
                        </div>
                      </div>
                      <Show when={shiki()?.duration}>
                        <div>
                          <div class="fact__label">Серия идёт</div>
                          <div class="fact__value">{shiki()!.duration} мин.</div>
                        </div>
                      </Show>
                      <Show when={info().meta.year}>
                        <div>
                          <div class="fact__label">Год</div>
                          <div class="fact__value">{info().meta.year}</div>
                        </div>
                      </Show>
                      <Show when={info().meta.status}>
                        <div>
                          <div class="fact__label">Статус</div>
                          <div class="fact__value">{info().meta.status}</div>
                        </div>
                      </Show>
                      <div>
                        <div class="fact__label">Источник</div>
                        <div class="fact__value">{sourceName(props.card.source)}</div>
                      </div>
                    </div>
                  </div>

                  <Show
                    when={(shiki()?.genres ?? info().meta.genres ?? []).length > 0}
                  >
                    <div class="title-info__row">
                      <For each={shiki()?.genres ?? info().meta.genres ?? []}>
                        {(genre) => <span class="chip">{genre}</span>}
                      </For>
                      <Show when={info().meta.ageRating}>
                        <span class="chip">{info().meta.ageRating}</span>
                      </Show>
                    </div>
                  </Show>

                  <Show when={shiki()?.description || info().description}>
                    <div>
                      <p class="title-info__text" data-clamped={!expanded()}>
                        {shiki()?.description || info().description}
                      </p>
                      <button class="link-btn" onClick={() => setExpanded(!expanded())}>
                        {expanded() ? "Свернуть" : "Читать полностью"}
                      </button>
                    </div>
                  </Show>

                  <div class="title-info__row">
                    <Show when={nextEpisode()}>
                      {(episode) => (
                        <button
                          class="btn btn--primary btn--lg"
                          onClick={() => void play(episode())}
                          disabled={busyEpisode() !== null}
                        >
                          <Icon name="play" size={15} />
                          {progressFor(episode().ordinal)
                            ? `Продолжить · серия ${episode().ordinal}`
                            : `Смотреть · серия ${episode().ordinal}`}
                        </button>
                      )}
                    </Show>

                    <LibraryMenu
                      current={libraryEntry()?.status ?? null}
                      onPick={(status) => void setLibraryStatus(status)}
                      onRemove={() => void removeFromLibrary()}
                    />

                    <ViewSettings />
                  </div>
                </div>
              </div>
            </section>

            <section class="section">
              <div class="section__head">
                <h2 class="section__title">Озвучка</h2>
                <Show when={studios()}>
                  <span class="page-sub">
                    {studios()!.length}{" "}
                    {plural(studios()!.length, "вариант", "варианта", "вариантов")}
                  </span>
                </Show>
              </div>

              <Show
                when={!studios.loading}
                fallback={
                  <div class="dub-row">
                    <span class="spinner" />
                    <span class="page-sub">Загружаем варианты озвучки…</span>
                  </div>
                }
              >
                <Show
                  when={(studios() ?? []).length > 0}
                  fallback={
                    <div class="dub-row">
                      <span class="page-sub">
                        Источник не отдал плееров для этого тайтла
                      </span>
                    </div>
                  }
                >
                  <div class="dub-row">
                    <For each={studios()}>
                      {(studio) => (
                        <button
                          class="dub"
                          data-active={selectedDub() === studio.title}
                          onClick={() => chooseDub(studio)}
                        >
                          <span class="dub__name">{studio.title}</span>
                          <span class="dub__player">{studio.player}</span>
                          <Show when={selectedDub() === studio.title}>
                            <Icon name="check" size={14} />
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </section>

            <section class="section">
              <div class="section__head">
                <h2 class="section__title">Серии</h2>
                <div class="section__tools">
                  <button
                    class="btn"
                    onClick={() => void downloadSeason()}
                    disabled={batch() !== null || busyEpisode() !== null}
                  >
                    <Show
                      when={batch()}
                      fallback={
                        <>
                          <Icon name="download" size={14} />
                          Скачать непросмотренные
                        </>
                      }
                    >
                      {(state) => (
                        <>
                          <span class="spinner" />
                          {state().done} из {state().total}
                        </>
                      )}
                    </Show>
                  </button>
                  <div class="segment">
                  <button
                    data-active={episodeOrder() === "asc"}
                    onClick={() => setEpisodeOrder("asc")}
                  >
                    Сначала первые
                  </button>
                  <button
                    data-active={episodeOrder() === "desc"}
                    onClick={() => setEpisodeOrder("desc")}
                  >
                    Сначала новые
                  </button>
                  </div>
                </div>
              </div>

              <div class="episode-grid">
                <For each={orderedEpisodes()}>
                  {(episode) => {
                    const saved = () => progressFor(episode.ordinal);
                    const percent = () => {
                      const item = saved();
                      if (!item || item.durationSec <= 0) return 0;
                      return Math.min((item.positionSec / item.durationSec) * 100, 100);
                    };
                    const watched = () => percent() >= 92;

                    return (
                      <div class="episode" data-watched={watched()}>
                        <button
                          class="episode__main"
                          onClick={() => void play(episode)}
                          disabled={busyEpisode() !== null}
                        >
                          <span class="episode__num">
                            <Show
                              when={busyEpisode() === episode.ordinal}
                              fallback={
                                <Show when={watched()} fallback={episode.ordinal}>
                                  <Icon name="check" size={14} />
                                </Show>
                              }
                            >
                              <span class="spinner" />
                            </Show>
                          </span>
                          <span class="episode__title">{episode.title}</span>
                        </button>

                        <button
                          class="episode__pick"
                          title="Скачать серию"
                          onClick={() => void download(episode)}
                          disabled={busyEpisode() !== null}
                        >
                          <Icon name="download" size={15} />
                        </button>

                        <Show when={percent() > 1 && !watched()}>
                          <div class="episode__bar">
                            <span style={{ width: `${percent()}%` }} />
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </section>

            <Show when={(related() ?? []).length > 0}>
              <section class="row">
                <div class="row__head">
                  <h2 class="section__title">Сезоны и связанное</h2>
                  <span class="page-sub">по данным Shikimori</span>
                </div>

                <div class="row__track row__track--wide">
                  <For each={related()}>
                    {(entry) => (
                      <button
                        class="season-card"
                        disabled={opening() === entry.card.id}
                        onClick={() => void openShiki(entry.card)}
                      >
                        <div class="season-card__art">
                          <Show when={entry.card.poster}>
                            <img
                              src={entry.card.poster!}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          </Show>
                          <span class="season-card__relation">{entry.relation}</span>
                        </div>
                        <div class="season-card__title">{entry.card.title}</div>
                      </button>
                    )}
                  </For>
                </div>
              </section>
            </Show>

            <Show when={(similar() ?? []).length > 0}>
              <section class="row">
                <div class="row__head">
                  <h2 class="section__title">Похожее</h2>
                </div>

                <div class="row__track">
                  <For each={similar()}>
                    {(card) => (
                      <ShikiCard
                        card={card}
                        busy={opening() === card.id}
                        onOpen={(chosen) => void openShiki(chosen)}
                      />
                    )}
                  </For>
                </div>
              </section>
            </Show>

            <Show when={(comments() ?? []).length > 0}>
              <section class="section">
                <div class="section__head">
                  <h2 class="section__title">Комментарии</h2>
                  <span class="page-sub">обсуждение на Shikimori</span>
                </div>

                <div class="comments">
                  <For each={comments()}>
                    {(comment) => (
                      <article class="comment">
                        <div class="comment__avatar">
                          <Show when={comment.avatar}>
                            <img src={comment.avatar!} alt="" loading="lazy" />
                          </Show>
                        </div>
                        <div>
                          <div class="comment__head">
                            <span class="comment__who">{comment.author}</span>
                            <span class="comment__when">
                              {commentDate(comment.createdAt)}
                            </span>
                          </div>
                          <div class="comment__body">{comment.body}</div>
                        </div>
                      </article>
                    )}
                  </For>
                </div>
              </section>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function commentDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function ViewSettings() {
  const [open, setOpen] = createSignal(false);

  return (
    <div class="menu">
      <button class="btn" onClick={() => setOpen(!open())} title="Настройки просмотра">
        <Icon name="settings" size={15} />
      </button>

      <Show when={open()}>
        <div class="menu__backdrop" onClick={() => setOpen(false)} />
        <div class="menu__list menu__list--wide">
          <div class="pref">
            <span>Следующая серия сама</span>
            <Toggle checked={autoplayNext()} onChange={setAutoplayNext} />
          </div>

          <div class="pref">
            <span>Запоминать озвучку</span>
            <Toggle checked={rememberDub()} onChange={setRememberDub} />
          </div>

          <div class="pref pref--stack">
            <span>Качество по умолчанию</span>
            <div class="segment">
              <For each={QUALITY_ORDER}>
                {(value) => (
                  <button
                    data-active={qualityPref() === value}
                    title={QUALITY_LABELS[value]}
                    onClick={() => setQualityPref(value)}
                  >
                    {QUALITY_SHORT[value]}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

function LibraryMenu(props: {
  current: LibraryStatus | null;
  onPick: (status: LibraryStatus) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = createSignal(false);

  return (
    <div class="menu">
      <button class="btn" onClick={() => setOpen(!open())}>
        <Icon name="bookmark" size={14} />
        {props.current ? LIBRARY_LABELS[props.current] : "В библиотеку"}
      </button>

      <Show when={open()}>
        <div class="menu__backdrop" onClick={() => setOpen(false)} />
        <div class="menu__list">
          <For each={Object.entries(LIBRARY_LABELS) as [LibraryStatus, string][]}>
            {([status, label]) => (
              <button
                class="menu__item"
                data-active={props.current === status}
                onClick={() => {
                  props.onPick(status);
                  setOpen(false);
                }}
              >
                {label}
                <Show when={props.current === status}>
                  <Icon name="check" size={14} />
                </Show>
              </button>
            )}
          </For>
          <Show when={props.current}>
            <button
              class="menu__item menu__item--danger"
              onClick={() => {
                props.onRemove();
                setOpen(false);
              }}
            >
              Убрать
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function TitleSkeleton() {
  return (
    <div class="title-hero">
      <div class="title-hero__grid">
        <div class="title-poster skeleton" />
        <div class="title-info">
          <div class="skeleton" style={{ height: "30px", width: "58%", "border-radius": "7px" }} />
          <div class="skeleton" style={{ height: "14px", width: "34%", "border-radius": "5px", "margin-top": "12px" }} />
          <div class="skeleton" style={{ height: "64px", width: "100%", "border-radius": "9px", "margin-top": "20px" }} />
        </div>
      </div>
    </div>
  );
}

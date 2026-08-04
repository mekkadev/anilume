import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";

import { Icon } from "../components/Icon";
import { StudioSheet } from "../components/StudioSheet";
import { api } from "../lib/api";
import { episodesLabel } from "../lib/format";
import { openPlayer, pushToast, reportError, sourceName } from "../lib/store";
import type {
  AnimeCard,
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

  const [pendingEpisode, setPendingEpisode] = createSignal<EpisodeInfo | null>(null);
  const [studios, setStudios] = createSignal<StudioInfo[] | null>(null);
  const [busyEpisode, setBusyEpisode] = createSignal<number | null>(null);
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

    const finished = latest.durationSec > 0 && latest.positionSec >= latest.durationSec * 0.92;
    return finished ? episodes[index + 1] ?? episodes[index] : episodes[index];
  };

  const startEpisode = async (episode: EpisodeInfo, forcePick = false) => {
    setBusyEpisode(episode.ordinal);
    try {
      const { studios: available } = await api.studios(episode.handle);
      if (available.length === 0) {
        pushToast("Для этой серии нет доступных плееров", "error");
        return;
      }

      const remembered = await api.settingGet(
        studioSettingKey(props.card.source, props.card.key),
      );
      const preferred = available.find((studio) => studio.title === remembered);

      if (forcePick || (available.length > 1 && !preferred)) {
        setPendingEpisode(episode);
        setStudios(available);
        return;
      }

      await launch(episode, preferred ?? available[0]!);
    } catch (error) {
      reportError(error);
    } finally {
      setBusyEpisode(null);
    }
  };

  const launch = async (episode: EpisodeInfo, studio: StudioInfo) => {
    const info = detail();
    if (!info) return;

    setBusyEpisode(episode.ordinal);
    try {
      const { videos } = await api.videos(studio.handle);
      if (videos.length === 0) {
        pushToast(`«${studio.title}» не отдал видео — выберите другую озвучку`, "error");
        return;
      }

      await api.settingSet(
        studioSettingKey(props.card.source, props.card.key),
        studio.title,
      );

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
        studioTitle: studio.title,
        videos,
        startAt: resumeAt,
      });
    } catch (error) {
      reportError(error);
    } finally {
      setBusyEpisode(null);
      setPendingEpisode(null);
      setStudios(null);
    }
  };

  const downloadEpisode = async (episode: EpisodeInfo) => {
    const info = detail();
    if (!info) return;

    setBusyEpisode(episode.ordinal);
    try {
      if (!(await api.downloadsAvailable())) {
        pushToast("Не найден ffmpeg — скачивание недоступно", "error");
        return;
      }

      const { studios } = await api.studios(episode.handle);
      if (studios.length === 0) {
        pushToast("Для этой серии нет плееров", "error");
        return;
      }

      const remembered = await api.settingGet(
        studioSettingKey(props.card.source, props.card.key),
      );
      const studio =
        studios.find((item) => item.title === remembered) ?? studios[0]!;

      const { videos } = await api.videos(studio.handle);
      const best = videos[0];
      if (!best) {
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
        quality: best.quality,
        url: best.url,
        headers: best.headers,
      });
      pushToast(`Серия ${episode.ordinal} добавлена в загрузки`, "success");
    } catch (error) {
      reportError(error);
    } finally {
      setBusyEpisode(null);
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

  createEffect(() => {
    if (detail()) void refetchProgress();
  });

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
            <section class="hero">
              <Show when={info().poster}>
                <div
                  class="hero__backdrop"
                  style={{ "background-image": `url(${info().poster})` }}
                />
              </Show>

              <div class="hero__inner">
                <div class="hero__poster">
                  <Show when={info().poster} fallback={<div class="skeleton" />}>
                    <img src={info().poster!} alt={info().title} decoding="async" />
                  </Show>
                </div>

                <div class="hero__body">
                  <h1 class="hero__title">{info().title}</h1>
                  <Show when={info().meta.altTitle}>
                    <div class="hero__alt">{info().meta.altTitle}</div>
                  </Show>

                  <div class="hero__chips">
                    <Show when={info().meta.score}>
                      <span class="chip chip--warning">
                        <Icon name="star" size={12} />
                        {info().meta.score!.toFixed(1)}
                      </span>
                    </Show>
                    <Show when={info().meta.year}>
                      <span class="chip">{info().meta.year}</span>
                    </Show>
                    <Show when={info().meta.kind}>
                      <span class="chip">{info().meta.kind}</span>
                    </Show>
                    <Show when={info().meta.status}>
                      <span class="chip chip--accent">{info().meta.status}</span>
                    </Show>
                    <Show when={info().meta.ageRating}>
                      <span class="chip">{info().meta.ageRating}</span>
                    </Show>
                    <span class="chip">{episodesLabel(info().episodes.length)}</span>
                    <span class="chip">{sourceName(props.card.source)}</span>
                  </div>

                  <Show when={info().meta.genres.length > 0}>
                    <div class="hero__genres">{info().meta.genres.join(" · ")}</div>
                  </Show>

                  <Show when={info().description}>
                    <p class="hero__description" data-expanded={expanded()}>
                      {info().description}
                    </p>
                    <button class="link-btn" onClick={() => setExpanded(!expanded())}>
                      {expanded() ? "Свернуть" : "Читать полностью"}
                    </button>
                  </Show>

                  <div class="hero__actions">
                    <Show when={nextEpisode()}>
                      {(episode) => (
                        <button
                          class="btn btn--primary"
                          onClick={() => void startEpisode(episode())}
                          disabled={busyEpisode() !== null}
                        >
                          <Icon name="play" size={17} />
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
                  </div>
                </div>
              </div>
            </section>

            <section class="section">
              <div class="section__head">
                <h2 class="section__title">Серии</h2>
                <span class="page-sub">{episodesLabel(info().episodes.length)}</span>
              </div>

              <div class="episode-grid">
                <For each={info().episodes}>
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
                          onClick={() => void startEpisode(episode)}
                          disabled={busyEpisode() !== null}
                        >
                          <span class="episode__num">
                            <Show
                              when={busyEpisode() === episode.ordinal}
                              fallback={
                                <Show when={watched()} fallback={episode.ordinal}>
                                  <Icon name="check" size={15} />
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
                          title="Выбрать озвучку"
                          onClick={() => void startEpisode(episode, true)}
                          disabled={busyEpisode() !== null}
                        >
                          <Icon name="subtitles" size={16} />
                        </button>

                        <button
                          class="episode__pick"
                          title="Скачать серию"
                          onClick={() => void downloadEpisode(episode)}
                          disabled={busyEpisode() !== null}
                        >
                          <Icon name="download" size={16} />
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
          </>
        )}
      </Show>

      <Show when={studios() && pendingEpisode()}>
        <StudioSheet
          episode={pendingEpisode()!}
          studios={studios()!}
          onPick={(studio) => void launch(pendingEpisode()!, studio)}
          onClose={() => {
            setStudios(null);
            setPendingEpisode(null);
          }}
        />
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
      <button class="btn btn--ghost" onClick={() => setOpen(!open())}>
        <Icon name="bookmark" size={16} />
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
                  <Icon name="check" size={15} />
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
    <div class="hero">
      <div class="hero__inner">
        <div class="hero__poster skeleton" />
        <div class="hero__body">
          <div class="skeleton" style={{ height: "34px", width: "58%", "border-radius": "8px" }} />
          <div class="skeleton" style={{ height: "16px", width: "34%", "border-radius": "6px", "margin-top": "14px" }} />
          <div class="skeleton" style={{ height: "72px", width: "100%", "border-radius": "10px", "margin-top": "22px" }} />
        </div>
      </div>
    </div>
  );
}

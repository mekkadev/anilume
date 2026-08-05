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
import { openPlayer, pushToast, reportError, sourceName } from "../lib/store";
import type {
  AnimeCard,
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
            <section class="hero">
              <div class="hero__glow">
                <Show when={info().poster}>
                  <div
                    class="hero__backdrop"
                    style={{ "background-image": `url(${info().poster})` }}
                  />
                </Show>
              </div>

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
                        <Icon name="star" size={11} />
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

                  <Show when={(info().meta.genres ?? []).length > 0}>
                    <div class="hero__genres">{(info().meta.genres ?? []).join(" · ")}</div>
                  </Show>

                  <Show when={(info().meta.tags ?? []).length > 0}>
                    <div class="hero__tags">
                      <For each={(info().meta.tags ?? []).slice(0, 8)}>
                        {(tag) => <span class="tag">{tag}</span>}
                      </For>
                    </div>
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
          </>
        )}
      </Show>
    </div>
  );
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
    <div class="hero">
      <div class="hero__inner">
        <div class="hero__poster skeleton" />
        <div class="hero__body">
          <div class="skeleton" style={{ height: "30px", width: "58%", "border-radius": "7px" }} />
          <div class="skeleton" style={{ height: "14px", width: "34%", "border-radius": "5px", "margin-top": "12px" }} />
          <div class="skeleton" style={{ height: "64px", width: "100%", "border-radius": "9px", "margin-top": "20px" }} />
        </div>
      </div>
    </div>
  );
}

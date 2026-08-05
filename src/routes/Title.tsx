import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";

import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { Score, ShikiCard } from "../components/ShikiCard";
import { Toggle } from "../components/Toggle";
import { api } from "../lib/api";
import { bannerFor, coverFor, ensureArt } from "../lib/art";
import { pickMatch } from "../lib/match";
import { pending, settled } from "../lib/resource";
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
import {
  activeSource,
  navigate,
  openPlayer,
  pushToast,
  reportError,
  setAmbient,
  sourceName,
  sources,
} from "../lib/store";
import type {
  AnimeCard,
  DiscoverCard,
  SourceProbe,
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

function sourceSettingKey(query: string) {
  return `source:${query.trim().toLowerCase()}`;
}

interface Resolved {
  card: AnimeCard;
  info: AnimeDetail;
  episode: EpisodeInfo;
  studio: StudioInfo;
  videos: VideoInfo[];
}

function pickBest(items: AnimeCard[], aliases: string[]) {
  return pickMatch(items, aliases, (item) => item.title);
}

export function Title(props: {
  query: string;
  aliases?: string[];
  card?: AnimeCard;
  source?: string;
}) {
  const names = () => {
    const found = [props.query, ...(props.aliases ?? [])];
    return [...new Set(found.map((item) => item.trim()).filter(Boolean))];
  };

  const [candidates, setCandidates] = createSignal<Record<string, AnimeCard>>({});
  const [chosen, setChosen] = createSignal<string | null>(null);
  const [pinned, setPinned] = createSignal(false);
  const [probes, setProbes] = createSignal<Record<string, SourceProbe>>({});
  const [probing, setProbing] = createSignal(false);
  const [scanning, setScanning] = createSignal(false);
  const [scanned, setScanned] = createSignal(false);
  const [missing, setMissing] = createSignal(false);

  const remember = (card: AnimeCard) =>
    setCandidates((current) =>
      current[card.source] ? current : { ...current, [card.source]: card },
    );

  const [primary] = createResource(
    () => props.query,
    async (query) => {
      const known = props.card;
      if (known) {
        remember(known);
        return known;
      }

      const stored = await api
        .settingGet(sourceSettingKey(query))
        .catch(() => null);

      const order = [stored, props.source, activeSource()].filter(
        (key): key is string => Boolean(key),
      );
      const tried = new Set<string>();

      for (const key of order) {
        if (tried.has(key)) continue;
        tried.add(key);
        const found = await api
          .search(key, query)
          .then((result) => pickBest(result.items, names()))
          .catch(() => null);
        if (found) {
          remember(found);
          return found;
        }
      }

      return null;
    },
  );

  createEffect(() => {
    if (primary.state !== "ready") return;
    const found = primary();
    if (found && !chosen()) setChosen(found.source);
    if (!found) setMissing(true);
  });

  const empty = (key: string) => {
    const probe = probes()[key];
    return Boolean(probe) && probe!.episodes === 0;
  };

  const available = () => {
    const order = new Map(sources().map((item) => [item.key, item.priority ?? 50]));
    return Object.values(candidates()).sort((a, b) => {
      const ea = empty(a.source) ? 1 : 0;
      const eb = empty(b.source) ? 1 : 0;
      if (ea !== eb) return ea - eb;

      const qa = probes()[a.source]?.quality ?? 0;
      const qb = probes()[b.source]?.quality ?? 0;
      if (qa !== qb) return qb - qa;
      return (order.get(a.source) ?? 50) - (order.get(b.source) ?? 50);
    });
  };

  const scanOthers = async () => {
    if (scanning() || scanned()) return;
    setScanning(true);
    try {
      const rest = sources()
        .map((item) => item.key)
        .filter((key) => !candidates()[key]);
      if (rest.length === 0) return;

      const result = await api.searchMulti(rest, props.query);
      const merged = { ...candidates() };
      for (const group of result.groups) {
        const best = pickBest(group.items, names());
        if (best) merged[group.source] = best;
      }
      setCandidates(merged);
      setScanned(true);

      const pending = Object.values(merged).filter(
        (card) => !probes()[card.source],
      );
      if (pending.length === 0) return;

      setProbing(true);
      try {
        const { probes: measured } = await api.catalogProbe(
          pending.map((card) => ({ handle: card.handle })),
        );
        const table = { ...probes() };
        for (const probe of measured) {
          if (probe.source) table[probe.source] = probe;
        }
        setProbes(table);
      } finally {
        setProbing(false);
      }
    } catch {
      setScanned(true);
    } finally {
      setScanning(false);
    }
  };

  const barren = () =>
    detailRes.state === "ready" && (detailRes()?.episodes.length ?? 0) === 0;

  createEffect(() => {
    if (probing() || !chosen()) return;
    if (Object.keys(probes()).length === 0) return;

    const key = chosen()!;
    const current = probes()[key];
    const best = available()[0];
    if (!best || best.source === key) return;

    const hollow = barren() || empty(key);
    if (!hollow && pinned()) return;
    if (!hollow && (probes()[best.source]?.quality ?? 0) <= (current?.quality ?? 0)) {
      return;
    }
    if (empty(best.source)) return;

    if (hollow) {
      pushToast(
        `У «${sourceName(key)}» нет серий — включил «${sourceName(best.source)}»`,
        "info",
      );
    }

    setChosen(best.source);
    void api
      .settingSet(sourceSettingKey(props.query), best.source)
      .catch(() => undefined);
  });

  const active = () => {
    const key = chosen();
    return key ? (candidates()[key] ?? null) : null;
  };
  const source = () => active()?.source ?? "";
  const animeKey = () => active()?.key ?? "";

  const chooseSource = (key: string, byHand = true) => {
    if (key === chosen()) return;
    if (byHand) setPinned(true);
    setChosen(key);
    void api.settingSet(sourceSettingKey(props.query), key).catch(() => undefined);
  };

  const [detailRes] = createResource(
    () => active()?.handle ?? null,
    (handle) => api.anime(handle),
  );
  const detail = () => settled(detailRes);

  const decided = () =>
    missing() || detailRes.state === "ready" || detailRes.state === "errored";

  createEffect(() => {
    if (!decided()) return;
    if (!missing() && !barren() && detailRes.state !== "errored") return;
    untrack(() => void scanOthers());
  });

  const target = () => (active() ? ([source(), animeKey()] as const) : null);

  const [progressRes, { refetch: refetchProgress }] = createResource(
    target,
    ([source, key]) => api.animeProgress(source, key),
  );

  const [libraryRes, { refetch: refetchLibrary }] = createResource(
    target,
    ([source, key]) => api.libraryGet(source, key),
  );

  const [shikiRes] = createResource(
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

  const shiki = () => settled(shikiRes) ?? null;

  const [relatedRes] = createResource(
    () => shiki()?.id ?? null,
    (id) => api.discoverRelated(id),
  );

  const [similarRes] = createResource(
    () => shiki()?.id ?? null,
    (id) => api.discoverSimilar(id, 16),
  );

  const [commentsRes] = createResource(
    () => shiki()?.topicId ?? null,
    (topicId) => api.discoverComments(topicId, 15),
  );

  const related = () => settled(relatedRes);
  const similar = () => settled(similarRes);
  const comments = () => settled(commentsRes);
  const progress = () => settled(progressRes);
  const libraryEntry = () => settled(libraryRes);

  const heroArt = () => shiki()?.art[0] ?? bannerFor(shiki()?.id) ?? null;
  const poster = () =>
    coverFor(shiki()?.id, shiki()?.poster ?? detail()?.poster ?? null);

  createEffect(() => {
    const ids = [
      shiki()?.id,
      ...(similar() ?? []).map((card) => card.id),
      ...(related() ?? []).map((entry) => entry.card.id),
    ];
    if (ids.some(Boolean)) void ensureArt(ids);
  });

  createEffect(() => setAmbient(heroArt() ?? poster()));
  onCleanup(() => setAmbient(null));

  const openShiki = (card: DiscoverCard) =>
    navigate({ name: "title", query: card.title, aliases: [card.originalTitle] });

  const [selectedDub, setSelectedDub] = createSignal<string | null>(null);
  const [pickedDub, setPickedDub] = createSignal(false);
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

  const [studiosRes] = createResource(
    () => nextEpisode()?.handle,
    (handle) => api.studios(handle).then((result) => result.studios),
  );
  const studios = () => settled(studiosRes);

  const [dubQuality, setDubQuality] = createSignal<Record<string, number | null>>({});
  const [weighing, setWeighing] = createSignal(false);

  createEffect(() => {
    const available = studios();
    if (!available || available.length === 0) return;

    untrack(() => {
      const unknown = available
        .map((item) => item.handle)
        .filter((handle) => !(handle in dubQuality()));
      if (unknown.length === 0) return;

      setWeighing(true);
      void api
        .studioQualities(unknown)
        .then(({ qualities }) => {
          const table = { ...dubQuality() };
          for (const entry of qualities) table[entry.handle] = entry.quality;
          setDubQuality(table);
        })
        .catch(() => undefined)
        .finally(() => setWeighing(false));
    });
  });

  const bestDub = () => {
    const values = Object.values(dubQuality()).filter(
      (value): value is number => typeof value === "number" && value > 0,
    );
    return values.length > 0 ? Math.max(...values) : null;
  };

  const dubsByQuality = () => {
    const available = [...(studios() ?? [])];
    return available.sort(
      (a, b) => (dubQuality()[b.handle] ?? 0) - (dubQuality()[a.handle] ?? 0),
    );
  };

  const orderedEpisodes = createMemo(() => {
    const episodes = [...(detail()?.episodes ?? [])];
    return episodeOrder() === "desc" ? episodes.reverse() : episodes;
  });

  createEffect(() => {
    const available = studios();
    if (!available || available.length === 0) return;
    if (weighing()) return;
    if (pickedDub() && available.some((item) => item.title === selectedDub())) return;

    void (async () => {
      const remembered = rememberDub()
        ? await api.settingGet(studioSettingKey(source(), animeKey()))
        : null;
      const match = available.find((item) => item.title === remembered);
      setSelectedDub((match ?? dubsByQuality()[0] ?? available[0]!).title);
      setPickedDub(true);
    })();
  });

  const chooseDub = (studio: StudioInfo) => {
    setSelectedDub(studio.title);
    setPickedDub(true);
    if (rememberDub()) {
      void api.settingSet(
        studioSettingKey(source(), animeKey()),
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

  async function resolveFrom(
    card: AnimeCard,
    ordinal: number,
    known?: AnimeDetail,
  ): Promise<Resolved | null> {
    const info = known ?? (await api.anime(card.handle));
    const target = info.episodes.find((item) => item.ordinal === ordinal);
    if (!target) return null;

    const { studios: available } = await api.studios(target.handle);
    if (available.length === 0) return null;

    const studio =
      available.find((item) => item.title === selectedDub()) ?? available[0]!;
    const { videos } = await api.videos(studio.handle);
    if (videos.length === 0) return null;

    return { card, info, episode: target, studio, videos };
  }

  const play = async (episode: EpisodeInfo) => {
    const info = detail();
    if (!info) return;

    setBusyEpisode(episode.ordinal);
    try {
      const downloaded = await api
        .downloadsFindCompleted(source(), animeKey(), episode.ordinal)
        .catch(() => null);

      let studioTitle: string | null = null;
      let videos: VideoInfo[];
      let played: Resolved | null = null;

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
        const current = active();
        let found: Resolved | null = null;

        if (current) {
          found = await resolveFrom(current, episode.ordinal, info).catch(() => null);
        }

        if (!found && !scanned()) {
          pushToast("Источник не отдал серию — ищу в других", "info");
          await scanOthers();
        }

        const queue = available().filter((item) => item.source !== current?.source);
        for (const candidate of found ? [] : queue) {
          found = await resolveFrom(candidate, episode.ordinal).catch(() => null);
          if (found) break;
        }

        if (!found) {
          pushToast("Ни один источник не отдал эту серию", "error");
          return;
        }

        if (found.card.source !== source()) {
          pushToast(
            `«${sourceName(source())}» не отдал серию — включил «${sourceName(found.card.source)}»`,
            "info",
          );
          chooseSource(found.card.source, false);
        }

        played = found;
        studioTitle = found.studio.title;
        videos = found.videos;
      }

      const shown = played?.info ?? info;
      const ordinal = played?.episode.ordinal ?? episode.ordinal;
      const saved = progressFor(episode.ordinal);
      const resumeAt =
        saved && saved.durationSec > 0 && saved.positionSec < saved.durationSec * 0.92
          ? saved.positionSec
          : 0;

      openPlayer({
        source: played?.card.source ?? source(),
        animeKey: played?.card.key ?? animeKey(),
        animeTitle: shown.title,
        poster: shown.poster,
        episodes: shown.episodes,
        episodeIndex: shown.episodes.findIndex((ep) => ep.ordinal === ordinal),
        studioTitle,
        videos,
        startAt: resumeAt,
        qualityIndex: downloaded ? 0 : pickQualityIndex(videos, qualityPref()),
        autoplayNext: autoplayNext(),
        offline: Boolean(downloaded),
        malId: shown.meta.malId ?? null,
        episodeNumbers: shown.episodes.map((item) => item.ordinal),
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
        source: source(),
        animeKey: animeKey(),
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
          source: source(),
          animeKey: animeKey(),
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
      source: source(),
      animeKey: animeKey(),
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
      await api.libraryRemove(source(), animeKey());
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
      <Show
        when={detail()}
        fallback={
          <Show
            when={decided() && scanned() && available().length === 0}
            fallback={<TitleSkeleton />}
          >
            <div class="empty">
              <div class="empty__title">
                Ни один источник не нашёл «{props.query}»
              </div>
              <p>
                Попробуйте оригинальное или английское название — источники
                часто хранят тайтл именно под ним.
              </p>
              <button
                class="btn btn--primary"
                onClick={() => navigate({ name: "search", query: props.query })}
              >
                Открыть поиск
              </button>
            </div>
          </Show>
        }
      >
        {(info) => (
          <>
            <section class="title-hero">
              <div class="title-hero__art">
                <Show when={heroArt()}>
                  <img src={heroArt()!} alt="" decoding="async" />
                </Show>
              </div>
              <div class="title-hero__fade" />

              <div class="title-hero__grid">
                <div class="title-poster">
                  <Art src={poster()} title={info().title} eager />
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

                  <div class="picker">
                    <div class="picker__head">
                      <span class="fact__label">Где смотреть</span>
                      <Show when={scanning() || probing()}>
                        <span class="picker__probing">
                          <span class="spinner" />
                          {probing() ? "проверяем качество" : "ищем в других источниках"}
                        </span>
                      </Show>
                      <Show when={!scanning() && !probing() && !scanned()}>
                        <button
                          class="link-btn"
                          onClick={() => void scanOthers()}
                        >
                          Поискать в других источниках
                        </button>
                      </Show>
                    </div>

                    <div class="picker__row">
                      <For each={available()}>
                        {(candidate) => {
                          const probe = () => probes()[candidate.source];
                          return (
                            <button
                              class="picker__item"
                              data-active={candidate.source === chosen()}
                              onClick={() => chooseSource(candidate.source)}
                            >
                              <span class="picker__name">
                                {sourceName(candidate.source)}
                              </span>
                              <Show
                                when={probe()?.quality}
                                fallback={
                                  <Show when={probe()?.error}>
                                    <span class="picker__meta">не отдаёт видео</span>
                                  </Show>
                                }
                              >
                                <span class="picker__quality">
                                  {qualityLabel(probe()!.quality!)}
                                </span>
                                <Show when={probe()!.dubs > 1}>
                                  <span class="picker__meta">
                                    {probe()!.dubs}{" "}
                                    {plural(probe()!.dubs, "озвучка", "озвучки", "озвучек")}
                                  </span>
                                </Show>
                              </Show>
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </div>

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
                    <Show when={weighing()}>
                      {" · "}
                      меряем качество
                    </Show>
                    <Show when={!weighing() && bestDub()}>
                      {" · "}
                      лучшее {qualityLabel(bestDub()!)}
                    </Show>
                  </span>
                </Show>
              </div>

              <Show
                when={!pending(studiosRes)}
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
                    <For each={dubsByQuality()}>
                      {(studio) => {
                        const height = () => dubQuality()[studio.handle];
                        return (
                          <button
                            class="dub"
                            data-active={selectedDub() === studio.title}
                            data-top={height() === bestDub() && Boolean(bestDub())}
                            onClick={() => chooseDub(studio)}
                          >
                            <span class="dub__name">{studio.title}</span>
                            <Show
                              when={height()}
                              fallback={<span class="dub__player">{studio.player}</span>}
                            >
                              <span class="dub__quality">{qualityLabel(height()!)}</span>
                            </Show>
                            <Show when={selectedDub() === studio.title}>
                              <Icon name="check" size={14} />
                            </Show>
                          </button>
                        );
                      }}
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
                        onClick={() => openShiki(entry.card)}
                      >
                        <div class="season-card__art">
                          <Art
                            src={coverFor(entry.card.id, entry.card.poster)}
                            title={entry.card.title}
                          />
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
                      <ShikiCard card={card} onOpen={openShiki} />
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

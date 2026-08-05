import type { Page } from "@playwright/test";

const poster = (seed: string) => `https://stub.local/${seed}.png`;

const meta = (over: Record<string, unknown> = {}) => ({
  year: 2021,
  genres: ["Экшен", "Драма"],
  score: 8.7,
  episodesTotal: 12,
  kind: "ТВ-сериал",
  ageRating: "16+",
  status: "Вышло",
  altTitle: "Attack on Titan",
  shikimoriId: 101,
  malId: 101,
  episodeDurationMin: 24,
  tags: [],
  ...over,
});

export const TITLES = [
  "Атака титанов",
  "Клинок, рассекающий демонов",
  "Магическая битва",
  "Дороро",
];

const cards = TITLES.map((title, index) => ({
  handle: `search-${index}`,
  source: "anilibria",
  title,
  poster: poster(`card-${index}`),
  key: `https://site/a/${index}`,
  episodeBadge: null,
  dubBadge: null,
  meta: meta(),
}));

export const SOURCE_CARD = cards[0];

const episodes = Array.from({ length: 12 }, (_, i) => ({
  handle: `episode-${i}`,
  ordinal: i + 1,
  title: `Серия ${i + 1}`,
}));

const shiki = TITLES.map((title, i) => ({
  id: 100 + i,
  title,
  originalTitle: `Original ${i}`,
  poster: poster(`shiki-${i}`),
  score: 8.4,
  kind: "tv",
  status: "released",
  year: 2019 + i,
  episodes: 12,
}));

const SOURCE_KEYS = [
  "animelib",
  "anilibria",
  "animego",
  "yummy_anime",
  "anilibme",
  "sameband",
  "dreamcast",
  "yummy_anime_org",
  "animevost",
  "hdrezka",
];

export const ANIME_DETAIL = {
  handle: "anime-1",
  source: "anilibria",
  key: "https://site/a/0",
  title: TITLES[0],
  poster: poster("card-0"),
  description: "Описание из источника.",
  meta: meta(),
  episodes,
};

export const FIXTURES: Record<string, unknown> = {
  sources_list: {
    default: "anilibria",
    sources: SOURCE_KEYS.map((key, i) => ({
      key,
      name: key,
      description: "Источник для теста",
      geoRestricted: false,
      priority: (i + 1) * 10,
      notes: [],
    })),
  },

  catalog_ongoing: { items: cards },
  catalog_search: { items: cards, query: "", echo: true },
  catalog_search_multi: { query: "", groups: [{ source: "anilibria", items: cards }], failures: [] },
  catalog_probe: { probes: [] },
  anime_get: ANIME_DETAIL,
  episode_studios: {
    studios: [
      { handle: "source-1", title: "AniLibria", player: "kodik.info", url: "https://k/1" },
      { handle: "source-2", title: "Студийная банда", player: "aniboom.one", url: "https://a/2" },
    ],
  },
  studio_qualities: {
    qualities: [
      { handle: "source-1", quality: 720, error: null },
      { handle: "source-2", quality: 1080, error: null },
    ],
  },
  studio_videos: {
    videos: [
      { type: "mp4", quality: 1080, url: "https://stub.local/v.mp4", headers: {} },
      { type: "mp4", quality: 720, url: "https://stub.local/v720.mp4", headers: {} },
    ],
  },
  playback_open: { url: "https://stub.local/v.mp4" },
  playback_close: null,
  skip_times: [],

  discover_search: shiki,
  discover_match: shiki[0],
  discover_title: {
    ...shiki[0],
    japanese: "進撃の巨人",
    art: [],
    description: "Полное описание с Shikimori.",
    episodesAired: 12,
    duration: 24,
    rating: "r",
    genres: ["Экшен", "Драма", "Фэнтези"],
    studios: [{ id: 1, name: "Wit Studio" }],
    nextEpisodeAt: null,
    topicId: 555,
  },
  discover_similar: shiki.slice(1),
  discover_related: [{ relation: "Продолжение", card: shiki[1] }],
  discover_comments: [
    {
      id: 1,
      author: "Кто-то",
      avatar: null,
      body: "Лучший тайтл сезона.",
      createdAt: "2024-04-01T10:00:00+03:00",
    },
  ],
  discover_options: { genres: [], studios: [] },
  discover_calendar: [
    {
      card: shiki[0],
      episode: 8,
      airsAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      duration: 24,
    },
    {
      card: shiki[1],
      episode: 3,
      airsAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
      duration: null,
    },
  ],
  artwork_lookup: shiki.map((card) => ({
    malId: card.id,
    cover: poster(`xl-${card.id}`),
    thumb: poster(`l-${card.id}`),
    banner: null,
  })),

  continue_watching: [],
  progress_for_anime: [],
  watch_history: [],
  library_get: null,
  library_list: [
    {
      source: "anilibria",
      animeKey: "https://site/a/0",
      title: TITLES[0],
      poster: poster("card-0"),
      status: "watching",
      score: 9,
      shikimoriId: 100,
      updatedAt: 1,
    },
  ],
  library_upsert: null,
  library_remove: null,

  downloads_available: true,
  downloads_list: [
    {
      id: 1,
      source: "anilibria",
      animeKey: "https://site/a/0",
      animeTitle: TITLES[0],
      poster: poster("card-0"),
      episodeOrdinal: 4,
      episodeTitle: "Серия 4",
      studio: "AniLibria",
      quality: 1080,
      filePath: "/x.mp4",
      status: "error",
      progress: 0,
      error: "Загрузка прервана при выходе из приложения",
      createdAt: 1,
    },
  ],
  downloads_retry: { id: 1, status: "queued" },
  downloads_find_completed: null,

  shikimori_status: { configured: false, loggedIn: false, account: null },
  animelib_servers: { servers: [], selected: "main", hasToken: false },

  notify_status: true,
  notify_set: null,
  cache_stats: { entries: 128, bytes: 2_400_000 },
  cache_clear: 128,

  setting_get: null,
  setting_set: null,
};

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export interface HarnessOptions {
  stalled?: string[];
  overrides?: Record<string, unknown>;
  latencyMs?: number;
  failWhen?: Record<string, string>;
}

export async function installTauri(page: Page, options: HarnessOptions = {}) {
  const payload = {
    fixtures: { ...FIXTURES, ...(options.overrides ?? {}) },
    stalled: options.stalled ?? [],
    latency: options.latencyMs ?? 40,
    failWhen: options.failWhen ?? {},
  };

  await page.addInitScript((config: typeof payload) => {
    const anyWindow = window as unknown as Record<string, unknown>;
    anyWindow.__CALLS__ = [] as string[];
    anyWindow.__TAURI_OS_PLUGIN_INTERNALS__ = { os_type: "macos", platform: "macos" };
    anyWindow.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      invoke: (cmd: string, args: Record<string, unknown>) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(0);
        (anyWindow.__CALLS__ as string[]).push(cmd);

        const trigger = (config.failWhen as Record<string, string>)[cmd];
        if (trigger !== undefined && JSON.stringify(args ?? {}).includes(trigger)) {
          return new Promise((_, reject) =>
            setTimeout(
              () => reject({ kind: "upstream", message: `«${cmd}» не отдал данные` }),
              config.latency,
            ),
          );
        }

        let value = cmd in config.fixtures ? config.fixtures[cmd] : null;

        if (cmd === "catalog_search") {
          const query = String(args?.query ?? "");
          anyWindow.__QUERY__ = query;
          const stub = value as { items: { title?: string }[]; echo?: boolean };
          const base = stub.items[0]!;
          value = stub.echo
            ? { query, items: [{ ...base, title: query, key: `k-${query}` }] }
            : stub;
        }
        if (cmd === "episode_studios") {
          const byPrefix = (config.fixtures.studios_by_prefix ?? null) as Record<
            string,
            unknown[]
          > | null;
          if (byPrefix) {
            const prefix = String(args?.handle ?? "").split(":")[0]!;
            if (byPrefix[prefix]) value = { studios: byPrefix[prefix] };
          }
        }
        if (cmd === "anime_get") {
          const handle = String(args?.handle ?? "anime");
          const base = config.fixtures.anime_get as {
            title: string;
            episodes: { ordinal: number; title: string }[];
          };
          const byHandle = (config.fixtures.anime_by_handle ?? {}) as Record<
            string,
            { title: string }
          >;
          const named = byHandle[handle];
          value = {
            ...base,
            ...(named ?? {}),
            title: named ? named.title : (anyWindow.__QUERY__ ?? base.title),
            episodes: base.episodes.map((episode) => ({
              ...episode,
              handle: `${handle}:ep-${episode.ordinal}`,
            })),
          };
        }

        const delay = config.stalled.includes(cmd) ? 60_000 : config.latency;
        return new Promise((resolve) => setTimeout(() => resolve(value), delay));
      },
      transformCallback: (cb: unknown) => {
        const id = Math.floor(Math.random() * 1e9);
        anyWindow[`_${id}`] = cb;
        return id;
      },
    };
  }, payload);

  await page.route("**stub.local/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
  );
}

export function watchForCrashes(page: Page, sink: string[]) {
  page.on("pageerror", (error) => sink.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") sink.push(message.text());
  });
}

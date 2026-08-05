import { expect, test } from "@playwright/test";

import {
  ANIME_DETAIL,
  SOURCE_CARD,
  TITLES,
  installTauri,
  watchForCrashes,
} from "./harness";

const crashes: string[] = [];

test.beforeEach(async ({ page }) => {
  crashes.length = 0;
  watchForCrashes(page, crashes);
});

test.afterEach(() => {
  expect(crashes.join(" | "), "приложение не должно ронять исключения").toEqual("");
});

test("главная собирается из подборок каталога", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");

  await expect(page.locator(".hero__title")).toHaveText(TITLES[0]);
  await expect(page.getByRole("heading", { name: "Популярное" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Сейчас выходит" })).toBeVisible();
  await expect(page.locator(".card").first()).toBeVisible();
});

test("тайтл открывается, пока поиск по остальным источникам ещё висит", async ({ page }) => {
  await installTauri(page, { stalled: ["catalog_search_multi", "catalog_probe"] });
  await page.goto("/");

  await page.locator(".card").first().click();

  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".episode").first()).toBeVisible({ timeout: 8000 });
});

test("рельс отвечает, пока источники опрашиваются в фоне", async ({ page }) => {
  await installTauri(page, { stalled: ["catalog_search_multi", "catalog_probe"] });
  await page.goto("/");

  await page.locator(".card").first().click();
  await expect(page.locator(".title-info__name")).toBeVisible();

  await page.getByRole("button", { name: "Библиотека" }).click();
  await expect(page.getByRole("heading", { name: "Библиотека" })).toBeVisible({ timeout: 5000 });

  await page.getByRole("button", { name: "Главная" }).click();
  await expect(page.locator(".card").first()).toBeVisible({ timeout: 5000 });
});

test("страница аниме показывает всё, что обещано", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");
  await page.locator(".card").first().click();

  await expect(page.locator(".title-poster img")).toHaveAttribute("src", /xl-/);
  await expect(page.locator(".row .card img").first()).toHaveAttribute("src", /l-/);
  await expect(page.locator(".title-info__name")).toBeVisible();
  const info = page.locator(".title-info");
  await expect(info.locator(".score-block .score")).toBeVisible();
  await expect(info.locator(".title-info__text")).toContainText("Полное описание");
  await expect(info.locator(".chip", { hasText: "Фэнтези" })).toBeVisible();
  await expect(info.locator(".fact__value", { hasText: "Wit Studio" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Серии" })).toBeVisible();
  await expect(page.locator(".episode")).toHaveCount(12);
  await expect(page.locator(".dub").first()).toBeVisible();
  await expect(page.locator(".dub").first()).toContainText("Студийная банда");
  await expect(page.locator(".dub__quality").first()).toHaveText("1080p");
  await expect(page.locator('.dub[data-active="true"] .dub__name')).toHaveText(
    "Студийная банда",
  );

  await expect(page.getByRole("heading", { name: "Франшиза" })).toBeVisible();
  await expect(page.locator('.season-card[data-current="true"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Персонажи" })).toBeVisible();
  await expect(page.locator(".cast__name").first()).toHaveText("Эрен Йегер");
  await expect(page.getByRole("heading", { name: "Похожее" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Комментарии" })).toBeVisible();
  await expect(page.locator(".comment__body")).toContainText("Лучший тайтл сезона");
});

test("переход с тайтла на тайтл перерисовывает страницу", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");
  await page.locator(".card").first().click();

  const name = page.locator(".title-info__name");
  await expect(name).toHaveText(TITLES[0]);

  await page.locator(".row").filter({ hasText: "Похожее" }).locator(".card").first().click();
  await expect(name).not.toHaveText(TITLES[0], { timeout: 8000 });
});

test("серия открывает плеер", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");
  await page.locator(".card").first().click();
  await expect(page.locator(".episode").first()).toBeVisible();

  await page.locator(".episode__main").nth(2).click();

  await expect(page.locator(".player")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".player__title")).toHaveText(TITLES[0]);
  await expect(page.locator(".player__subtitle")).toContainText("Серия 3");

  await page.keyboard.press("Escape");
  await expect(page.locator(".player")).toHaveCount(0);
});

test("упавший каталог не роняет приложение", async ({ page }) => {
  await installTauri(page, {
    failWhen: {
      discover_search: "",
      discover_title: "",
      discover_match: "",
      discover_similar: "",
      discover_related: "",
      discover_comments: "",
    },
  });
  await page.goto("/");

  await expect(page.getByText("Каталог Shikimori не отвечает")).toBeVisible({
    timeout: 8000,
  });

  await page.keyboard.press("Meta+k");
  await page.locator(".palette__field input").fill("атака");
  await expect(page.locator(".palette__hit").first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".palette__note")).toContainText("каталог не ответил");

  await page.keyboard.press("Enter");
  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".episode")).toHaveCount(12);
});

test("источник без плееров не роняет страницу аниме", async ({ page }) => {
  await installTauri(page, { failWhen: { episode_studios: "" } });
  await page.goto("/");
  await page.locator(".card").first().click();

  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });
  await expect(
    page.getByText("Ни один вариант пока не отдал плеер для этого тайтла"),
  ).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".episode")).toHaveCount(12);
});

test("источник без серий уступает тому, у кого они есть", async ({ page }) => {
  await installTauri(page, {
    overrides: {
      anime_get: { ...ANIME_DETAIL, episodes: [] },
      catalog_search_multi: {
        query: "",
        groups: [
          { source: "animego", items: [{ ...SOURCE_CARD, source: "animego", handle: "s-go" }] },
        ],
        failures: [],
      },
      catalog_probe: {
        probes: [
          { source: "anilibria", handle: "search-0", quality: null, dubs: 0, episodes: 0, error: null },
          { source: "animego", handle: "s-go", quality: 1080, dubs: 3, episodes: 12, error: null },
        ],
      },
    },
  });
  await page.goto("/");
  await page.locator(".card").first().click();

  await expect(page.locator(".toast")).toContainText("переключил", { timeout: 10000 });
});

test("чужой тайтл с похожим словом не открывается вместо нужного", async ({ page }) => {
  await installTauri(page, {
    overrides: {
      catalog_search: {
        query: "",
        items: [
          {
            ...SOURCE_CARD,
            title: "Не издевайся, Нагаторо: Вторая атака",
            key: "k-nagatoro",
          },
        ],
      },
      catalog_search_multi: { query: "", groups: [], failures: [] },
    },
  });
  await page.goto("/");
  await page.locator(".card").first().click();

  await expect(page.locator(".title-info__name")).toHaveText(TITLES[0], {
    timeout: 8000,
  });
  await expect(page.getByText("Источники не отдали серии этого тайтла")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("Нагаторо")).toHaveCount(0);
});

test("текст не вылезает за границы кнопок", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");
  await page.locator(".card").first().click();
  await expect(page.locator(".dub").first()).toBeVisible({ timeout: 10000 });

  const escaped = await page.evaluate(() => {
    const selectors = [".dub", ".btn", ".menu__item", ".filter", ".segment button"];
    const bad: string[] = [];

    for (const selector of selectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        const box = node.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;

        for (const child of Array.from(node.children)) {
          const inner = child.getBoundingClientRect();
          if (inner.width === 0 || inner.height === 0) continue;
          if (inner.top < box.top - 0.5 || inner.bottom > box.bottom + 0.5) {
            bad.push(`${selector} → ${child.className || child.tagName}`);
          }
        }
      }
    }
    return bad;
  });

  expect(escaped.join(" | ")).toEqual("");
});

test("одноимённые тайтлы разных лет не путаются", async ({ page }) => {
  const shiki = {
    id: 300,
    title: "Хантер х Хантер",
    originalTitle: "Hunter x Hunter",
    poster: "https://stub.local/hxh.png",
    score: 9.1,
    kind: "tv",
    status: "released",
    year: 2011,
    episodes: 148,
  };

  await installTauri(page, {
    overrides: {
      discover_search: [shiki],
      discover_match: shiki,
      discover_title: {
        ...shiki,
        japanese: "ハンター×ハンター",
        art: [],
        description: "Описание.",
        episodesAired: 148,
        duration: 24,
        rating: "pg_13",
        genres: [],
        studios: [],
        nextEpisodeAt: null,
        topicId: null,
      },
      discover_similar: [],
      discover_related: [],
      catalog_search: {
        query: "",
        items: [
          {
            ...SOURCE_CARD,
            handle: "hxh-1999",
            title: "Хантер х Хантер",
            key: "k-hxh-1999",
            meta: { ...SOURCE_CARD.meta, year: 1999 },
          },
          {
            ...SOURCE_CARD,
            handle: "hxh-2011",
            title: "Хантер х Хантер",
            key: "k-hxh-2011",
            meta: { ...SOURCE_CARD.meta, year: 2011 },
          },
        ],
      },
      catalog_search_multi: { query: "", groups: [], failures: [] },
      anime_by_handle: {
        "hxh-1999": {
          title: "Хантер х Хантер 1999",
          meta: { ...SOURCE_CARD.meta, year: 1999 },
        },
        "hxh-2011": {
          title: "Хантер х Хантер 2011",
          meta: { ...SOURCE_CARD.meta, year: 2011 },
        },
      },
    },
  });

  await page.goto("/");
  await page.keyboard.press("/");
  await page.locator(".palette__field input").fill("хантер");
  await expect(page.locator(".palette__hit")).toHaveCount(1, { timeout: 8000 });
  await page.keyboard.press("Enter");

  await expect(page.locator(".title-info__name")).toHaveText("Хантер х Хантер", {
    timeout: 10000,
  });
  await expect(page.locator(".fact__value", { hasText: "2011" })).toBeVisible({
    timeout: 8000,
  });
  await expect(page.locator(".fact__value", { hasText: "1999" })).toHaveCount(0);
});

test("«назад» возвращает на прежнее место скролла", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");
  await page.locator(".card").first().waitFor();

  const scroller = page.locator(".stage__scroll");
  await scroller.evaluate((node) => node.scrollTo({ top: 600 }));

  await page.keyboard.press("/");
  await page.locator(".palette__field input").fill("дороро");
  await page.locator(".palette__hit").first().waitFor();
  await page.keyboard.press("Enter");
  await page.locator(".title-info__name").waitFor({ timeout: 8000 });

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Популярное" })).toBeVisible({
    timeout: 8000,
  });
  await expect
    .poll(() => scroller.evaluate((node) => node.scrollTop), { timeout: 5000 })
    .toBeGreaterThan(400);
});

test("осечка источника переключает на следующий сама", async ({ page }) => {
  await installTauri(page, {
    failWhen: { episode_studios: "search-0:" },
    overrides: {
      catalog_search_multi: {
        query: "",
        groups: [
          { source: "animego", items: [{ ...SOURCE_CARD, source: "animego", handle: "s-go" }] },
        ],
        failures: [],
      },
    },
  });
  await page.goto("/");
  await page.locator(".card").first().click();
  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });

  await page.locator(".episode__main").first().click();

  await expect(page.locator(".toast", { hasText: "включил" })).toBeVisible({
    timeout: 12000,
  });
  await expect(page.locator(".player")).toBeVisible({ timeout: 8000 });
});

test("озвучки из всех источников сливаются в один список", async ({ page }) => {
  await installTauri(page, {
    overrides: {
      catalog_search_multi: {
        query: "",
        groups: [
          {
            source: "animego",
            items: [{ ...SOURCE_CARD, source: "animego", handle: "s-go", key: "k-go" }],
          },
        ],
        failures: [],
      },
      catalog_probe: {
        probes: [
          { source: "anilibria", handle: "search-0", quality: 720, dubs: 1, episodes: 12, error: null },
          { source: "animego", handle: "s-go", quality: 1080, dubs: 2, episodes: 12, error: null },
        ],
      },
      studios_by_prefix: {
        "search-0": [
          { handle: "st-a", title: "AniLibria", player: "kodik.info", url: "https://k/a" },
        ],
        "s-go": [
          { handle: "st-b", title: "AniDub", player: "aniboom.one", url: "https://a/b" },
          { handle: "st-c", title: "AniLibria", player: "kodik.info", url: "https://k/c" },
        ],
      },
      studio_qualities: {
        qualities: [
          { handle: "st-a", quality: 720, error: null },
          { handle: "st-b", quality: 1080, error: null },
          { handle: "st-c", quality: 720, error: null },
        ],
      },
    },
  });

  await page.goto("/");
  await page.locator(".card").first().click();
  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });

  await expect(page.locator(".dub")).toHaveCount(2, { timeout: 10000 });
  await expect(page.locator(".dub").first()).toContainText("AniDub");
  await expect(page.locator(".dub").first()).toContainText("1080p");
  await expect(page.locator(".dub", { hasText: "AniLibria" })).toHaveCount(1);

  await page.locator(".dub", { hasText: "AniDub" }).click();
  await expect(
    page.locator('.dub[data-active="true"]', { hasText: "AniDub" }),
  ).toBeVisible();
});

test("карточка не исчезает, даже когда все источники молчат", async ({ page }) => {
  await installTauri(page, {
    failWhen: { catalog_search: "" },
    overrides: {
      catalog_search_multi: { query: "", groups: [], failures: [] },
    },
  });

  await page.goto("/");
  await page.locator(".card").first().click();

  await expect(page.locator(".title-info__name")).toHaveText(TITLES[0], {
    timeout: 8000,
  });
  await expect(page.locator(".title-info__text")).toContainText("Полное описание");
  await expect(page.getByText("Источники не отдали серии этого тайтла")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole("heading", { name: "Похожее" })).toBeVisible();
  await expect(page.locator(".empty__title")).toHaveCount(0);
});

test("«Показать ещё» не гасит уже загруженные постеры", async ({ page }) => {
  await installTauri(page, { overrides: { discover_paged: true } });

  await page.goto("/");
  await page.getByRole("button", { name: "Каталог" }).click();
  await expect(page.locator(".poster-grid .card")).toHaveCount(4, { timeout: 8000 });

  const first = page.locator(".poster-grid .card img").first();
  await expect(first).toHaveAttribute("data-loaded", "true", { timeout: 8000 });

  await page.getByRole("button", { name: "Показать ещё" }).click();
  await expect(page.locator(".poster-grid .card")).toHaveCount(8, { timeout: 8000 });

  await page.waitForTimeout(400);
  await expect(first).toHaveAttribute("data-loaded", "true");
});

test("пустой тайтл не прыгает на другую часть франшизы", async ({ page }) => {
  await installTauri(page, {
    overrides: {
      anime_get: { ...ANIME_DETAIL, episodes: [] },
      catalog_search: {
        query: "",
        items: [{ ...SOURCE_CARD, meta: { ...SOURCE_CARD.meta, year: 2019 } }],
      },
      catalog_search_multi: {
        query: "",
        groups: [
          {
            source: "animego",
            items: [
              {
                ...SOURCE_CARD,
                source: "animego",
                handle: "s-final",
                key: "k-final",
                title: `${TITLES[0]}: Финал`,
                meta: { ...SOURCE_CARD.meta, year: 2019 },
              },
            ],
          },
        ],
        failures: [],
      },
      catalog_probe: {
        probes: [
          { source: "anilibria", handle: "search-0", quality: null, dubs: 0, episodes: 0, error: null },
          { source: "animego", handle: "s-final", quality: 1080, dubs: 2, episodes: 12, error: null },
        ],
      },
    },
  });

  await page.goto("/");
  await page.locator(".card").first().click();
  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });

  await page.waitForTimeout(900);
  await expect(page.locator(".title-info__name")).toHaveText(TITLES[0]);
  await expect(page.locator(".toast", { hasText: "переключил" })).toHaveCount(0);
});

test("чужой сезон с лучшим качеством не перехватывает страницу", async ({ page }) => {
  await installTauri(page, {
    overrides: {
      catalog_search: {
        query: "",
        items: [{ ...SOURCE_CARD, meta: { ...SOURCE_CARD.meta, year: 2019 } }],
      },
      catalog_search_multi: {
        query: "",
        groups: [
          {
            source: "animego",
            items: [
              {
                ...SOURCE_CARD,
                source: "animego",
                handle: "s-final",
                key: "k-final",
                title: `${TITLES[0]}: Финал`,
                meta: { ...SOURCE_CARD.meta, year: 2023 },
              },
            ],
          },
        ],
        failures: [],
      },
      catalog_probe: {
        probes: [
          { source: "anilibria", handle: "search-0", quality: 720, dubs: 1, episodes: 12, error: null },
          { source: "animego", handle: "s-final", quality: 1080, dubs: 1, episodes: 12, error: null },
        ],
      },
      studios_by_prefix: {
        "search-0": [
          { handle: "st-a", title: "AniLibria", player: "kodik.info", url: "https://k/a" },
        ],
        "s-final": [
          { handle: "st-x", title: "Чужая озвучка", player: "aniboom.one", url: "https://a/x" },
        ],
      },
      studio_qualities: {
        qualities: [
          { handle: "st-a", quality: 720, error: null },
          { handle: "st-x", quality: 1080, error: null },
        ],
      },
    },
  });

  await page.goto("/");
  await page.locator(".card").first().click();
  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });

  await expect(page.locator(".dub:not(.dub--ghost)")).toHaveCount(1, {
    timeout: 10000,
  });
  await page.waitForTimeout(600);
  await expect(page.locator(".dub", { hasText: "Чужая озвучка" })).toHaveCount(0);
  await expect(page.locator(".title-info__name")).toHaveText(TITLES[0]);
});

test("поиск переживает молчащий каталог за счёт плееров", async ({ page }) => {
  await installTauri(page, { failWhen: { discover_search: "" } });
  await page.goto("/");

  await page.getByRole("button", { name: "Настройки" }).click();
  await page.keyboard.press("Meta+k");
  await page.locator(".palette__field input").fill("дороро");
  await page.locator(".palette__foot").click();

  await expect(page.getByText("результаты напрямую из плееров")).toBeVisible({
    timeout: 8000,
  });
  await expect(page.locator(".card").first()).toBeVisible();
});

test("палитра ищет по мере ввода и открывает стрелками", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");

  await page.keyboard.press("/");
  await expect(page.locator(".palette__panel")).toBeVisible();

  await page.locator(".palette__field input").fill("дороро");
  await expect(page.locator(".palette__hit")).toHaveCount(4, { timeout: 8000 });
  await expect(page.locator('.palette__hit[data-active="true"] .palette__name')).toHaveText(
    TITLES[0],
  );

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('.palette__hit[data-active="true"] .palette__name')).toHaveText(
    TITLES[2],
  );

  await page.keyboard.press("Enter");
  await expect(page.locator(".palette__panel")).toHaveCount(0);
  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });
});

test("палитра закрывается по Esc и уводит в полный поиск", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");

  await page.keyboard.press("Meta+k");
  await expect(page.locator(".palette__panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".palette__panel")).toHaveCount(0);

  await page.keyboard.press("Meta+k");
  await page.locator(".palette__field input").fill("дороро");
  await expect(page.locator(".palette__hit").first()).toBeVisible({ timeout: 8000 });
  await page.locator(".palette__foot").click();

  await expect(page.getByRole("heading", { name: "Поиск" })).toBeVisible();
  await expect(page.locator(".card").first()).toBeVisible({ timeout: 8000 });
});

test("страница поиска ищет без нажатия Enter", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Настройки" }).click();
  await page.keyboard.press("Meta+k");
  await page.locator(".palette__field input").fill("дороро");
  await page.locator(".palette__foot").click();

  await page.locator(".search-field input").fill("клинок");
  await expect(page.locator(".page-sub")).toContainText("«клинок»", { timeout: 8000 });
  await expect(page.locator(".card").first()).toBeVisible();
});

test("оборванная загрузка перезапускается кнопкой", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");

  await page.getByRole("button", { name: /Загрузки/ }).click();
  await expect(page.locator(".download-row")).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator(".download-row__error")).toContainText("прервана при выходе");

  await page.locator('button[title="Скачать заново"]').click();
  await expect(page.locator(".toast")).toContainText("снова в очереди", { timeout: 8000 });
});

test("расписание группирует серии по дням", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Расписание" }).click();
  await expect(page.getByRole("heading", { name: "Расписание" })).toBeVisible();

  await expect(page.locator(".airing")).toHaveCount(3, { timeout: 8000 });
  await expect(page.getByRole("heading", { name: "Из вашей библиотеки" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Сегодня|Завтра/ }).first()).toBeVisible();
  await expect(page.locator('.airing[data-mine="true"]')).toHaveCount(2);
  await expect(page.locator(".airing__meta").first()).toContainText("8 серия");

  await page.locator(".airing").first().click();
  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });
});

test("все разделы рельса открываются", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");

  for (const [button, heading] of [
    ["Каталог", "Каталог"],
    ["Расписание", "Расписание"],
    ["Библиотека", "Библиотека"],
    ["История", "История"],
    ["Настройки", "Настройки"],
  ]) {
    await page.getByRole("button", { name: button }).click();
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({
      timeout: 5000,
    });
  }
});

test("кэш каталога виден в настройках и чистится", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Настройки" }).click();
  await expect(page.getByRole("heading", { name: "Новые серии" })).toBeVisible();
  await expect(page.getByText("Уведомлять о новых сериях")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Кэш каталога" })).toBeVisible();
  await expect(page.getByText("128 записей")).toBeVisible();
  await expect(page.getByText("2.3 МБ")).toBeVisible();

  await page.getByRole("button", { name: "Очистить кэш" }).click();
  await expect(page.locator(".toast")).toContainText("Кэш очищен");
});

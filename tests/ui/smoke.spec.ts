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
  expect(crashes, "приложение не должно ронять исключения").toEqual([]);
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

  await expect(page.locator(".title-poster img")).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "Сезоны и связанное" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Сейчас выходит" })).toBeVisible();
  await expect(page.locator(".card").first()).toBeVisible();

  await page.locator(".card").first().click();
  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".episode")).toHaveCount(12);
});

test("источник без плееров не роняет страницу аниме", async ({ page }) => {
  await installTauri(page, { failWhen: { episode_studios: "" } });
  await page.goto("/");
  await page.locator(".card").first().click();

  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("Источник не отдал плееров для этого тайтла")).toBeVisible({
    timeout: 8000,
  });
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

  await expect(page.locator(".toast")).toContainText("нет серий", { timeout: 10000 });
  await expect(page.locator(".toast")).toContainText("включил", { timeout: 10000 });
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
  await expect(page.locator(".picker__item")).toHaveCount(2, { timeout: 8000 });

  await page.locator(".episode__main").first().click();

  await expect(page.locator(".toast")).toContainText("включил", { timeout: 10000 });
  await expect(page.locator(".player")).toBeVisible({ timeout: 8000 });
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
  await expect(page.getByRole("heading", { name: "Сегодня" })).toBeVisible();
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

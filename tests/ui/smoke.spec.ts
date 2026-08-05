import { expect, test } from "@playwright/test";

import { TITLES, installTauri, watchForCrashes } from "./harness";

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

test("поиск находит тайтл и открывает его", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");

  await page.keyboard.press("/");
  await page.locator("input[type='search'], .search-field input, input").first().fill("дороро");
  await page.keyboard.press("Enter");

  await expect(page.locator(".card").first()).toBeVisible({ timeout: 8000 });
  await page.locator(".card").first().click();
  await expect(page.locator(".title-info__name")).toBeVisible({ timeout: 8000 });
});

test("все разделы рельса открываются", async ({ page }) => {
  await installTauri(page);
  await page.goto("/");

  for (const [button, heading] of [
    ["Каталог", "Каталог"],
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
  await expect(page.getByRole("heading", { name: "Кэш каталога" })).toBeVisible();
  await expect(page.getByText("128 записей")).toBeVisible();
  await expect(page.getByText("2.3 МБ")).toBeVisible();

  await page.getByRole("button", { name: "Очистить кэш" }).click();
  await expect(page.locator(".toast")).toContainText("Кэш очищен");
});

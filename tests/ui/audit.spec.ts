import { expect, test } from "@playwright/test";

import { installTauri, watchForCrashes } from "./harness";

interface Jank {
  longTasks: number;
  worstTask: number;
  blocking: number;
  shifts: number;
}

const LATENCY = 220;

async function measure(page: import("@playwright/test").Page): Promise<Jank> {
  return page.evaluate(() => {
    const state = (window as unknown as { __JANK__?: Jank }).__JANK__;
    return state ?? { longTasks: 0, worstTask: 0, blocking: 0, shifts: 0 };
  });
}

async function instrument(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const state = { longTasks: 0, worstTask: 0, blocking: 0, shifts: 0 };
    (window as unknown as { __JANK__: typeof state }).__JANK__ = state;

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration <= 50) continue;
          state.longTasks += 1;
          state.blocking += Math.round(entry.duration - 50);
          state.worstTask = Math.max(state.worstTask, Math.round(entry.duration));
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* браузер без longtask */
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          };
          if (shift.hadRecentInput) continue;
          state.shifts += shift.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* браузер без layout-shift */
    }
  });
}

const crashes: string[] = [];

test.beforeEach(async ({ page }) => {
  crashes.length = 0;
  watchForCrashes(page, crashes);
  await instrument(page);
});

test.afterEach(() => {
  expect(crashes, "во время обхода не должно быть исключений").toEqual([]);
});

test("обход всех разделов не копит подвисания и рывки", async ({ page }) => {
  await installTauri(page, { latencyMs: LATENCY });
  await page.goto("/");
  await page.locator(".card").first().waitFor();

  const stops: [string, string][] = [
    ["Каталог", ".page-title"],
    ["Расписание", ".page-title"],
    ["Библиотека", ".page-title"],
    ["История", ".page-title"],
    ["Загрузки", ".page-title"],
    ["Настройки", ".panel"],
    ["Главная", ".card"],
  ];

  for (const [button, ready] of stops) {
    const started = Date.now();
    await page.getByRole("button", { name: button }).click();
    await page.locator(ready).first().waitFor({ timeout: 6000 });
    const spent = Date.now() - started;
    expect(spent, `«${button}» должен открываться быстро`).toBeLessThan(3000);
  }

  await page.locator(".card").first().click();
  await page.locator(".title-info__name").waitFor({ timeout: 8000 });

  const jank = await measure(page);
  expect(jank.blocking, "поток не должен стоять").toBeLessThan(700);
  expect(jank.worstTask, "ни одна задача не должна вешать поток").toBeLessThan(600);
  expect(jank.shifts, "макет не должен прыгать").toBeLessThan(0.5);
});

test("интерфейс отвечает, пока бэкенд молчит", async ({ page }) => {
  await installTauri(page, {
    latencyMs: LATENCY,
    stalled: [
      "catalog_ongoing",
      "catalog_search_multi",
      "catalog_probe",
      "studio_qualities",
      "discover_calendar",
    ],
  });
  await page.goto("/");

  await expect(page.locator(".hero__title")).toBeVisible({ timeout: 8000 });

  for (const button of ["Расписание", "Библиотека", "История", "Главная"]) {
    const started = Date.now();
    await page.getByRole("button", { name: button }).click();
    await page.locator(".page-title, .hero__title, .card").first().waitFor({
      timeout: 6000,
    });
    expect(Date.now() - started, `«${button}» при молчащем бэкенде`).toBeLessThan(3000);
  }

  const jank = await measure(page);
  expect(jank.blocking, "поток не должен стоять").toBeLessThan(700);
  expect(jank.worstTask).toBeLessThan(600);
});

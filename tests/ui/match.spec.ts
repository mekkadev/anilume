import { expect, test } from "@playwright/test";

import { pickMatch, score, yearOf } from "../../src/lib/match";

interface Row {
  title: string;
  year: number | null;
}

const pick = (rows: Row[], aliases: string[], year: number | null) =>
  pickMatch(rows, aliases, (row) => row.title, year, (row) => row.year);

test.describe("подбор тайтла", () => {
  test("точное совпадение выигрывает", () => {
    expect(score("Атака титанов", ["Атака титанов"])).toBe(100);
  });

  test("чужой тайтл не проходит", () => {
    const aliases = ["Атака титанов", "Shingeki no Kyojin"];
    expect(score("Не издевайся, Нагаторо: Вторая атака", aliases)).toBe(0);
  });

  test("год достаётся из названия", () => {
    expect(yearOf("Хантер х Хантер (2011)")).toBe(2011);
    expect(yearOf("Хантер х Хантер")).toBeNull();
  });

  test("год в скобках не мешает совпадению", () => {
    expect(score("Хантер х Хантер (2011)", ["Хантер х Хантер"])).toBe(100);
  });

  test("год решает между одноимёнными сезонами", () => {
    const rows: Row[] = [
      { title: "Хантер х Хантер", year: 1999 },
      { title: "Хантер х Хантер", year: 2011 },
    ];

    expect(pick(rows, ["Хантер х Хантер"], 2011)?.year).toBe(2011);
    expect(pick(rows, ["Хантер х Хантер"], 1999)?.year).toBe(1999);
  });

  test("год из названия кандидата тоже считается", () => {
    const rows: Row[] = [
      { title: "Хантер х Хантер", year: null },
      { title: "Хантер х Хантер (2011)", year: null },
    ];

    expect(pick(rows, ["Хантер х Хантер"], 2011)?.title).toBe("Хантер х Хантер (2011)");
  });

  test("без года порядок не ломается", () => {
    const rows: Row[] = [
      { title: "Дороро", year: 2019 },
      { title: "Дороро", year: 1969 },
    ];

    expect(pick(rows, ["Дороро"], null)?.year).toBe(2019);
  });

  test("сдвиг в один год прощается", () => {
    const rows: Row[] = [{ title: "Клинок, рассекающий демонов", year: 2019 }];
    expect(pick(rows, ["Клинок, рассекающий демонов"], 2020)?.year).toBe(2019);
  });

  test("далёкий год отбрасывает кандидата вниз", () => {
    const near = score("Дороро", ["Дороро"], 2019, 2019);
    const far = score("Дороро", ["Дороро"], 2019, 1969);
    expect(far).toBeLessThan(near);
  });

  test("часть франшизы с точным подзаголовком выигрывает у сериала", () => {
    const rows: Row[] = [
      { title: "Клинок, рассекающий демонов", year: 2019 },
      { title: "Клинок, рассекающий демонов: Бесконечная крепость", year: 2025 },
      { title: "Клинок, рассекающий демонов: Ярмарка развлечений", year: 2021 },
    ];

    const found = pick(
      rows,
      ["Клинок, рассекающий демонов: Бесконечная крепость"],
      2025,
    );
    expect(found?.title).toBe("Клинок, рассекающий демонов: Бесконечная крепость");
  });

  test("сериал остаётся запасным, когда нужной части нет", () => {
    const rows: Row[] = [{ title: "Клинок, рассекающий демонов", year: null }];
    const found = pick(
      rows,
      ["Клинок, рассекающий демонов: Бесконечная крепость"],
      null,
    );
    expect(found?.title).toBe("Клинок, рассекающий демонов");
  });

  test("другая часть той же франшизы слабее сериала", () => {
    const wanted = ["Клинок, рассекающий демонов: Бесконечная крепость"];
    const series = score("Клинок, рассекающий демонов", wanted);
    const other = score("Клинок, рассекающий демонов: Ярмарка развлечений", wanted);
    expect(other).toBeLessThan(series);
    expect(series).toBeLessThan(100);
  });
});

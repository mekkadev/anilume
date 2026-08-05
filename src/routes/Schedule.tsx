import { For, Index, Show, createEffect, createMemo, createResource } from "solid-js";

import { Art } from "../components/Art";
import { PosterSkeleton } from "../components/PosterCard";
import { Score } from "../components/ShikiCard";
import { api } from "../lib/api";
import { coverFor, ensureArt } from "../lib/art";
import { broke, pending, settled } from "../lib/resource";
import { navigate } from "../lib/store";
import type { Upcoming } from "../lib/types";

const WEEKDAYS = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
];

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

interface Day {
  key: string;
  label: string;
  items: Upcoming[];
}

export function Schedule() {
  const [calendarRes, { refetch }] = createResource(() => api.discoverCalendar());
  const [libraryRes] = createResource(() => api.libraryList());

  const calendar = () => settled(calendarRes);
  const library = () => settled(libraryRes);

  const watched = createMemo(() => {
    const ids = new Set<number>();
    for (const entry of library() ?? []) {
      if (entry.shikimoriId) ids.add(entry.shikimoriId);
    }
    return ids;
  });

  createEffect(() => {
    const ids = (calendar() ?? []).map((item) => item.card.id);
    if (ids.length > 0) void ensureArt(ids);
  });

  const days = createMemo<Day[]>(() => {
    const buckets = new Map<string, Day>();

    for (const item of calendar() ?? []) {
      const when = new Date(item.airsAt);
      if (Number.isNaN(when.getTime())) continue;

      const key = `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
      const found = buckets.get(key);
      if (found) found.items.push(item);
      else buckets.set(key, { key, label: dayLabel(when), items: [item] });
    }

    const ordered = [...buckets.values()];
    for (const day of ordered) {
      day.items.sort((a, b) => a.airsAt.localeCompare(b.airsAt));
    }
    return ordered.sort((a, b) => a.items[0]!.airsAt.localeCompare(b.items[0]!.airsAt));
  });

  const mine = createMemo(() =>
    (calendar() ?? []).filter((item) => watched().has(item.card.id)),
  );

  const open = (item: Upcoming) =>
    navigate({
      name: "title",
      query: item.card.title,
      aliases: [item.card.originalTitle],
    });

  return (
    <div class="fade-in">
      <div class="page-head">
        <div>
          <h1 class="page-title">Расписание</h1>
          <p class="page-sub">Когда выходят следующие серии — по данным Shikimori</p>
        </div>
      </div>

      <Show when={broke(calendarRes)}>
        <div class="empty">
          <div class="empty__title">Расписание не подгрузилось</div>
          <p>Каталог Shikimori сейчас недоступен</p>
          <button class="btn btn--primary" onClick={() => void refetch()}>
            Повторить
          </button>
        </div>
      </Show>

      <Show when={pending(calendarRes)}>
        <div class="row__track">
          <Index each={Array(6).fill(0)}>{() => <PosterSkeleton />}</Index>
        </div>
      </Show>

      <Show when={mine().length > 0}>
        <section class="section">
          <div class="section__head">
            <h2 class="section__title">Из вашей библиотеки</h2>
            <span class="page-sub">{mine().length}</span>
          </div>
          <div class="schedule-grid">
            <For each={mine()}>
              {(item) => <Airing item={item} mine onOpen={() => open(item)} />}
            </For>
          </div>
        </section>
      </Show>

      <For each={days()}>
        {(day) => (
          <section class="section">
            <div class="section__head">
              <h2 class="section__title">{day.label}</h2>
              <span class="page-sub">{day.items.length}</span>
            </div>
            <div class="schedule-grid">
              <For each={day.items}>
                {(item) => (
                  <Airing
                    item={item}
                    mine={watched().has(item.card.id)}
                    onOpen={() => open(item)}
                  />
                )}
              </For>
            </div>
          </section>
        )}
      </For>

      <Show when={!pending(calendarRes) && !broke(calendarRes) && days().length === 0}>
        <div class="empty">
          <div class="empty__title">Ничего не запланировано</div>
          <p>Календарь Shikimori сейчас пуст</p>
        </div>
      </Show>
    </div>
  );
}

function Airing(props: { item: Upcoming; mine?: boolean; onOpen: () => void }) {
  const art = () => coverFor(props.item.card.id, props.item.card.poster);

  return (
    <button class="airing" data-mine={Boolean(props.mine)} onClick={props.onOpen}>
      <div class="airing__art">
        <Art src={art()} title={props.item.card.title} />
        <span class="airing__when">{clock(props.item.airsAt)}</span>
      </div>

      <div class="airing__body">
        <div class="airing__title">{props.item.card.title}</div>
        <div class="airing__meta">
          <Show when={props.item.episode > 0} fallback="следующая серия">
            {props.item.episode} серия
          </Show>
          <Show when={props.item.duration}>
            {" · "}
            {props.item.duration} мин.
          </Show>
        </div>
        <Show when={props.item.card.score}>
          <Score value={props.item.card.score!} />
        </Show>
      </div>
    </button>
  );
}

function dayLabel(when: Date) {
  const today = new Date();
  const same = (other: Date) =>
    when.getFullYear() === other.getFullYear() &&
    when.getMonth() === other.getMonth() &&
    when.getDate() === other.getDate();

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (same(today)) return "Сегодня";
  if (same(tomorrow)) return "Завтра";

  return `${WEEKDAYS[when.getDay()]}, ${when.getDate()} ${MONTHS[when.getMonth()]}`;
}

function clock(value: string) {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

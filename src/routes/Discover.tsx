import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onMount,
  type JSX,
} from "solid-js";

import { PosterSkeleton } from "../components/PosterCard";
import { ShikiCard } from "../components/ShikiCard";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { navigate, reportError } from "../lib/store";
import type { DiscoverCard, DiscoverNamed, DiscoverOptions } from "../lib/types";

const KINDS: { value: string; label: string }[] = [
  { value: "tv", label: "Сериал" },
  { value: "movie", label: "Фильм" },
  { value: "ova", label: "OVA" },
  { value: "ona", label: "ONA" },
  { value: "special", label: "Спешл" },
  { value: "tv_special", label: "TV-спешл" },
];

const STATUSES: { value: string; label: string }[] = [
  { value: "ongoing", label: "Выходит" },
  { value: "released", label: "Завершено" },
  { value: "anons", label: "Анонс" },
];

const ORDERS: { value: string; label: string }[] = [
  { value: "popularity", label: "По популярности" },
  { value: "ranked", label: "По рейтингу" },
  { value: "aired_on", label: "По дате выхода" },
  { value: "name", label: "По названию" },
  { value: "random", label: "Случайно" },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR + 1 - 1965 + 1 }, (_, i) => CURRENT_YEAR + 1 - i);

function Popover(props: {
  label: string;
  value: string | null;
  wide?: boolean;
  plain?: boolean;
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);

  return (
    <div class="menu">
      <button
        class="filter"
        data-active={props.value !== null && !props.plain}
        onClick={() => setOpen(!open())}
      >
        <span class="filter__label">{props.label}</span>
        <Show when={props.value}>
          <span class="filter__value">{props.value}</span>
        </Show>
        <Icon name="chevron" size={11} />
      </button>

      <Show when={open()}>
        <div class="menu__backdrop" onClick={() => setOpen(false)} />
        <div class="menu__list" classList={{ "menu__list--wide": props.wide }}>
          {props.children(() => setOpen(false))}
        </div>
      </Show>
    </div>
  );
}

function CheckList(props: {
  items: DiscoverNamed[];
  chosen: number[];
  searchable?: boolean;
  onToggle: (id: number) => void;
}) {
  const [needle, setNeedle] = createSignal("");

  const visible = createMemo(() => {
    const query = needle().trim().toLowerCase();
    if (!query) return props.items.slice(0, 200);
    return props.items
      .filter((item) => item.name.toLowerCase().includes(query))
      .slice(0, 200);
  });

  return (
    <>
      <Show when={props.searchable}>
        <input
          class="menu__search"
          type="search"
          placeholder="Найти"
          value={needle()}
          onInput={(event) => setNeedle(event.currentTarget.value)}
          spellcheck={false}
          autocomplete="off"
        />
      </Show>

      <div class="menu__scroll">
        <For each={visible()} fallback={<div class="menu__empty">Ничего не найдено</div>}>
          {(item) => (
            <button
              class="menu__item"
              data-active={props.chosen.includes(item.id)}
              onClick={() => props.onToggle(item.id)}
            >
              {item.name}
              <Show when={props.chosen.includes(item.id)}>
                <Icon name="check" size={14} />
              </Show>
            </button>
          )}
        </For>
      </div>
    </>
  );
}

export function Discover() {
  const [options, setOptions] = createSignal<DiscoverOptions>({ genres: [], studios: [] });
  const [genres, setGenres] = createSignal<number[]>([]);
  const [studios, setStudios] = createSignal<number[]>([]);
  const [kinds, setKinds] = createSignal<string[]>([]);
  const [status, setStatus] = createSignal<string | null>(null);
  const [yearFrom, setYearFrom] = createSignal<number | null>(null);
  const [yearTo, setYearTo] = createSignal<number | null>(null);
  const [order, setOrder] = createSignal("popularity");

  const [items, setItems] = createSignal<DiscoverCard[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [appending, setAppending] = createSignal(false);
  const [exhausted, setExhausted] = createSignal(false);

  let page = 1;

  const filters = () => ({
    genres: genres(),
    studios: studios(),
    kinds: kinds(),
    status: status(),
    yearFrom: yearFrom(),
    yearTo: yearTo(),
    order: order(),
  });

  const named = (list: DiscoverNamed[], ids: number[]) =>
    list.filter((item) => ids.includes(item.id));

  const toggle = <T,>(
    get: () => T[],
    set: (value: T[]) => void,
    value: T,
  ) => {
    const current = get();
    set(current.includes(value) ? current.filter((x) => x !== value) : [...current, value]);
  };

  async function run(next: number, append: boolean) {
    if (append) setAppending(true);
    else setLoading(true);

    try {
      const found = await api.discoverSearch({ ...filters(), page: next });
      page = next;
      setExhausted(found.length === 0);
      setItems(append ? [...items(), ...found] : found);
    } catch (error) {
      if (!append) setItems([]);
      reportError(error);
    } finally {
      setLoading(false);
      setAppending(false);
    }
  }

  onMount(() => {
    void api
      .discoverOptions()
      .then(setOptions)
      .catch(() => undefined);
    void run(1, false);
  });

  createEffect(
    on(
      () => JSON.stringify(filters()),
      () => void run(1, false),
      { defer: true },
    ),
  );

  const reset = () => {
    setGenres([]);
    setStudios([]);
    setKinds([]);
    setStatus(null);
    setYearFrom(null);
    setYearTo(null);
    setOrder("popularity");
  };

  const touched = () =>
    genres().length > 0 ||
    studios().length > 0 ||
    kinds().length > 0 ||
    status() !== null ||
    yearFrom() !== null ||
    yearTo() !== null;

  const yearLabel = () => {
    const from = yearFrom();
    const to = yearTo();
    if (from === null && to === null) return null;
    if (from !== null && to !== null) return from === to ? String(from) : `${from}–${to}`;
    return from !== null ? `от ${from}` : `до ${to}`;
  };

  const open = (card: DiscoverCard) =>
    navigate({ name: "title", query: card.title });

  return (
    <div class="fade-in">
      <div class="page-head">
        <div>
          <h1 class="page-title">Каталог</h1>
          <p class="page-sub">
            Подбор по базе Shikimori — источник выбирается на самом аниме
          </p>
        </div>
      </div>

      <div class="filters">
        <Popover
          label="Жанр"
          value={genres().length > 0 ? String(genres().length) : null}
          wide
        >
          {() => (
            <CheckList
              items={options().genres}
              chosen={genres()}
              onToggle={(id) => toggle(genres, setGenres, id)}
            />
          )}
        </Popover>

        <Popover
          label="Студия"
          value={
            studios().length === 1
              ? (named(options().studios, studios())[0]?.name ?? "1")
              : studios().length > 0
                ? String(studios().length)
                : null
          }
          wide
        >
          {() => (
            <CheckList
              items={options().studios}
              chosen={studios()}
              searchable
              onToggle={(id) => toggle(studios, setStudios, id)}
            />
          )}
        </Popover>

        <Popover label="Год" value={yearLabel()}>
          {() => (
            <>
              <div class="menu__label">С</div>
              <div class="menu__scroll menu__scroll--short">
                <button
                  class="menu__item"
                  data-active={yearFrom() === null}
                  onClick={() => setYearFrom(null)}
                >
                  Любой
                </button>
                <For each={YEARS}>
                  {(year) => (
                    <button
                      class="menu__item"
                      data-active={yearFrom() === year}
                      onClick={() => setYearFrom(year)}
                    >
                      {year}
                    </button>
                  )}
                </For>
              </div>

              <div class="menu__label">По</div>
              <div class="menu__scroll menu__scroll--short">
                <button
                  class="menu__item"
                  data-active={yearTo() === null}
                  onClick={() => setYearTo(null)}
                >
                  Любой
                </button>
                <For each={YEARS}>
                  {(year) => (
                    <button
                      class="menu__item"
                      data-active={yearTo() === year}
                      onClick={() => setYearTo(year)}
                    >
                      {year}
                    </button>
                  )}
                </For>
              </div>
            </>
          )}
        </Popover>

        <Popover
          label="Статус"
          value={status() ? (STATUSES.find((s) => s.value === status())?.label ?? null) : null}
        >
          {(close) => (
            <>
              <button
                class="menu__item"
                data-active={status() === null}
                onClick={() => {
                  setStatus(null);
                  close();
                }}
              >
                Любой
              </button>
              <For each={STATUSES}>
                {(item) => (
                  <button
                    class="menu__item"
                    data-active={status() === item.value}
                    onClick={() => {
                      setStatus(item.value);
                      close();
                    }}
                  >
                    {item.label}
                    <Show when={status() === item.value}>
                      <Icon name="check" size={14} />
                    </Show>
                  </button>
                )}
              </For>
            </>
          )}
        </Popover>

        <Popover label="Тип" value={kinds().length > 0 ? String(kinds().length) : null}>
          {() => (
            <For each={KINDS}>
              {(item) => (
                <button
                  class="menu__item"
                  data-active={kinds().includes(item.value)}
                  onClick={() => toggle(kinds, setKinds, item.value)}
                >
                  {item.label}
                  <Show when={kinds().includes(item.value)}>
                    <Icon name="check" size={14} />
                  </Show>
                </button>
              )}
            </For>
          )}
        </Popover>

        <div class="filters__spacer" />

        <Popover
          label="Сортировка"
          plain
          value={ORDERS.find((item) => item.value === order())?.label ?? null}
        >
          {(close) => (
            <For each={ORDERS}>
              {(item) => (
                <button
                  class="menu__item"
                  data-active={order() === item.value}
                  onClick={() => {
                    setOrder(item.value);
                    close();
                  }}
                >
                  {item.label}
                  <Show when={order() === item.value}>
                    <Icon name="check" size={14} />
                  </Show>
                </button>
              )}
            </For>
          )}
        </Popover>

        <Show when={touched()}>
          <button class="btn btn--plain" onClick={reset}>
            Сбросить
          </button>
        </Show>
      </div>

      <Show when={genres().length > 0 || studios().length > 0}>
        <div class="filters__chips">
          <For each={named(options().genres, genres())}>
            {(item) => (
              <button class="chip chip--accent" onClick={() => toggle(genres, setGenres, item.id)}>
                {item.name}
                <Icon name="close" size={11} />
              </button>
            )}
          </For>
          <For each={named(options().studios, studios())}>
            {(item) => (
              <button class="chip chip--accent" onClick={() => toggle(studios, setStudios, item.id)}>
                {item.name}
                <Icon name="close" size={11} />
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show
        when={!loading()}
        fallback={
          <div class="poster-grid">
            <Index each={Array(12).fill(0)}>{() => <PosterSkeleton />}</Index>
          </div>
        }
      >
        <Show
          when={items().length > 0}
          fallback={
            <div class="empty">
              <div class="empty__title">Под эти фильтры ничего нет</div>
              <p>Снимите часть условий или расширьте диапазон лет</p>
              <Show when={touched()}>
                <button class="btn btn--primary" onClick={reset}>
                  Сбросить фильтры
                </button>
              </Show>
            </div>
          }
        >
          <div class="poster-grid">
            <For each={items()}>
              {(card) => (
                <ShikiCard card={card} onOpen={open} />
              )}
            </For>
          </div>

          <Show when={!exhausted()}>
            <div class="more">
              <button
                class="btn"
                disabled={appending()}
                onClick={() => void run(page + 1, true)}
              >
                <Show when={appending()} fallback="Показать ещё">
                  <span class="spinner" />
                  Загружаем
                </Show>
              </button>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

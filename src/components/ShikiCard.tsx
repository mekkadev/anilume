import { For, Show, createSignal } from "solid-js";

import { coverFor } from "../lib/art";
import type { DiscoverCard } from "../lib/types";
import { Icon } from "./Icon";

export const KIND_LABELS: Record<string, string> = {
  tv: "Сериал",
  movie: "Фильм",
  ova: "OVA",
  ona: "ONA",
  special: "Спешл",
  tv_special: "TV-спешл",
  music: "Клип",
  pv: "PV",
};

export const STATUS_LABELS: Record<string, string> = {
  ongoing: "выходит",
  released: "завершено",
  anons: "анонс",
};

export function Score(props: { value: number }) {
  const parts = () => props.value.toFixed(1).split(".");

  return (
    <span class="score">
      <span class="score__int">{parts()[0]}</span>
      <span class="score__dec">.{parts()[1]}</span>
    </span>
  );
}

export function ShikiCard(props: {
  card: DiscoverCard;
  busy?: boolean;
  onOpen: (card: DiscoverCard) => void;
}) {
  const [loaded, setLoaded] = createSignal(false);
  const poster = () => coverFor(props.card.id, props.card.poster);

  const summary = () => {
    const parts: string[] = [];
    if (props.card.year) parts.push(String(props.card.year));
    if (props.card.kind) parts.push(KIND_LABELS[props.card.kind] ?? props.card.kind);
    if (props.card.episodes && props.card.episodes > 1) {
      parts.push(`${props.card.episodes} эп.`);
    }
    return parts;
  };

  return (
    <button class="card" onClick={() => props.onOpen(props.card)}>
      <div class="card__art">
        <Show when={poster()} fallback={<div class="skeleton" style={{ height: "100%" }} />}>
          <img
            src={poster()!}
            alt={props.card.title}
            loading="lazy"
            decoding="async"
            data-loaded={loaded()}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
        </Show>

        <div class="card__scrim" />
        <div class="card__play">
          <Show when={!props.busy} fallback={<span class="spinner" />}>
            <Icon name="play" size={20} />
          </Show>
        </div>

        <Show when={props.card.status && props.card.status !== "released"}>
          <span class="badge badge--status">
            {STATUS_LABELS[props.card.status!] ?? props.card.status}
          </span>
        </Show>

        <Show when={props.card.score}>
          <span class="card__score">
            <Score value={props.card.score!} />
          </span>
        </Show>
      </div>

      <div>
        <div class="card__title">{props.card.title}</div>
        <Show when={summary().length > 0}>
          <div class="card__meta">
            <For each={summary()}>{(part) => <span>{part}</span>}</For>
          </div>
        </Show>
      </div>
    </button>
  );
}

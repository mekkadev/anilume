import { Show, createSignal } from "solid-js";

import type { AnimeCard } from "../lib/types";
import { Icon } from "./Icon";
import { Score } from "./ShikiCard";

interface PosterCardProps {
  card: AnimeCard;
  progress?: number;
  onOpen: (card: AnimeCard) => void;
}

export function PosterCard(props: PosterCardProps) {
  const [loaded, setLoaded] = createSignal(false);

  const subtitle = () => {
    const meta = props.card.meta;
    const parts: string[] = [];
    if (meta.year) parts.push(String(meta.year));
    if (meta.kind) parts.push(meta.kind);
    else if (meta.episodesTotal) parts.push(`${meta.episodesTotal} эп.`);
    return parts;
  };

  return (
    <button class="card" onClick={() => props.onOpen(props.card)}>
      <div class="card__art">
        <Show when={props.card.poster} fallback={<div class="skeleton" style={{ height: "100%" }} />}>
          <img
            src={props.card.poster!}
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
          <Icon name="play" size={20} />
        </div>

        <Show when={props.card.episodeBadge}>
          <span class="badge badge--episode">{props.card.episodeBadge}</span>
        </Show>

        <Show when={props.card.meta.score}>
          <span class="card__score">
            <Score value={props.card.meta.score!} />
          </span>
        </Show>

        <Show when={props.progress !== undefined && props.progress > 0.01}>
          <div class="card__progress">
            <span style={{ width: `${Math.min(props.progress! * 100, 100)}%` }} />
          </div>
        </Show>
      </div>

      <div>
        <div class="card__title">{props.card.title}</div>
        <Show when={subtitle().length > 0}>
          <div class="card__meta">
            {subtitle().map((part) => (
              <span>{part}</span>
            ))}
          </div>
        </Show>
      </div>
    </button>
  );
}

export function PosterSkeleton() {
  return (
    <div class="card">
      <div class="skeleton" style={{ "aspect-ratio": "2 / 3" }} />
      <div class="skeleton" style={{ height: "13px", width: "85%", "border-radius": "5px" }} />
      <div class="skeleton" style={{ height: "11px", width: "45%", "border-radius": "5px" }} />
    </div>
  );
}

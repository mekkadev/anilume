import { For, onCleanup, onMount } from "solid-js";

import type { EpisodeInfo, StudioInfo } from "../lib/types";
import { Icon } from "./Icon";

interface StudioSheetProps {
  episode: EpisodeInfo;
  studios: StudioInfo[];
  onPick: (studio: StudioInfo) => void;
  onClose: () => void;
}

export function StudioSheet(props: StudioSheetProps) {
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="sheet" onClick={props.onClose}>
      <div class="sheet__panel" onClick={(event) => event.stopPropagation()}>
        <div class="sheet__head">
          <div>
            <div class="sheet__title">Озвучка</div>
            <div class="sheet__sub">{props.episode.title}</div>
          </div>
          <button class="tool-btn" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div class="sheet__list">
          <For each={props.studios}>
            {(studio) => (
              <button class="studio" onClick={() => props.onPick(studio)}>
                <span class="studio__name">{studio.title}</span>
                <span class="studio__player">{studio.player}</span>
                <Icon name="play" size={15} />
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

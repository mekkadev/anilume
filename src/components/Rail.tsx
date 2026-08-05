import { For, Show, createSignal, onMount } from "solid-js";

import { api } from "../lib/api";
import { navigate, openPalette, route } from "../lib/store";
import { Icon, type IconName } from "./Icon";

type SimpleRoute =
  | "home"
  | "discover"
  | "schedule"
  | "library"
  | "history"
  | "downloads"
  | "settings";

const NAV: { name: SimpleRoute; label: string; icon: IconName }[] = [
  { name: "home", label: "Главная", icon: "home" },
  { name: "discover", label: "Каталог", icon: "sliders" },
  { name: "schedule", label: "Расписание", icon: "calendar" },
  { name: "library", label: "Библиотека", icon: "library" },
  { name: "history", label: "История", icon: "clock" },
  { name: "downloads", label: "Загрузки", icon: "download" },
];

export function Rail() {
  const [active, setActive] = createSignal(0);

  const refresh = async () => {
    try {
      const items = await api.downloadsList();
      setActive(
        items.filter((item) => item.status === "running" || item.status === "queued")
          .length,
      );
    } catch {
      setActive(0);
    }
  };

  onMount(() => {
    void refresh();
    void api.onDownloadProgress(() => void refresh());
  });

  return (
    <aside class="rail">
      <div class="rail__dock">
        <div class="rail__mark">
          <img src="/mark.png" alt="anilume" width="32" height="32" />
        </div>

        <For each={NAV}>
          {(item) => (
            <button
              class="rail-btn"
              data-active={route().name === item.name}
              onClick={() => navigate({ name: item.name })}
            >
              <Icon name={item.icon} size={20} />
              <Show when={item.name === "downloads" && active() > 0}>
                <span class="rail-btn__dot">{active()}</span>
              </Show>
              <span class="rail-btn__tip">{item.label}</span>
            </button>
          )}
        </For>

        <div class="rail__spacer" />

        <button
          class="rail-btn"
          data-active={route().name === "search"}
          onClick={openPalette}
        >
          <Icon name="search" size={20} />
          <span class="rail-btn__tip">Поиск · ⌘K</span>
        </button>

        <button
          class="rail-btn"
          data-active={route().name === "settings"}
          onClick={() => navigate({ name: "settings" })}
        >
          <Icon name="settings" size={20} />
          <span class="rail-btn__tip">Настройки</span>
        </button>

      </div>
    </aside>
  );
}

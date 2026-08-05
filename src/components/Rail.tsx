import { For, Show, createSignal, onMount } from "solid-js";

import { api } from "../lib/api";
import {
  activeSource,
  navigate,
  route,
  setActiveSource,
  sourceName,
  sources,
} from "../lib/store";
import { Icon, type IconName } from "./Icon";

type SimpleRoute =
  | "home"
  | "discover"
  | "library"
  | "history"
  | "downloads"
  | "settings";

const NAV: { name: SimpleRoute; label: string; icon: IconName }[] = [
  { name: "home", label: "Главная", icon: "home" },
  { name: "discover", label: "Каталог", icon: "sliders" },
  { name: "library", label: "Библиотека", icon: "library" },
  { name: "history", label: "История", icon: "clock" },
  { name: "downloads", label: "Загрузки", icon: "download" },
];

export function Rail() {
  const [active, setActive] = createSignal(0);
  const [picker, setPicker] = createSignal(false);

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

  const initial = () => sourceName(activeSource()).slice(0, 2);

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
          onClick={() => navigate({ name: "search", query: "" })}
        >
          <Icon name="search" size={20} />
          <span class="rail-btn__tip">Поиск</span>
        </button>

        <button
          class="rail-btn"
          data-active={route().name === "settings"}
          onClick={() => navigate({ name: "settings" })}
        >
          <Icon name="settings" size={20} />
          <span class="rail-btn__tip">Настройки</span>
        </button>

        <div class="menu">
          <button class="rail-source" onClick={() => setPicker(!picker())}>
            {initial()}
          </button>

          <Show when={picker()}>
            <div class="menu__backdrop" onClick={() => setPicker(false)} />
            <div class="menu__list">
              <div class="menu__label">Источник</div>
              <For each={sources()}>
                {(source) => (
                  <button
                    class="menu__item"
                    data-active={activeSource() === source.key}
                    onClick={() => {
                      setActiveSource(source.key);
                      setPicker(false);
                    }}
                  >
                    {source.name}
                    <Show
                      when={activeSource() === source.key}
                      fallback={
                        <Show when={source.geoRestricted}>
                          <span class="source-item__geo">СНГ</span>
                        </Show>
                      }
                    >
                      <Icon name="check" size={14} />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </aside>
  );
}

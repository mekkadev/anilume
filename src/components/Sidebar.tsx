import { For, Show, createSignal, onMount } from "solid-js";

import { api } from "../lib/api";
import {
  activeSource,
  navigate,
  route,
  setActiveSource,
  sources,
} from "../lib/store";
import { Icon, type IconName } from "./Icon";

type SimpleRoute = "home" | "library" | "history" | "downloads" | "settings";

const NAV: { name: SimpleRoute; label: string; icon: IconName }[] = [
  { name: "home", label: "Главная", icon: "home" },
  { name: "library", label: "Библиотека", icon: "library" },
  { name: "history", label: "История", icon: "clock" },
  { name: "downloads", label: "Загрузки", icon: "download" },
  { name: "settings", label: "Настройки", icon: "settings" },
];

export function Sidebar() {
  const [activeDownloads, setActiveDownloads] = createSignal(0);

  const refreshDownloads = async () => {
    try {
      const items = await api.downloadsList();
      setActiveDownloads(
        items.filter((item) => item.status === "running" || item.status === "queued")
          .length,
      );
    } catch {
      setActiveDownloads(0);
    }
  };

  onMount(() => {
    void refreshDownloads();
    void api.onDownloadProgress(() => void refreshDownloads());
  });

  return (
    <aside class="sidebar">
      <div class="sidebar__top">
        <div class="sidebar__brand">
          <div class="sidebar__mark" />
          anilume
        </div>
      </div>

      <div class="sidebar__body">
        <For each={NAV}>
          {(item) => (
            <button
              class="nav-item"
              data-active={route().name === item.name}
              onClick={() => navigate({ name: item.name })}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
              <Show when={item.name === "downloads" && activeDownloads() > 0}>
                <span class="nav-badge">{activeDownloads()}</span>
              </Show>
            </button>
          )}
        </For>

        <div class="sidebar__section">Источники</div>

        <For each={sources()}>
          {(source) => (
            <button
              class="source-item"
              data-active={activeSource() === source.key}
              title={source.description}
              onClick={() => setActiveSource(source.key)}
            >
              <span class="source-item__dot" />
              {source.name}
              <Show when={source.geoRestricted}>
                <span class="source-item__geo" title="Требуется IP СНГ">
                  СНГ
                </span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </aside>
  );
}

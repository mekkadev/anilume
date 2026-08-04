import { Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js";

import { Icon } from "./components/Icon";
import { Player } from "./components/Player";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { Downloads } from "./routes/Downloads";
import { Home } from "./routes/Home";
import { History } from "./routes/History";
import { Library } from "./routes/Library";
import { Search } from "./routes/Search";
import { Settings } from "./routes/Settings";
import { Title } from "./routes/Title";
import { loadPrefs, restoreSourceConfig } from "./lib/prefs";
import {
  canGoBack,
  goBack,
  loadSources,
  matchRoute,
  navigate,
  playback,
  reportError,
  route,
} from "./lib/store";

export function App() {
  const [query, setQuery] = createSignal("");
  const [scrolled, setScrolled] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;

  onMount(() => {
    loadSources().catch(reportError);
    void loadPrefs().catch(() => undefined);
    void restoreSourceConfig().catch(() => undefined);

    void import("@tauri-apps/plugin-os")
      .then(({ platform }) => {
        document.documentElement.dataset.platform = platform();
      })
      .catch(() => {
        document.documentElement.dataset.platform = "unknown";
      });

    const onKeyDown = (event: KeyboardEvent) => {
      if (playback()) return;

      const typing =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;

      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchInput?.focus();
        searchInput?.select();
        return;
      }

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchInput?.focus();
        return;
      }

      if (event.key === "Escape" && typing) {
        searchInput?.blur();
        return;
      }

      if (event.key === "Escape" && canGoBack()) {
        goBack();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const submitSearch = (event: Event) => {
    event.preventDefault();
    const value = query().trim();
    if (value.length > 0) navigate({ name: "search", query: value });
  };

  return (
    <>
      <div class="shell">
        <Sidebar />

        <div class="main">
          <header class="toolbar" data-scrolled={scrolled()}>
            <button
              class="tool-btn"
              onClick={goBack}
              disabled={!canGoBack()}
              title="Назад"
            >
              <Icon name="back" size={17} />
            </button>

            <div class="toolbar__spacer" />

            <form class="search-field" onSubmit={submitSearch}>
              <Icon name="search" size={14} />
              <input
                ref={searchInput}
                type="search"
                placeholder="Поиск"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                spellcheck={false}
                autocomplete="off"
              />
              <span class="kbd">⌘K</span>
            </form>
          </header>

          <main
            class="content"
            onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 4)}
          >
            <Switch>
              <Match when={matchRoute(route(), "home")}>
                <Home />
              </Match>
              <Match when={matchRoute(route(), "search")}>
                {(current) => <Search query={current().query} />}
              </Match>
              <Match when={matchRoute(route(), "title")}>
                {(current) => <Title card={current().card} />}
              </Match>
              <Match when={matchRoute(route(), "library")}>
                <Library />
              </Match>
              <Match when={matchRoute(route(), "history")}>
                <History />
              </Match>
              <Match when={matchRoute(route(), "downloads")}>
                <Downloads />
              </Match>
              <Match when={matchRoute(route(), "settings")}>
                <Settings />
              </Match>
            </Switch>
          </main>
        </div>
      </div>

      <Show when={playback()}>
        <Player request={playback()!} />
      </Show>

      <Toasts />
    </>
  );
}

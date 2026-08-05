import {
  ErrorBoundary,
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Icon } from "./components/Icon";
import { Palette } from "./components/Palette";
import { Player } from "./components/Player";
import { Rail } from "./components/Rail";
import { Toasts } from "./components/Toasts";
import { Discover } from "./routes/Discover";
import { Downloads } from "./routes/Downloads";
import { Home } from "./routes/Home";
import { History } from "./routes/History";
import { Library } from "./routes/Library";
import { Search } from "./routes/Search";
import { Settings } from "./routes/Settings";
import { Title } from "./routes/Title";
import { loadPrefs, restoreSourceConfig } from "./lib/prefs";
import { checkForUpdate } from "./lib/api";
import {
  ambient,
  canGoBack,
  goBack,
  loadSources,
  closePalette,
  matchRoute,
  navigate,
  openPalette,
  paletteOpen,
  playback,
  pushToast,
  reportError,
  route,
} from "./lib/store";

export function App() {
  const [ambientReady, setAmbientReady] = createSignal(false);

  onMount(() => {
    loadSources().catch(reportError);
    void loadPrefs().catch(() => undefined);
    void restoreSourceConfig().catch(() => undefined);

    void checkForUpdate().then((update) => {
      if (!update) return;
      pushToast(
        `Доступна версия ${update.version} — нажмите, чтобы обновить`,
        "info",
        "Приложение перезапустится после установки",
        () => void update.install(),
      );
    });

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
        if (paletteOpen()) closePalette();
        else openPalette();
        return;
      }

      if (paletteOpen()) return;

      if (event.key === "/" && !typing) {
        event.preventDefault();
        openPalette();
        return;
      }

      if (event.key === "Escape" && typing) {
        (event.target as HTMLElement).blur();
        return;
      }

      if (event.key === "Escape" && canGoBack()) {
        goBack();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  let scroller!: HTMLDivElement;

  createEffect(() => {
    route();
    scroller?.scrollTo({ top: 0 });
  });

  createEffect(() => {
    const url = ambient();
    setAmbientReady(false);
    if (!url) return;

    const probe = new Image();
    probe.onload = () => {
      if (ambient() === url) setAmbientReady(true);
    };
    probe.src = url;
  });

  const ambientStyle = () => {
    const url = ambient();
    return url ? { "background-image": `url("${url}")` } : {};
  };

  return (
    <div class="app">
      <div class="ambient">
        <div
          class="ambient__art"
          data-shown={Boolean(ambient()) && ambientReady()}
          style={ambientStyle()}
        />
        <div class="ambient__veil" />
      </div>

      <div class="shell">
        <Rail />

        <div class="stage">
          <div class="stage__drag" />

          <div class="stage__scroll" ref={scroller}>
            <Show when={canGoBack()}>
              <button class="stage__back" onClick={goBack} title="Назад">
                <Icon name="back" size={17} />
              </button>
            </Show>

            <ErrorBoundary fallback={(error, reset) => <Crash error={error} reset={reset} />}>
              <Switch>
                <Match when={matchRoute(route(), "home")}>
                  <Home />
                </Match>
                <Match when={matchRoute(route(), "search")}>
                  {(current) => <Search query={current().query} />}
                </Match>
                <Match when={matchRoute(route(), "discover")}>
                  <Discover />
                </Match>
                <Match when={matchRoute(route(), "title")}>
                  {(current) => (
                    <Show when={current()} keyed>
                      {(target) => (
                        <Title
                          query={target.query}
                          card={target.card}
                          source={target.source}
                        />
                      )}
                    </Show>
                  )}
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
            </ErrorBoundary>
          </div>
        </div>
      </div>

      <Show when={paletteOpen()}>
        <Palette />
      </Show>

      <Show when={playback()}>
        <Player request={playback()!} />
      </Show>

      <Toasts />
    </div>
  );
}

function Crash(props: { error: unknown; reset: () => void }) {
  const message = () => {
    const error = props.error;
    if (error instanceof Error) return error.message;
    return String(error);
  };

  return (
    <div class="empty">
      <div class="empty__title">Страница не открылась</div>
      <p>{message()}</p>
      <div class="empty__actions">
        <button
          class="btn btn--primary"
          onClick={() => {
            navigate({ name: "home" });
            props.reset();
          }}
        >
          На главную
        </button>
        <button class="btn" onClick={props.reset}>
          Повторить
        </button>
      </div>
    </div>
  );
}

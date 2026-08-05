import { For, Show, createResource, createSignal } from "solid-js";

import { Icon } from "../components/Icon";
import { Toggle } from "../components/Toggle";
import { api } from "../lib/api";
import { settled } from "../lib/resource";
import { extractToken, formatBytes, plural } from "../lib/format";
import { pushToast, reportError } from "../lib/store";

const OOB = "urn:ietf:wg:oauth:2.0:oob";
const SERVER_LABELS: Record<string, string> = {
  main: "Основной",
  secondary_1: "Резервный 1",
  secondary_2: "Резервный 2",
};
const LOOPBACK = "http://127.0.0.1:53682/";

export function Settings() {
  const [statusRes, { refetch }] = createResource(() => api.shikimoriStatus());
  const [animelibRes, { refetch: refetchAnimelib }] = createResource(() =>
    api.animelibServers(),
  );
  const [cacheRes, { refetch: refetchCache }] = createResource(() => api.cacheStats());
  const [notifyRes, { refetch: refetchNotify }] = createResource(() => api.notifyStatus());
  const notify = () => settled(notifyRes) ?? true;

  const setNotify = async (on: boolean) => {
    try {
      await api.notifySet(on);
      await refetchNotify();
    } catch (error) {
      reportError(error);
    }
  };
  const status = () => settled(statusRes);
  const animelib = () => settled(animelibRes);
  const cache = () => settled(cacheRes);
  const [libToken, setLibToken] = createSignal("");
  const [savingLib, setSavingLib] = createSignal(false);

  const dropCache = async () => {
    try {
      const removed = await api.cacheClear();
      await refetchCache();
      pushToast(
        removed > 0 ? "Кэш очищен, данные загрузятся заново" : "Кэш и так пуст",
        "success",
      );
    } catch (error) {
      reportError(error);
    }
  };

  const saveAnimelibToken = async () => {
    const token = extractToken(libToken());
    if (token.length === 0) {
      pushToast("Пустой токен", "error");
      return;
    }

    setSavingLib(true);
    try {
      await api.sourceConfigSet("animelib", { token });
      await api.settingSet("animelib.token", token);
      setLibToken("");
      await refetchAnimelib();
      pushToast("Токен сохранён — свой плеер AnimeLib доступен", "success");
    } catch (error) {
      reportError(error);
    } finally {
      setSavingLib(false);
    }
  };

  const chooseServer = async (id: string) => {
    try {
      await api.sourceConfigSet("animelib", { server: id });
      await api.settingSet("animelib.server", id);
      await refetchAnimelib();
    } catch (error) {
      reportError(error);
    }
  };

  const [clientId, setClientId] = createSignal("");
  const [clientSecret, setClientSecret] = createSignal("");
  const [redirect, setRedirect] = createSignal(LOOPBACK);
  const [code, setCode] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const saveConfig = async () => {
    if (!clientId().trim() || !clientSecret().trim()) {
      pushToast("Заполните Client ID и Client Secret", "error");
      return;
    }

    setBusy(true);
    try {
      await api.shikimoriConfigure({
        clientId: clientId().trim(),
        clientSecret: clientSecret().trim(),
        redirectUri: redirect(),
        userAgent: "anilume",
      });
      await refetch();
      pushToast("Приложение Shikimori сохранено", "success");
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const loginLoopback = async () => {
    setBusy(true);
    try {
      const account = await api.shikimoriLoginLoopback();
      await refetch();
      pushToast(`Вход выполнен: ${account.nickname}`, "success");
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const loginWithCode = async () => {
    setBusy(true);
    try {
      const account = await api.shikimoriLoginWithCode(code().trim());
      setCode("");
      await refetch();
      pushToast(`Вход выполнен: ${account.nickname}`, "success");
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const openAuthPage = async () => {
    try {
      const url = await api.shikimoriAuthorizeUrl();
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch (error) {
      reportError(error);
    }
  };

  const logout = async () => {
    try {
      await api.shikimoriLogout();
      await refetch();
      pushToast("Вы вышли из Shikimori");
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div class="fade-in settings">
      <div class="page-head">
        <div>
          <h1 class="page-title">Настройки</h1>
          <p class="page-sub">Синхронизация, качество и данные</p>
        </div>
      </div>

      <section class="panel">
        <h2 class="panel__title">AnimeLib</h2>
        <p class="panel__hint">
          Без токена AnimeLib отдаёт только ссылки на Kodik. С токеном открывается его
          собственный плеер — прямые mp4 вплоть до 2160p. Аккаунт бесплатный.
          Токен лежит в браузере на v5.animelib.org: войти, открыть любую серию,
          инструменты разработчика, вкладка «Сеть», найти запрос к hapi.hentaicdn.org
          вида /api/episodes/… — обязательно строку с методом GET, а не OPTIONS,
          в предзапросе заголовков нет. В заголовках запроса взять Authorization
          и скопировать всё после слова Bearer. Можно не выковыривать: правый клик
          по запросу → «Копировать как cURL» и вставить сюда целиком, токен
          вытащится сам. Хранится только на этом компьютере и уходит только
          в AnimeLib.
        </p>

        <div class="field-inline">
          <label class="field">
            <span>Токен доступа</span>
            <input
              type="password"
              value={libToken()}
              onInput={(event) => setLibToken(event.currentTarget.value)}
              placeholder={animelib()?.hasToken ? "Токен сохранён — введите новый, чтобы заменить" : "eyJ0eXAiOiJKV1Qi…"}
              spellcheck={false}
              autocomplete="off"
            />
          </label>
          <button
            class="btn btn--primary"
            onClick={() => void saveAnimelibToken()}
            disabled={savingLib() || libToken().trim().length === 0}
          >
            Сохранить
          </button>
        </div>

        <Show when={(animelib()?.servers ?? []).length > 0}>
          <div class="panel__row">
            <span class="panel__rowlabel">Сервер видео</span>
            <div class="segment">
              <For each={animelib()!.servers}>
                {(server) => (
                  <button
                    data-active={animelib()?.selected === server.id}
                    onClick={() => void chooseServer(server.id)}
                  >
                    {SERVER_LABELS[server.id] ?? server.id}
                  </button>
                )}
              </For>
            </div>
          </div>
          <p class="panel__hint">
            Если серия не открывается, переключите сервер — резервные бывают недоступны.
          </p>
        </Show>
      </section>

      <section class="panel">
        <h2 class="panel__title">Shikimori</h2>

        <Show
          when={status()?.loggedIn}
          fallback={
            <>
              <p class="panel__hint">
                Синхронизация списков требует своего OAuth-приложения. Создайте его на
                странице «Мои приложения» на Shikimori, укажите тот же redirect_uri, что
                и здесь, и вставьте выданные Client ID и Client Secret.
              </p>

              <div class="field-grid">
                <label class="field">
                  <span>Client ID</span>
                  <input
                    value={clientId()}
                    onInput={(event) => setClientId(event.currentTarget.value)}
                    spellcheck={false}
                    autocomplete="off"
                  />
                </label>

                <label class="field">
                  <span>Client Secret</span>
                  <input
                    type="password"
                    value={clientSecret()}
                    onInput={(event) => setClientSecret(event.currentTarget.value)}
                    spellcheck={false}
                    autocomplete="off"
                  />
                </label>
              </div>

              <div class="segment">
                <button
                  data-active={redirect() === LOOPBACK}
                  onClick={() => setRedirect(LOOPBACK)}
                >
                  Автоматически
                </button>
                <button data-active={redirect() === OOB} onClick={() => setRedirect(OOB)}>
                  Кодом вручную
                </button>
              </div>

              <div class="panel__actions">
                <button class="btn btn--primary" onClick={() => void saveConfig()} disabled={busy()}>
                  Сохранить приложение
                </button>

                <Show when={status()?.configured}>
                  <Show
                    when={redirect() === LOOPBACK}
                    fallback={
                      <button class="btn" onClick={() => void openAuthPage()}>
                        <Icon name="external" size={16} />
                        Открыть страницу входа
                      </button>
                    }
                  >
                    <button class="btn" onClick={() => void loginLoopback()} disabled={busy()}>
                      Войти через браузер
                    </button>
                  </Show>
                </Show>
              </div>

              <Show when={status()?.configured && redirect() === OOB}>
                <div class="field-inline">
                  <label class="field">
                    <span>Код авторизации</span>
                    <input
                      value={code()}
                      onInput={(event) => setCode(event.currentTarget.value)}
                      placeholder="Вставьте код со страницы Shikimori"
                      spellcheck={false}
                    />
                  </label>
                  <button
                    class="btn btn--primary"
                    onClick={() => void loginWithCode()}
                    disabled={busy() || code().trim().length === 0}
                  >
                    Войти
                  </button>
                </div>
              </Show>
            </>
          }
        >
          <div class="account">
            <Show when={status()?.account?.avatar}>
              <img class="account__avatar" src={status()!.account!.avatar!} alt="" />
            </Show>
            <div>
              <div class="account__name">{status()?.account?.nickname}</div>
              <div class="panel__hint">
                Прогресс и статусы отправляются в Shikimori автоматически
              </div>
            </div>
            <button class="btn btn--danger" onClick={() => void logout()}>
              Выйти
            </button>
          </div>
        </Show>
      </section>

      <section class="panel">
        <h2 class="panel__title">Новые серии</h2>
        <p class="panel__hint">
          Раз в час приложение сверяет расписание Shikimori с вашей библиотекой
          и присылает системное уведомление, когда выходит серия того, что вы
          смотрите или отложили. Работает только для тайтлов, у которых есть
          связь с каталогом.
        </p>

        <div class="panel__row">
          <span class="panel__rowlabel">Уведомлять о новых сериях</span>
          <Toggle checked={notify()} onChange={(value) => void setNotify(value)} />
        </div>
      </section>

      <section class="panel">
        <h2 class="panel__title">Кэш каталога</h2>
        <p class="panel__hint">
          Описания, подборки и обложки хранятся на диске, поэтому приложение
          открывается сразу и продолжает показывать каталог, когда Shikimori
          недоступен. Устаревшее обновляется само.
        </p>

        <div class="panel__row">
          <span class="panel__rowlabel">Сейчас на диске</span>
          <Show when={cache()} fallback={<span class="page-sub">считаем…</span>}>
            {(stats) => (
              <span class="page-sub">
                {stats().entries} {plural(stats().entries, "запись", "записи", "записей")}
                {" · "}
                {formatBytes(stats().bytes)}
              </span>
            )}
          </Show>
        </div>

        <div class="panel__actions">
          <button class="btn" onClick={() => void dropCache()}>
            <Icon name="trash" size={14} />
            Очистить кэш
          </button>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel__title">Горячие клавиши</h2>
        <div class="shortcuts">
          <For
            each={[
              ["⌘K / /", "Поиск"],
              ["Пробел / K", "Пауза"],
              ["← →", "Перемотка на 5 секунд"],
              ["Shift + ← →", "Перемотка на 30 секунд"],
              ["↑ ↓", "Громкость"],
              ["F", "Во весь экран"],
              ["P", "Картинка в картинке"],
              ["M", "Без звука"],
              ["N", "Следующая серия"],
              ["Esc", "Назад / закрыть плеер"],
            ]}
          >
            {([keys, label]) => (
              <div class="shortcut">
                <span class="kbd">{keys}</span>
                <span>{label}</span>
              </div>
            )}
          </For>
        </div>
      </section>
    </div>
  );
}

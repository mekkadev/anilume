import { For, Show, createResource, createSignal } from "solid-js";

import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { activeSource, pushToast, reportError, setActiveSource, sources } from "../lib/store";

const OOB = "urn:ietf:wg:oauth:2.0:oob";
const LOOPBACK = "http://127.0.0.1:53682/";

export function Settings() {
  const [status, { refetch }] = createResource(() => api.shikimoriStatus());

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
          <p class="page-sub">Источники и синхронизация</p>
        </div>
      </div>

      <section class="panel">
        <h2 class="panel__title">Источник по умолчанию</h2>
        <p class="panel__hint">
          Каталог и поиск используют выбранный источник. Часть из них отдаёт контент
          только с IP СНГ.
        </p>

        <div class="source-cards">
          <For each={sources()}>
            {(source) => (
              <button
                class="source-card"
                data-active={activeSource() === source.key}
                onClick={() => setActiveSource(source.key)}
              >
                <div class="source-card__head">
                  <span class="source-card__name">{source.name}</span>
                  <Show when={activeSource() === source.key}>
                    <Icon name="check" size={16} />
                  </Show>
                </div>
                <div class="source-card__desc">{source.description}</div>
                <div class="source-card__notes">
                  <For each={source.notes}>
                    {(note) => <span class="chip">{note}</span>}
                  </For>
                </div>
              </button>
            )}
          </For>
        </div>
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

import { For, Show, createResource, createSignal, onMount } from "solid-js";

import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { qualityLabel } from "../lib/format";
import { pushToast, reportError, sourceName } from "../lib/store";
import type { DownloadItem, DownloadStatus } from "../lib/types";

const STATUS_LABELS: Record<DownloadStatus, string> = {
  queued: "В очереди",
  running: "Скачивается",
  done: "Готово",
  error: "Ошибка",
  canceled: "Отменено",
};

export function Downloads() {
  const [items, { refetch, mutate }] = createResource(() => api.downloadsList());
  const [available] = createResource(() => api.downloadsAvailable());
  const [busy, setBusy] = createSignal<number | null>(null);

  onMount(() => {
    void api.onDownloadProgress((event) => {
      mutate((current) =>
        (current ?? []).map((item) =>
          item.id === event.id
            ? {
                ...item,
                status: event.status,
                progress: event.progress,
                error: event.error ?? null,
              }
            : item,
        ),
      );
    });
  });

  const cancel = async (item: DownloadItem) => {
    setBusy(item.id);
    try {
      await api.downloadsCancel(item.id);
      await refetch();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: DownloadItem, deleteFile: boolean) => {
    setBusy(item.id);
    try {
      await api.downloadsRemove(item.id, deleteFile);
      await refetch();
      pushToast(deleteFile ? "Файл удалён" : "Убрано из списка");
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="fade-in">
      <div class="page-head">
        <div>
          <h1 class="page-title">Загрузки</h1>
          <p class="page-sub">Серии, сохранённые для просмотра без сети</p>
        </div>
        <button class="btn" onClick={() => void refetch()}>
          <Icon name="refresh" size={16} />
          Обновить
        </button>
      </div>

      <Show when={available() === false}>
        <div class="notice notice--warning">
          <Icon name="settings" size={18} />
          <div>
            <strong>ffmpeg не найден</strong>
            <div>
              Скачивание требует ffmpeg. Установите его или укажите путь в переменной
              окружения ANILUME_FFMPEG.
            </div>
          </div>
        </div>
      </Show>

      <Show
        when={(items() ?? []).length > 0}
        fallback={
          <div class="empty">
            <div class="empty__title">Загрузок пока нет</div>
            <p>Нажмите «Скачать» у серии на странице аниме</p>
          </div>
        }
      >
        <div class="library-list">
          <For each={items()}>
            {(item) => (
              <div class="download-row" data-status={item.status}>
                <div class="library-row__art">
                  <Show when={item.poster}>
                    <img src={item.poster!} alt="" loading="lazy" decoding="async" />
                  </Show>
                </div>

                <div class="download-row__body">
                  <div class="library-row__title">
                    {item.animeTitle} — серия {item.episodeOrdinal}
                  </div>
                  <div class="library-row__meta">
                    {sourceName(item.source)}
                    <Show when={item.studio}> · {item.studio}</Show> ·{" "}
                    {qualityLabel(item.quality)}
                  </div>

                  <Show when={item.status === "running" || item.status === "queued"}>
                    <div class="download-row__bar">
                      <span style={{ width: `${item.progress * 100}%` }} />
                    </div>
                  </Show>

                  <Show when={item.error}>
                    <div class="download-row__error">{item.error}</div>
                  </Show>
                </div>

                <div class="download-row__side">
                  <span class="chip" data-status={item.status}>
                    {STATUS_LABELS[item.status]}
                    <Show when={item.status === "running"}>
                      {" "}
                      {Math.round(item.progress * 100)}%
                    </Show>
                  </span>

                  <Show
                    when={item.status === "running" || item.status === "queued"}
                    fallback={
                      <button
                        class="tool-btn btn--danger"
                        title="Удалить"
                        disabled={busy() === item.id}
                        onClick={() => void remove(item, item.status === "done")}
                      >
                        <Icon name="trash" size={17} />
                      </button>
                    }
                  >
                    <button
                      class="tool-btn"
                      title="Отменить"
                      disabled={busy() === item.id}
                      onClick={() => void cancel(item)}
                    >
                      <Icon name="close" size={17} />
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

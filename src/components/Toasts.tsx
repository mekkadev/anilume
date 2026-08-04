import { For, Show } from "solid-js";

import { dismissToast, toasts } from "../lib/store";

export function Toasts() {
  return (
    <div class="toasts">
      <For each={toasts}>
        {(toast) => (
          <div class="toast" data-tone={toast.tone} onClick={() => dismissToast(toast.id)}>
            <div>{toast.message}</div>
            <Show when={toast.hint}>
              <div class="toast__hint">{toast.hint}</div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

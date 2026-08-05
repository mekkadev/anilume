import { Show, createEffect, createSignal, onCleanup } from "solid-js";

import { Icon } from "./Icon";

interface ArtProps {
  src: string | null | undefined;
  title?: string;
  eager?: boolean;
}

export function Art(props: ArtProps) {
  const [shown, setShown] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [broken, setBroken] = createSignal(false);

  let probe: HTMLImageElement | null = null;

  createEffect(() => {
    const value = props.src ?? null;
    if (value === shown()) return;

    probe?.removeAttribute("src");
    probe = null;

    if (!value || !loaded()) {
      setShown(value);
      setBroken(false);
      return;
    }

    const loader = new Image();
    probe = loader;
    loader.onload = () => {
      if (probe !== loader) return;
      probe = null;
      setBroken(false);
      setShown(value);
    };
    loader.onerror = () => {
      if (probe !== loader) return;
      probe = null;
    };
    loader.src = value;
  });

  onCleanup(() => {
    probe?.removeAttribute("src");
    probe = null;
  });

  const initials = () =>
    (props.title ?? "")
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("");

  return (
    <Show when={shown() && !broken()} fallback={<Blank label={initials()} />}>
      <img
        ref={(node) =>
          queueMicrotask(() => {
            if (node.complete && node.naturalWidth > 0) setLoaded(true);
          })
        }
        src={shown()!}
        alt=""
        loading={props.eager ? "eager" : "lazy"}
        decoding="async"
        data-loaded={loaded()}
        onLoad={() => setLoaded(true)}
        onError={() => setBroken(true)}
      />
    </Show>
  );
}

function Blank(props: { label: string }) {
  return (
    <div class="art-blank">
      <Show when={props.label} fallback={<Icon name="play" size={18} />}>
        <span>{props.label}</span>
      </Show>
    </div>
  );
}

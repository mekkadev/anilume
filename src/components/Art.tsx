import { Show, createEffect, createSignal } from "solid-js";

import { Icon } from "./Icon";

interface ArtProps {
  src: string | null | undefined;
  title?: string;
  eager?: boolean;
}

export function Art(props: ArtProps) {
  const [loaded, setLoaded] = createSignal(false);
  const [broken, setBroken] = createSignal(false);

  createEffect(() => {
    props.src;
    setLoaded(false);
    setBroken(false);
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
    <Show when={props.src && !broken()} fallback={<Blank label={initials()} />}>
      <img
        src={props.src!}
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

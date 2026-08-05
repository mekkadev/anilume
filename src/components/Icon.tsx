import type { JSX } from "solid-js";

const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5.5 9.2V20a1 1 0 0 0 1 1H9.5v-5.5h5V21h3a1 1 0 0 0 1-1V9.2",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.5-4.5",
  library: "M4 5h5v14H4zM10.5 5h5v14h-5zM17.5 6.4l3 .8-3.4 12.6-2.9-.8z",
  download: "M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  settings:
    "M12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm8.5-3.5a8.5 8.5 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8.4 8.4 0 0 0-2-1.2L15.6 3h-3.9l-.4 2.6c-.7.3-1.4.7-2 1.2l-2.4-1-2 3.4 2 1.6a8.5 8.5 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h3.9l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z",
  back: "M15 5l-7 7 7 7",
  play: "M7 4.5v15l13-7.5z",
  pause: "M8 4.5h3.5v15H8zM14.5 4.5H18v15h-3.5z",
  next: "M6 4.5 16 12 6 19.5zM18 4.5h2.5v15H18z",
  previous: "M18 4.5 8 12l10 7.5zM3.5 4.5H6v15H3.5z",
  volume: "M4 9.5h3.5L12 5.5v13L7.5 14.5H4z",
  muted: "M4 9.5h3.5L12 5.5v13L7.5 14.5H4zM16 9.5l5 5m0-5-5 5",
  fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  compress: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  pip: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6M3 6v9a2 2 0 0 0 2 2h2M6 13h7v6H6z",
  close: "M6 6l12 12M18 6 6 18",
  check: "M4.5 12.5 9.5 17.5 20 7",
  plus: "M12 5v14M5 12h14",
  bookmark: "M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1Z",
  star: "M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.2-5.4-2.9-5.4 2.9 1-6.2L3.2 10l6.1-.9z",
  refresh: "M20 12a8 8 0 1 1-2.6-5.9M20 3.5V9h-5.5",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  clock: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-14v5.2l3.5 2.1",
  subtitles: "M3 5.5h18v13H3zM6.5 11h5M14 11h3.5M6.5 14.5h3M12 14.5h5.5",
  chevron: "M6 9.5 12 15.5l6-6",
  sliders: "M4 7h9m3 0h4M4 17h4m3 0h9M14.5 7a1.75 1.75 0 1 1 3.5 0 1.75 1.75 0 0 1-3.5 0ZM6 17a1.75 1.75 0 1 1 3.5 0A1.75 1.75 0 0 1 6 17Z",
  audio: "M4 9.5h3.5L12 5.5v13L7.5 14.5H4zM15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10",
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends JSX.SvgSVGAttributes<SVGSVGElement> {
  name: IconName;
  size?: number;
  filled?: boolean;
}

export function Icon(props: IconProps) {
  const size = () => props.size ?? 20;
  const filled = () => props.filled ?? ["play", "pause", "next", "previous", "volume", "star", "bookmark"].includes(props.name);

  return (
    <svg
      viewBox="0 0 24 24"
      width={size()}
      height={size()}
      fill={filled() ? "currentColor" : "none"}
      stroke={filled() ? "none" : "currentColor"}
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}

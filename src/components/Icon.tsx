import type { JSX } from "solid-js";
import {
  AudioLines,
  Bookmark,
  CalendarDays,
  Captions,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock,
  CornerDownLeft,
  Download,
  ExternalLink,
  Flame,
  Heart,
  House,
  Layers2,
  Library,
  Maximize,
  MessageSquare,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-solid";

const ICONS = {
  home: House,
  search: Search,
  enter: CornerDownLeft,
  library: Library,
  download: Download,
  settings: Settings,
  back: ChevronLeft,
  play: Play,
  pause: Pause,
  next: SkipForward,
  previous: SkipBack,
  volume: Volume2,
  muted: VolumeX,
  fullscreen: Maximize,
  compress: Minimize,
  pip: PictureInPicture2,
  close: X,
  check: Check,
  plus: Plus,
  bookmark: Bookmark,
  star: Star,
  refresh: RefreshCw,
  trash: Trash2,
  external: ExternalLink,
  clock: Clock,
  subtitles: Captions,
  chevron: ChevronDown,
  sliders: SlidersHorizontal,
  audio: AudioLines,
  flame: Flame,
  sparkle: Sparkles,
  calendar: CalendarDays,
  heart: Heart,
  comment: MessageSquare,
  layers: Layers2,
} as const;

const SOLID: IconName[] = ["play", "pause", "next", "previous", "star", "bookmark"];

export type IconName = keyof typeof ICONS | "mark";

interface IconProps extends JSX.SvgSVGAttributes<SVGSVGElement> {
  name: IconName;
  size?: number;
  filled?: boolean;
}

export function Icon(props: IconProps) {
  const size = () => props.size ?? 20;
  const filled = () =>
    props.filled ?? SOLID.includes(props.name as IconName);

  if (props.name === "mark") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size()}
        height={size()}
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M5 8.5 9 4.5h6l4 4v7l-4 4H9l-4-4z" />
        <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  const Glyph = ICONS[props.name as keyof typeof ICONS];

  return (
    <Glyph
      size={size()}
      absoluteStrokeWidth
      stroke-width={1.8}
      fill={filled() ? "currentColor" : "none"}
      aria-hidden="true"
      {...props}
    />
  );
}

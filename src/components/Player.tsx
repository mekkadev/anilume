import type HlsPlayer from "hls.js";
import {
  For,
  Show,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";

import { api } from "../lib/api";
import { formatTime, qualityLabel } from "../lib/format";
import { pickQualityIndex, qualityPref } from "../lib/prefs";
import { closePlayer, pushToast, reportError } from "../lib/store";
import type { PlaybackRequest } from "../lib/store";
import type { VideoInfo, WatchProgress } from "../lib/types";
import { Icon } from "./Icon";

let HlsModule: typeof HlsPlayer | null = null;

async function loadHls() {
  if (!HlsModule) HlsModule = (await import("hls.js")).default;
  return HlsModule;
}

const CONTROLS_TIMEOUT = 2600;
const PROGRESS_INTERVAL = 5000;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function Player(props: { request: PlaybackRequest }) {
  let video!: HTMLVideoElement;
  let container!: HTMLDivElement;
  let hls: HlsPlayer | null = null;
  let hideTimer: number | undefined;
  let saveTimer: number | undefined;

  const [episodeIndex, setEpisodeIndex] = createSignal(props.request.episodeIndex);
  const [videos, setVideos] = createSignal<VideoInfo[]>(props.request.videos);
  const [qualityIndex, setQualityIndex] = createSignal(props.request.qualityIndex);
  const [studioTitle, setStudioTitle] = createSignal(props.request.studioTitle);

  const [playing, setPlaying] = createSignal(false);
  const [buffering, setBuffering] = createSignal(true);
  const [current, setCurrent] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [buffered, setBuffered] = createSignal(0);
  const [volume, setVolume] = createSignal(1);
  const [muted, setMuted] = createSignal(false);
  const [speed, setSpeed] = createSignal(1);
  const [fullscreen, setFullscreen] = createSignal(false);
  const [controlsVisible, setControlsVisible] = createSignal(true);
  const [menu, setMenu] = createSignal<"quality" | "speed" | "tracks" | null>(null);
  const [audioTracks, setAudioTracks] = createSignal<{ name: string; lang?: string }[]>([]);
  const [audioTrack, setAudioTrack] = createSignal(-1);
  const [subtitleTracks, setSubtitleTracks] = createSignal<{ name: string; lang?: string }[]>([]);
  const [subtitleTrack, setSubtitleTrack] = createSignal(-1);
  const [switchingTo, setSwitchingTo] = createSignal<number | null>(null);

  const episode = () => props.request.episodes[episodeIndex()];
  const activeVideo = () => videos()[qualityIndex()];
  const hasNext = () => episodeIndex() < props.request.episodes.length - 1;
  const hasPrevious = () => episodeIndex() > 0;

  const percent = () => (duration() > 0 ? (current() / duration()) * 100 : 0);
  const bufferPercent = () => (duration() > 0 ? (buffered() / duration()) * 100 : 0);

  async function load(target: VideoInfo, seekTo: number) {
    setBuffering(true);
    hls?.destroy();
    hls = null;

    try {
      const { url } = await api.openPlayback(target.url, target.headers);
      const isHls = target.type === "m3u8" || url.includes(".m3u8");

      const applySeek = () => {
        if (seekTo > 0) video.currentTime = seekTo;
        void video.play().catch(() => setPlaying(false));
      };

      const Hls = isHls ? await loadHls() : null;

      if (Hls?.isSupported()) {
        const instance = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 40,
        });
        hls = instance;

        const syncTracks = () => {
          setAudioTracks(
            instance.audioTracks.map((track) => ({
              name: track.name || track.lang || "Дорожка",
              lang: track.lang,
            })),
          );
          setAudioTrack(instance.audioTrack);
          setSubtitleTracks(
            instance.subtitleTracks.map((track) => ({
              name: track.name || track.lang || "Субтитры",
              lang: track.lang,
            })),
          );
          setSubtitleTrack(instance.subtitleTrack);
        };

        instance.on(Hls.Events.MANIFEST_PARSED, applySeek);
        instance.on(Hls.Events.MANIFEST_PARSED, syncTracks);
        instance.on(Hls.Events.AUDIO_TRACKS_UPDATED, syncTracks);
        instance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, syncTracks);
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            instance.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            instance.recoverMediaError();
          } else {
            pushToast("Поток оборвался — попробуйте другую озвучку", "error");
            setBuffering(false);
          }
        });
        instance.loadSource(url);
        instance.attachMedia(video);
      } else {
        setAudioTracks([]);
        setSubtitleTracks([]);
        video.src = url;
        video.addEventListener("loadedmetadata", applySeek, { once: true });
      }
    } catch (error) {
      reportError(error);
      setBuffering(false);
    }
  }

  function persist(force = false) {
    const info = episode();
    if (!info || duration() <= 0) return;
    if (!force && current() < 5) return;

    const progress: WatchProgress = {
      source: props.request.source,
      animeKey: props.request.animeKey,
      animeTitle: props.request.animeTitle,
      poster: props.request.poster,
      episodeOrdinal: info.ordinal,
      episodeTitle: info.title,
      positionSec: current(),
      durationSec: duration(),
      studio: studioTitle(),
      updatedAt: 0,
    };
    void api.saveProgress(progress).catch(() => undefined);
  }

  async function switchEpisode(index: number) {
    const target = props.request.episodes[index];
    if (!target) return;

    persist(true);
    setSwitchingTo(index);
    try {
      const { studios } = await api.studios(target.handle);
      if (studios.length === 0) {
        pushToast("Для этой серии нет плееров", "error");
        return;
      }

      const preferred =
        studios.find((studio) => studio.title === studioTitle()) ?? studios[0]!;
      const { videos: nextVideos } = await api.videos(preferred.handle);
      if (nextVideos.length === 0) {
        pushToast("Озвучка не отдала видео", "error");
        return;
      }

      setEpisodeIndex(index);
      setStudioTitle(preferred.title);
      setVideos(nextVideos);
      setCurrent(0);
      setDuration(0);

      const sameQuality = nextVideos.findIndex(
        (item) => item.quality === activeVideo()?.quality,
      );
      const nextIndex =
        sameQuality >= 0 ? sameQuality : pickQualityIndex(nextVideos, qualityPref());
      setQualityIndex(nextIndex);
      await load(nextVideos[nextIndex]!, 0);
    } catch (error) {
      reportError(error);
    } finally {
      setSwitchingTo(null);
    }
  }

  async function switchQuality(index: number) {
    const target = videos()[index];
    if (!target || index === qualityIndex()) return;

    const resumeAt = video.currentTime;
    const wasPlaying = !video.paused;
    setQualityIndex(index);
    setMenu(null);
    await load(target, resumeAt);
    if (!wasPlaying) video.pause();
  }

  function chooseAudio(index: number) {
    if (hls) hls.audioTrack = index;
    setAudioTrack(index);
  }

  function chooseSubtitle(index: number) {
    if (hls) {
      hls.subtitleTrack = index;
      hls.subtitleDisplay = index >= 0;
    }
    setSubtitleTrack(index);
  }

  function togglePlay() {
    if (video.paused) void video.play();
    else video.pause();
  }

  function seekBy(delta: number) {
    video.currentTime = Math.max(0, Math.min(video.currentTime + delta, duration()));
    revealControls();
  }

  function setVolumeValue(value: number) {
    const clamped = Math.max(0, Math.min(value, 1));
    video.volume = clamped;
    video.muted = clamped === 0;
    setVolume(clamped);
    setMuted(clamped === 0);
    void api.settingSet("player.volume", String(clamped));
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await container.requestFullscreen();
  }

  async function togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      pushToast("Картинка в картинке недоступна", "error");
    }
  }

  function revealControls() {
    setControlsVisible(true);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!video.paused && !menu()) setControlsVisible(false);
    }, CONTROLS_TIMEOUT);
  }

  function onScrub(event: MouseEvent) {
    const bar = event.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min((event.clientX - rect.left) / rect.width, 1));
    video.currentTime = ratio * duration();
  }

  function exit() {
    persist(true);
    closePlayer();
  }

  onMount(async () => {
    const storedVolume = await api.settingGet("player.volume");
    if (storedVolume !== null) {
      const parsed = Number(storedVolume);
      if (Number.isFinite(parsed)) setVolumeValue(parsed);
    }

    await load(activeVideo()!, props.request.startAt);
    revealControls();

    saveTimer = window.setInterval(() => {
      if (!video.paused) persist();
    }, PROGRESS_INTERVAL);

    const onKey = (event: KeyboardEvent) => {
      switch (event.key) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          seekBy(event.shiftKey ? -30 : -5);
          break;
        case "ArrowRight":
          seekBy(event.shiftKey ? 30 : 5);
          break;
        case "ArrowUp":
          event.preventDefault();
          setVolumeValue(volume() + 0.05);
          revealControls();
          break;
        case "ArrowDown":
          event.preventDefault();
          setVolumeValue(volume() - 0.05);
          revealControls();
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "p":
          void togglePip();
          break;
        case "m":
          video.muted = !video.muted;
          setMuted(video.muted);
          break;
        case "n":
          if (hasNext()) void switchEpisode(episodeIndex() + 1);
          break;
        case "Escape":
          if (document.fullscreenElement) void document.exitFullscreen();
          else exit();
          break;
      }
    };

    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));

    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreenChange);

    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.clearTimeout(hideTimer);
      window.clearInterval(saveTimer);
      hls?.destroy();
    });
  });

  createEffect(
    on(menu, (value) => {
      if (value) setControlsVisible(true);
      else revealControls();
    }, { defer: true }),
  );

  return (
    <div
      ref={container}
      class="player"
      data-controls={controlsVisible()}
      onMouseMove={revealControls}
      onDblClick={() => void toggleFullscreen()}
    >
      <video
        ref={video}
        class="player__video"
        playsinline
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          revealControls();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => {
          const element = event.currentTarget;
          setCurrent(element.currentTime);
          if (element.buffered.length > 0) {
            setBuffered(element.buffered.end(element.buffered.length - 1));
          }
        }}
        onEnded={() => {
          persist(true);
          if (props.request.autoplayNext && hasNext()) {
            void switchEpisode(episodeIndex() + 1);
          }
        }}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
      />

      <Show when={buffering() || switchingTo() !== null}>
        <div class="player__spinner">
          <span class="spinner spinner--lg" />
        </div>
      </Show>

      <div class="player__top">
        <button class="player-btn" onClick={exit} title="Закрыть (Esc)">
          <Icon name="close" size={20} />
        </button>
        <div class="player__heading">
          <div class="player__title">{props.request.animeTitle}</div>
          <div class="player__subtitle">
            {episode()?.title}
            <Show when={studioTitle()}> · {studioTitle()}</Show>
          </div>
        </div>
      </div>

      <div class="player__bar">
        <div class="scrub" onClick={onScrub}>
          <div class="scrub__track">
            <div class="scrub__buffer" style={{ width: `${bufferPercent()}%` }} />
            <div class="scrub__played" style={{ width: `${percent()}%` }}>
              <span class="scrub__knob" />
            </div>
          </div>
        </div>

        <div class="player__controls">
          <button
            class="player-btn"
            onClick={() => void switchEpisode(episodeIndex() - 1)}
            disabled={!hasPrevious() || switchingTo() !== null}
            title="Предыдущая серия"
          >
            <Icon name="previous" size={19} />
          </button>

          <button class="player-btn player-btn--lg" onClick={togglePlay} title="Пробел">
            <Icon name={playing() ? "pause" : "play"} size={24} />
          </button>

          <button
            class="player-btn"
            onClick={() => void switchEpisode(episodeIndex() + 1)}
            disabled={!hasNext() || switchingTo() !== null}
            title="Следующая серия (N)"
          >
            <Icon name="next" size={19} />
          </button>

          <div class="player__time">
            {formatTime(current())} <span>/ {formatTime(duration())}</span>
          </div>

          <div class="volume">
            <button
              class="player-btn"
              onClick={() => {
                video.muted = !video.muted;
                setMuted(video.muted);
              }}
              title="Звук (M)"
            >
              <Icon name={muted() || volume() === 0 ? "muted" : "volume"} size={19} />
            </button>
            <input
              class="volume__slider"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={muted() ? 0 : volume()}
              onInput={(event) => setVolumeValue(Number(event.currentTarget.value))}
            />
          </div>

          <div class="player__spacer" />

          <div class="menu">
            <button
              class="pill"
              onClick={() => setMenu(menu() === "speed" ? null : "speed")}
            >
              {speed()}×
            </button>
            <Show when={menu() === "speed"}>
              <div class="menu__backdrop" onClick={() => setMenu(null)} />
              <div class="menu__list menu__list--up">
                <For each={SPEEDS}>
                  {(value) => (
                    <button
                      class="menu__item"
                      data-active={speed() === value}
                      onClick={() => {
                        video.playbackRate = value;
                        setSpeed(value);
                        setMenu(null);
                      }}
                    >
                      {value}×
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div class="menu">
            <button
              class="pill"
              onClick={() => setMenu(menu() === "quality" ? null : "quality")}
            >
              {activeVideo() ? qualityLabel(activeVideo()!.quality) : "—"}
            </button>
            <Show when={menu() === "quality"}>
              <div class="menu__backdrop" onClick={() => setMenu(null)} />
              <div class="menu__list menu__list--up">
                <For each={videos()}>
                  {(item, index) => (
                    <button
                      class="menu__item"
                      data-active={qualityIndex() === index()}
                      onClick={() => void switchQuality(index())}
                    >
                      {qualityLabel(item.quality)}
                      <Show when={qualityIndex() === index()}>
                        <Icon name="check" size={15} />
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <Show when={audioTracks().length > 1 || subtitleTracks().length > 0}>
            <div class="menu">
              <button
                class="player-btn"
                title="Дорожки и субтитры"
                onClick={() => setMenu(menu() === "tracks" ? null : "tracks")}
              >
                <Icon name="subtitles" size={18} />
              </button>
              <Show when={menu() === "tracks"}>
                <div class="menu__backdrop" onClick={() => setMenu(null)} />
                <div class="menu__list menu__list--up menu__list--wide">
                  <Show when={audioTracks().length > 1}>
                    <div class="menu__label">Звук</div>
                    <For each={audioTracks()}>
                      {(track, index) => (
                        <button
                          class="menu__item"
                          data-active={audioTrack() === index()}
                          onClick={() => chooseAudio(index())}
                        >
                          {track.name}
                          <Show when={audioTrack() === index()}>
                            <Icon name="check" size={14} />
                          </Show>
                        </button>
                      )}
                    </For>
                  </Show>

                  <Show when={subtitleTracks().length > 0}>
                    <div class="menu__label">Субтитры</div>
                    <button
                      class="menu__item"
                      data-active={subtitleTrack() < 0}
                      onClick={() => chooseSubtitle(-1)}
                    >
                      Выключены
                      <Show when={subtitleTrack() < 0}>
                        <Icon name="check" size={14} />
                      </Show>
                    </button>
                    <For each={subtitleTracks()}>
                      {(track, index) => (
                        <button
                          class="menu__item"
                          data-active={subtitleTrack() === index()}
                          onClick={() => chooseSubtitle(index())}
                        >
                          {track.name}
                          <Show when={subtitleTrack() === index()}>
                            <Icon name="check" size={14} />
                          </Show>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>

          <button class="player-btn" onClick={() => void togglePip()} title="Картинка в картинке (P)">
            <Icon name="pip" size={19} />
          </button>

          <button
            class="player-btn"
            onClick={() => void toggleFullscreen()}
            title="Во весь экран (F)"
          >
            <Icon name={fullscreen() ? "compress" : "fullscreen"} size={19} />
          </button>
        </div>
      </div>
    </div>
  );
}

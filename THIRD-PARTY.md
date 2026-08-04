# third-party binaries

anilume ships two executables it did not write. both run as separate processes
and are invoked over a pipe, so anilume's own MIT licence covers only its own code.

## ffmpeg

used to remux downloaded episodes from hls to mp4 without re-encoding.

| platform | build | licence |
| --- | --- | --- |
| macOS arm64 | [osxexperts.net](https://www.osxexperts.net/) ffmpeg 7.1 | GPL-3.0 |
| Windows x64 | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) win64-lgpl | LGPL-3.0 |

both are pinned by sha256 in [`scripts/fetch_ffmpeg.py`](./scripts/fetch_ffmpeg.py).
upstream source for either build is the unmodified ffmpeg tree at
[git.ffmpeg.org/ffmpeg.git](https://git.ffmpeg.org/ffmpeg.git); licence texts are
[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html) and
[LGPL-3.0](https://www.gnu.org/licenses/lgpl-3.0.html).

replacing the bundled binary is supported: point `ANILUME_FFMPEG` at your own.

## the sidecar

a pyinstaller bundle of [anicli-api](https://github.com/vypivshiy/anicli-api) (MIT)
and its dependencies, built from [`sidecar/`](./sidecar) at release time.

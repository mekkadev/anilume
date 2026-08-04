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
the windows build tracks the `n7.1` release branch rather than `master`, because
btbn rebuilds master nightly and the pin broke within an hour of being written.
the release branch still gets rebuilt on point releases, so treat the checksum as
a tripwire rather than a guarantee of immutability: when it trips, the build stops
and someone re-pins on purpose. `python3 scripts/fetch_ffmpeg.py --triple <t>
--print-sha256` prints the new value.
upstream source for either build is the unmodified ffmpeg tree at
[git.ffmpeg.org/ffmpeg.git](https://git.ffmpeg.org/ffmpeg.git); licence texts are
[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html) and
[LGPL-3.0](https://www.gnu.org/licenses/lgpl-3.0.html).

replacing the bundled binary is supported: point `ANILUME_FFMPEG` at your own.

## the sidecar

a pyinstaller bundle of [anicli-api](https://github.com/vypivshiy/anicli-api) (MIT)
and its dependencies, built from [`sidecar/`](./sidecar) at release time.

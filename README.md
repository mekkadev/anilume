# anilume

a desktop anime client in russian, with its own player instead of someone else's iframe

[install](#install) · [build it yourself](#build-it-yourself) · [why the player is ours](#why-the-player-is-ours) · [what the player does](#what-the-player-does) · [sources](#sources) · [the catalogue](#the-catalogue) · [shikimori](#shikimori) · [downloads](#downloads) · [limits](#limits) · [stack](#stack)

every russian anime site solves playback the same way: drop a kodik or alloha iframe on the page and let it own the experience. that is why they all feel identical, and why none of them can resume you at 14:32 of episode 7, remember which dub you picked, or hand you the file.

anilume takes the other path. [anicli-api](https://github.com/vypivshiy/anicli-api) resolves a title down to a direct m3u8 or mp4, and everything above that line is ours — the scrubber, the dub picker, the quality switch that keeps your position, the progress that survives a restart.

the direct link is what makes that possible, and it is also what makes it hard.

## why the player is ours

a kodik segment url returns 403 unless the request carries the right `Referer`. hls.js runs on `fetch`, and `Referer` is a forbidden header — the browser will not let you set it. that is the whole reason a naive "just play the m3u8" build does not work.

so playback goes through a local proxy on the loopback interface. it attaches the headers anicli-api handed us, and rewrites the playlist so nested links come back through it too:

```
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"     →  URI="http://127.0.0.1:PORT/s/<session>/<b64>"
parts/seg-1.ts                              →  http://127.0.0.1:PORT/s/<session>/<b64>
```

relative paths resolve against the playlist url before rewriting, or variant playlists would end up pointing at localhost. encryption keys, init maps and alternate audio tracks hide their url inside a `URI="…"` attribute, so those are rewritten in place with the rest of the tag left alone. range requests pass through, because seeking depends on them. the target url is base64 in the path and anything that is not http or https is refused, so the proxy cannot be talked into reading local files.

sessions are uuids and die when the player closes. a stale link returns `410`, not video.

## what the player does

resume at the second you left off, dub switching without losing your position,
quality switching that keeps it too, speeds from 0.25× to 3×, picture-in-picture,
fullscreen, and skipping the opening where aniskip knows the timings.

subtitles come from three places: the ones baked into an hls stream, the ones a
source hands over as a separate track, and a `.srt` or `.vtt` file you open
yourself from the tracks menu. srt is converted to vtt in the browser; ass is
not supported, and the menu says so rather than failing silently.

audio tracks work the same way — an hls stream with several of them switches
inside the player, and where a source ships each dub as a separate stream
instead (animelib, kodik), the dub picker does the same job in one click.

decoding is the webview's: videotoolbox on macos, media foundation on windows,
both hardware-accelerated for h.264 and hevc without anything to configure.
that also fixes the format list — mp4 everywhere, webm on both, mkv on neither.
no source serves mkv and downloads are remuxed to mp4, so this has not come up
in practice, but it is a real limit rather than a missing feature.

## install

grab a build from [releases](https://github.com/mekkadev/anilume/releases) — `.dmg` for apple silicon, `.msi` or `.exe` for windows x64.

neither build is signed. on macos:

```bash
xattr -dr com.apple.quarantine /Applications/anilume.app
```

on windows, smartscreen will want "more info" → "run anyway".

## build it yourself

```bash
git clone https://github.com/mekkadev/anilume.git
cd anilume

npm install
pip install './sidecar[dev]'

npm run app:dev          # dev, sidecar runs from source
npm run sidecar:build    # one-file binary into src-tauri/binaries/
npm run app:build        # bundle
```

```bash
pytest                          # 51, sidecar, no network
cargo test -p anilume-core      # 69, includes a real proxy round-trip
npm run typecheck
```

the rust core is a separate crate from the tauri shell on purpose: the shell needs webview system libraries, the core does not, so tests and lint run anywhere including a bare ci container.

## sources

ten catalogues. nine come from anicli-api; animelib is talked to directly. the picker lives in the sidebar and the choice sticks.

| source | note |
| --- | --- |
| animelib | ten-plus dub teams per episode, full-size covers, and its own player up to 2160p — the 4k tier needs your account token, see below. the default |
| anilibria | works without a vpn, own dub, official rest api — the default |
| animego | biggest catalogue, most dubs, kodik and aniboom — needs a cis ip |
| yummy anime | rich metadata, and the only one that hands over a `shikimori_id` |
| animevost | direct mp4, so downloads are fast |
| anilib, sameband, dreamcast, hdrezka | smaller, or not anime-only |

search runs against one source by default and against all nine on request, concurrently. a source that fails does not take the page down with it — it comes back in a separate list, and geo-blocked ones say so instead of showing a generic error.

anicli-api objects are a stateful chain: episodes come off a live `Anime` object, which comes off a live `Search` object, and none of it is addressable by id. so the python sidecar keeps those objects in an lru and hands out string handles. when a handle is evicted you get `-32001` and the app quietly re-resolves the title by search. that is also why watch history and library store the source url rather than a handle — it is the only identifier that survives a restart.

## the catalogue

search by name is what a source can do. search by genre, year, studio and status
is what none of them can — the animelib api takes genres, types and a year range
but has no studio filter at all, and the anicli-api sources expose a search box
and nothing else.

so the catalogue page asks [shikimori](https://shikimori.one) instead: 46 genres,
1910 studios, a year range, airing status, type, and five sort orders, all from
its public api with no account needed. picking a title then searches for it by
name in whichever source is selected in the sidebar and opens it there.

that last step is the weak joint, and it is the same one history and the library
already live with: names are matched, not ids. a title shikimori knows but the
chosen source does not simply says so and suggests switching sources, which is
honest but not the same as finding it.

requests are paced to one every 240ms to stay inside shikimori's rate limit, and
the genre and studio lists are fetched once per launch and kept in memory.

## the animelib token

animelib answers anonymously with kodik links only. with your account token the same
episode also returns animelib's own player — direct mp4, up to 2160p, no iframe.

the token lives in your browser on v5.animelib.org: devtools, network tab, any request
to hapi.hentaicdn.org, the `Authorization` header minus the word `Bearer`. paste it into
settings. it is stored in the local sqlite database on your machine and sent to
animelib and nowhere else. the app works without it.

three cdn servers are published; they do not all answer at any given moment, so the
server picker sits in settings next to the token.

## shikimori

optional, and it needs your own oauth app — there is no shared client id to leak or get rate-limited.

register one at [shikimori.one/oauth/applications](https://shikimori.one/oauth/applications), paste the client id and secret into settings, and pick how the code comes back:

- **automatic** — redirect to `http://127.0.0.1:53682/`, the app listens on that port and catches the code. set the same value as the redirect uri on shikimori.
- **by hand** — `urn:ietf:wg:oauth:2.0:oob`, shikimori shows you a code, you paste it.

tokens refresh on their own and requests are paced to stay inside the rate limit. changing a title's status in the library pushes it upstream when the source gave us a shikimori id.

## downloads

ffmpeg is bundled, so downloads work out of the box. it remuxes the stream to mp4 without re-encoding, so a 24-minute episode takes about as long as the bytes take to arrive. progress comes from parsing ffmpeg's own output, two at a time, cancellable. `ANILUME_FFMPEG` overrides the bundled binary if you want your own.

that convenience is most of the download size: the app itself is around 20 mb and ffmpeg is 50-110 mb on top, depending on platform. the builds are pinned by sha256 and ci refuses to package one until it has actually remuxed a test stream on that runner — a static build that segfaults on mpeg-ts is a real thing, and it happened while wiring this up.

files land in `~/Videos/anilume/<title>/<title> - 03 серия [dub] [1080p].mp4`.

## limits

- **parsers break.** sites change their markup and anicli-api catches up on its own schedule. when a source fails, the app names it and suggests another rather than pretending nothing happened.
- **animego, kodik and aniboom want a cis ip.** anilibria and yummy anime do not, which is why anilibria is the default.
- **handles do not survive a restart.** the app re-resolves by title search, which is fast but can land on the wrong entry if a catalogue has near-duplicates.
- **the download is large.** bundling ffmpeg is the whole reason: ~70 mb on macos, ~135 mb on windows. see [third-party licenses](./THIRD-PARTY.md) — the macos build is gpl, the windows one lgpl.
- **the sidecar is python.** pyinstaller adds about 17 mb to the bundle. porting nine extractors to rust to avoid it was not worth doing twice.
- **neither build is signed.** see install.
- **not a library.** it plays what public sources already serve; it hosts and decrypts nothing.

## stack

rust, tauri 2, solidjs, python, hls.js, sqlite, ffmpeg.

solid rather than react because the catalogue is a long scroll of images and fine-grained updates beat memoising a tree into behaving. hls.js loads on demand — the app starts on 74 kb of javascript and pulls the other 523 kb the first time you press play.

built on [anicli-api](https://github.com/vypivshiy/anicli-api) by vypivshiy, which does the actual work of turning a title into a url.

mit

## updates

the app checks for a new release on launch and offers to install it. that needs a
signing keypair, which is not in the repository — generate your own once:

```bash
npx tauri signer generate -w ~/.tauri/anilume.key
```

put the **public** key into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`,
and add the private key and its password as repository secrets named
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

the release workflow checks for that secret. without it the build still succeeds,
it just ships without update artifacts — so a missing key degrades the release
rather than breaking it.

## skipping the opening

episode intervals come from [aniskip](https://api.aniskip.com), keyed by myanimelist
id. shikimori shares those ids for anime, so any source that hands over a shikimori
id gets the skip button — yummy anime directly, animelib through its shikimori link.
when aniskip has nothing for an episode the button simply never appears.

<div align="center">

<img src="./assets/logo.png" width="200" alt="anilume">

# anilume

десктопный клиент для просмотра аниме с русской озвучкой на macOS и Windows —
со своим плеером вместо чужого iframe

a desktop anime client for macOS and Windows with russian dubs —
its own player instead of someone else's iframe

[скачать](#установка) · [что умеет](#что-умеет-плеер) · [источники](#источники) · [почему свой плеер](#почему-плеер-свой) · [ограничения](#ограничения) · [english](#anilume--english)

</div>

Каждый русский аниме-сайт решает воспроизведение одинаково: кладёт на страницу
iframe Kodik или Alloha и отдаёт ему весь опыт просмотра. Поэтому все они
ощущаются одинаково, и поэтому ни один не умеет вернуть тебя на 14:32 седьмой
серии, запомнить выбранную озвучку или отдать файл.

anilume идёт другим путём. [anicli-api](https://github.com/vypivshiy/anicli-api)
разрешает тайтл до прямой ссылки m3u8 или mp4, а всё, что выше этой линии, —
своё: перемотка, выбор озвучки, переключение качества с сохранением позиции,
прогресс, который переживает перезапуск.

Открытый исходный код, лицензия MIT, без рекламы, без аккаунта и без телеметрии.

## установка

Сборки лежат в [релизах](https://github.com/mekkadev/anilume/releases).

| файл | для чего |
| --- | --- |
| `anilume_0.3.2_aarch64.dmg` | macOS 11+ на Apple Silicon, 40 МБ |
| `anilume-0.3.2-macos-arm64-portable.zip` | то же без установки |
| `anilume_0.3.2_x64-setup.exe` | Windows 10/11 x64, 52 МБ |
| `anilume_0.3.2_x64_en-US.msi` | он же в MSI, 64 МБ |
| `anilume-0.3.2-windows-x64-portable.zip` | без установки |

Портативные сборки запускаются через `anilume-portable.cmd`
(`anilume-portable.command` на macOS): база, история и скачанные серии лягут
в папки `data` и `downloads` рядом с приложением, в системе не останется ничего.
Те же переменные `ANILUME_DATA_DIR` и `ANILUME_DOWNLOADS_DIR` работают
и в обычных сборках, если хочется держать базу в конкретном месте.

Ни одна сборка не подписана: нотаризация у Apple стоит 99 долларов в год,
и пока их никто не платит, macOS будет ругаться на первый запуск. Обойти это
можно без Терминала.

**Самый простой способ.** Запустить приложение, получить отказ, затем открыть
Системные настройки → Конфиденциальность и безопасность, пролистать вниз до
строки про заблокированное приложение и нажать «Всё равно открыть». Подтвердить
паролем или Touch ID. Один раз на версию. На macOS 14 и старше то же самое
делается быстрее: правый клик по приложению → «Открыть» → «Открыть».

**Способ, при котором ругани не будет вообще.** Карантин вешает не система,
а браузер, который скачал файл. Если скачать мимо браузера, вешать нечего:

```bash
curl -L -o ~/Downloads/anilume.dmg \
  https://github.com/mekkadev/anilume/releases/latest/download/anilume_0.3.2_aarch64.dmg
open ~/Downloads/anilume.dmg
```

**Если приложение уже скачано браузером** и хочется одной командой:

```bash
xattr -dr com.apple.quarantine /Applications/anilume.app
```

В Windows SmartScreen попросит «Подробнее» → «Выполнить в любом случае».
Windows-сборке нужен Microsoft Edge WebView2 — он есть в Windows 10 21H2
и новее.

## что умеет плеер

Продолжение с той секунды, где остановился. Переключение озвучки без потери
позиции. Смена качества, которая тоже её сохраняет. Скорости от 0.25× до 3×.
Картинка в картинке, полный экран, пропуск опенинга и эндинга по данным
[AniSkip](https://api.aniskip.com). Автопереход на следующую серию с обратным
отсчётом за пятнадцать секунд до конца — и с кнопкой «не надо».

Субтитры приходят из трёх мест: вшитые в HLS-поток, отданные источником
отдельной дорожкой, и файл `.srt` или `.vtt`, который открываешь сам из меню
дорожек. SRT конвертируется в VTT прямо в приложении. ASS не поддерживается,
и меню говорит об этом, а не молчит.

Аудиодорожки работают так же: если их несколько внутри HLS-потока, они
переключаются в плеере, а там, где источник отдаёт каждую озвучку отдельным
потоком (AnimeLib, Kodik), ту же работу делает выбор озвучки в один клик.

Декодирует системный вебвью: VideoToolbox на macOS, Media Foundation
на Windows, оба с аппаратным ускорением для H.264 и HEVC, настраивать нечего.
Отсюда же список форматов — mp4 везде, webm на обоих, mkv ни на одном.
Ни один источник не отдаёт mkv, а скачанное ремуксится в mp4, так что
на практике это не мешало, но это честное ограничение, а не недоделка.

## каталог и поиск

Поиск по названию умеет любой источник. Поиск по жанру, году, студии и статусу
не умеет ни один: у API AnimeLib есть жанры, типы и диапазон лет, но нет
фильтра по студии вообще, а источники anicli-api отдают только строку поиска.

Поэтому страница каталога спрашивает [Shikimori](https://shikimori.one):
46 жанров, 1910 студий, диапазон лет, статус выхода, тип и пять сортировок —
всё из публичного API, без аккаунта. Выбранный тайтл открывается по названию,
а где его смотреть — решается уже на его странице.

Оттуда же приходят ряды на главной, студия и хронометраж на странице аниме,
её сезоны, похожее и обсуждение под ней. Тайтл, открытый из источника,
сопоставляется с Shikimori по названию и году, если источник не отдал id.

Запросы идут не чаще одного в 240 мс и не больше восьмидесяти в минуту — у
Shikimori лимит и на секунду, и на минуту, и одной паузы между запросами мало.
Обрыв связи и 429 переживаются тремя попытками с нарастающей задержкой. Списки
жанров и студий тянутся один раз за запуск и держатся в памяти.

## откуда обложки

Постеры Shikimori — 225×350. Этого хватает на список, но не на карточку в сетке
на ретине и совсем не хватает на большой арт: растянутый постер выглядит как
240p, потому что это и есть 240p.

Поэтому обложки берутся из [AniList](https://anilist.co): `extraLarge` — 460×636,
вдвое больше по каждой стороне. Сопоставление идёт по id MyAnimeList, а у аниме
id Shikimori и MAL совпадают, так что промежуточного поиска не нужно. Один запрос
отдаёт до пятидесяти тайтлов сразу, ответы кешируются на диске на месяц,
запросы разведены на 800 мс.

Широкий арт для героя на главной и шапки страницы аниме — это кадры Shikimori
(1920×1080), а если их нет, баннер AniList (1900×400). Когда нет ни того ни
другого, вместо растянутого постера показывается он же, но размытый: честнее
признать, что большой картинки нет, чем выдать мыло за неё.

## кэш каталога

Всё, что приходит из Shikimori и AniList, складывается в SQLite рядом с базой
просмотров. Подборки живут час, описания тайтлов — сутки, связанное и похожее —
неделю, обложки — месяц. Пока запись свежая, приложение вообще не ходит в сеть:
главная рисуется сразу при запуске, а лимиты Shikimori (5 запросов в секунду и
90 в минуту) не тратятся впустую.

Когда запись устарела, приложение идёт за новой — и если каталог не ответил,
отдаёт старую вместо пустого экрана. Провайдер режет Shikimori, зеркала легли,
интернета нет — вчерашние подборки и описания на месте. Размер кэша и кнопка
очистки лежат в настройках.

## интерфейс

Одно окно без хрома. Слева плавающий стеклянный рельс с шестью разделами,
всё остальное — контент. За ним фоновый слой, который берёт ключевой арт того,
на что ты сейчас смотришь, размывает его на 72 пикселя и приглушает под вуалью:
окно окрашивается тем, что на экране, а не темой.

Главная — карусель-герой поверх арта и ряды: популярное, новинки, сейчас
выходит, лучшее, для вас. Четыре из них из Shikimori; «сейчас выходит» —
из выбранного источника, потому что это единственный ряд, где кнопка «смотреть»
гарантированно сработает. «Для вас» построено на последнем просмотренном
и пишет об этом в заголовке, а не притворяется рекомендательной моделью.

Страница аниме несёт постер, оценку, студию, хронометраж, жанры, описание,
список серий, сезоны и побочные истории, похожее и обсуждение с Shikimori.
BBCode разбирается на стороне Rust: теги снимаются, спойлер-блоки выкидываются
вместе с содержимым, наружу выходит только текст — ничего не рендерится
как HTML.

Светлая и тёмная темы обе рабочие. Акцент следует системному цвету на macOS.

## почему плеер свой

Сегмент Kodik отвечает 403, если в запросе нет правильного `Referer`. hls.js
работает через `fetch`, а `Referer` — запрещённый заголовок, браузер не даст
его выставить. Ровно поэтому наивная сборка «просто проиграй m3u8» не работает.

Воспроизведение идёт через локальный прокси на петлевом интерфейсе. Он
подставляет заголовки, которые отдал anicli-api, и переписывает плейлист так,
чтобы вложенные ссылки тоже возвращались через него:

```
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"     →  URI="http://127.0.0.1:PORT/s/<сессия>/<b64>"
parts/seg-1.ts                              →  http://127.0.0.1:PORT/s/<сессия>/<b64>
```

Относительные пути разрешаются относительно адреса плейлиста до переписывания,
иначе вариантные плейлисты начали бы указывать на localhost. Ключи шифрования,
init-карты и альтернативные аудиодорожки прячут адрес внутри атрибута `URI="…"`,
поэтому они переписываются на месте, а остальная часть тега остаётся как есть.
Range-запросы проходят насквозь, потому что от них зависит перемотка. Целевой
адрес лежит в пути в base64, и всё, что не http и не https, отклоняется, так
что прокси нельзя уговорить прочитать локальный файл.

Сессии — это uuid, они умирают вместе с закрытием плеера. Протухшая ссылка
возвращает `410`, а не видео.

## источники

Десять каталогов. Девять приходят из anicli-api, с AnimeLib приложение
разговаривает напрямую. Выбирать источник заранее не нужно: открываешь аниме —
приложение само ищет его во всех десяти сразу, замеряет, кто какое качество
отдаёт, и включает лучший. Остальные стоят рядом строкой «где смотреть»
с реальным разрешением и числом озвучек, переключение в один клик и
запоминается для этого тайтла.

| источник | чем интересен |
| --- | --- |
| AnimeLib | десять с лишним команд озвучки на серию, полноразмерные обложки и свой плеер до 2160p — 4K требует токена аккаунта, см. ниже. По умолчанию |
| AniLibria | работает без VPN, своя озвучка, официальный REST API |
| AnimeGO | самый большой каталог, больше всего озвучек, Kodik и Aniboom — нужен IP СНГ |
| Yummy Anime | богатые метаданные и единственный, кто отдаёт `shikimori_id` |
| AnimeVost | прямой mp4, поэтому быстро качается |
| AniLib, Sameband, Dreamcast, HDrezka | помельче или не только про аниме |

Замер — это не заявленный потолок, а фактический: сайдкар одним запросом
проходит по всем найденным источникам параллельно, для каждого берёт первую
серию, первую озвучку и максимальное качество, которое та реально отдаёт.
Источник, который лёг или не отдал видео, так и подписан, а не выкинут молча.

Поиск на странице поиска идёт по одному источнику и по всем девяти по запросу,
параллельно. Упавший источник не роняет страницу — он возвращается отдельным
списком, а гео-заблокированные так и говорят вместо общей ошибки.

Объекты anicli-api — это цепочка с состоянием: серии берутся с живого объекта
`Anime`, который берётся с живого `Search`, и ничто из этого не адресуется по id.
Поэтому python-сайдкар держит эти объекты в LRU и раздаёт строковые хендлы.
Когда хендл вытесняется, приходит `-32001`, и приложение тихо перерешает тайтл
поиском. По той же причине история и библиотека хранят адрес тайтла в источнике,
а не хендл — это единственный идентификатор, переживающий перезапуск.

## токен animelib

Анонимно AnimeLib отдаёт только ссылки Kodik. С токеном аккаунта та же серия
возвращает ещё и собственный плеер AnimeLib — прямой mp4, до 2160p, без iframe.

Токен лежит в браузере на v5.animelib.org: войти, открыть любую серию, devtools,
вкладка network, запрос к hapi.hentaicdn.org вида `/api/episodes/…` — именно
строка с методом GET, а не OPTIONS: предзапрос заголовков не несёт, он лишь
объявляет, что `Authorization` будет отправлен. В заголовках запроса взять
`Authorization` и скопировать всё после слова `Bearer`. Вставить в настройки —
или не выковыривать вовсе: правый клик по запросу, «Копировать как cURL»,
вставить целиком, приложение достанет токен само. Аккаунт бесплатный.
Если не находится — есть [пошаговая инструкция со скриптом для консоли](./docs/animelib-token.md),
который достаёт токен сам. Он хранится в локальной базе SQLite на твоей машине
и уходит только в AnimeLib. Без него приложение работает.

Опубликовано три CDN-сервера, и отвечают они не все и не всегда, поэтому рядом
с полем токена в настройках стоит выбор сервера.

## shikimori

Синхронизация списка — опциональная, и ей нужно своё OAuth-приложение: общего
client id, который можно слить или упереть в лимит, здесь нет.

Зарегистрировать на [shikimori.one/oauth/applications](https://shikimori.one/oauth/applications),
вставить client id и secret в настройки и выбрать, как возвращается код:

- **автоматически** — редирект на `http://127.0.0.1:53682/`, приложение слушает
  этот порт и ловит код. Тот же адрес указать как redirect uri на Shikimori.
- **руками** — `urn:ietf:wg:oauth:2.0:oob`, Shikimori покажет код, ты его
  вставишь.

Токены обновляются сами, запросы дозируются, чтобы держаться внутри лимита.
Смена статуса тайтла в библиотеке уходит наверх, когда источник дал
shikimori id.

Подбор по жанрам и студиям, описания, сезоны и комментарии работают
без всякой авторизации — это другая, публичная часть API.

## скачивание

ffmpeg лежит в бандле, поэтому скачивание работает из коробки. Он ремуксит
поток в mp4 без перекодирования, так что 24-минутная серия занимает примерно
столько, сколько идут байты. Прогресс читается из собственного вывода ffmpeg,
по две серии за раз, с отменой. `ANILUME_FFMPEG` подменяет бандленный бинарник
своим.

Это удобство — большая часть веса: само приложение около 20 МБ, ffmpeg сверху
ещё 50–110 МБ в зависимости от платформы. Сборки прибиты по sha256, и CI
отказывается их паковать, пока они не ремуксили тестовый поток прямо
на раннере — статическая сборка, падающая на MPEG-TS, это реальность,
и она встретилась при настройке.

Файлы кладутся в `~/Videos/anilume/<тайтл>/<тайтл> - 03 серия [озвучка] [1080p].mp4`.

## собрать самому

```bash
git clone https://github.com/mekkadev/anilume.git
cd anilume

npm install
pip install './sidecar[dev]'

npm run app:dev          # разработка, сайдкар из исходников
npm run sidecar:build    # однофайловый бинарник в src-tauri/binaries/
npm run app:build        # бандл
```

```bash
pytest                          # 55 тестов сайдкара, без сети
cargo test -p anilume-core      # 104 теста ядра, включая живой прокси
npm run typecheck
npm run test:ui                 # 9 сквозных тестов интерфейса в браузере
python scripts/design_lint.py   # правила оформления
```

Сквозные тесты поднимают собранный интерфейс в headless-Chromium с подменённым
мостом Tauri: каждый вызов бэкенда отвечает заранее заданными данными, а часть
вызовов можно намеренно подвесить. Так проверяется, что страница аниме
открывается, пока опрос источников ещё идёт, что переход между тайтлами
перерисовывает страницу, что серия открывает плеер — и что за весь прогон в
консоль не улетело ни одного исключения.

Иконка приложения собирается из логотипа одной командой — он обрезается
по содержимому, центрируется с полями и раскладывается во все размеры
для macOS и Windows:

```bash
python scripts/make_icon.py --source assets/logo.png --keep --generate
```

Rust-ядро вынесено в отдельный крейт от Tauri-оболочки намеренно: оболочке
нужны системные библиотеки вебвью, ядру — нет, поэтому тесты и линт гоняются
где угодно, включая голый CI-контейнер.

## ограничения

- **парсеры ломаются.** Сайты меняют разметку, anicli-api догоняет в своём
  темпе. Когда источник падает, приложение называет его и предлагает другой,
  а не делает вид, что ничего не произошло.
- **AnimeGO, Kodik и Aniboom хотят IP СНГ.** AniLibria и AnimeLib — нет,
  поэтому по умолчанию стоит AnimeLib.
- **хендлы не переживают перезапуск.** Приложение перерешает тайтл поиском —
  это быстро, но на каталоге с почти-дубликатами может попасть не туда.
- **замер качества стоит времени.** Опрос всех источников занимает несколько
  секунд; страница показывает описание сразу, а строка «где смотреть»
  дозаполняется по мере ответов.
- **лента на главной — это не источник.** Четыре ряда из пяти описывают, что
  существует, по данным Shikimori, и только один — что реально может отдать
  выбранный источник. Ряд может предложить тайтл, которого в источнике нет,
  и он об этом скажет при нажатии.
- **сборка весит много.** Бандленный ffmpeg — вся причина. См.
  [лицензии третьих сторон](./THIRD-PARTY.md): macOS-сборка под GPL,
  Windows — под LGPL.
- **сайдкар на python.** PyInstaller добавляет к бандлу около 17 МБ. Портировать
  девять экстракторов на Rust ради этого не стоило.
- **сборки не подписаны.** См. установку.
- **это не библиотека.** Приложение проигрывает то, что публичные источники
  и так отдают; оно ничего не хостит и ничего не расшифровывает.

## стек

Rust, Tauri 2, SolidJS, Python, hls.js, SQLite, ffmpeg, иконки [Lucide](https://lucide.dev),
метаданные [Shikimori](https://shikimori.one), обложки [AniList](https://anilist.co).

Solid, а не React, потому что каталог — это длинная лента картинок, и
точечные обновления выигрывают у мемоизации дерева. hls.js грузится по
требованию: приложение стартует на 74 КБ JavaScript и подтягивает остальные
523 КБ при первом нажатии на «смотреть».

Построено на [anicli-api](https://github.com/vypivshiy/anicli-api) от vypivshiy,
который делает настоящую работу — превращает тайтл в ссылку.

---

<div align="center">

# anilume — english

</div>

Every russian anime site solves playback the same way: drop a kodik or alloha
iframe on the page and let it own the experience. that is why they all feel
identical, and why none of them can resume you at 14:32 of episode 7, remember
which dub you picked, or hand you the file.

anilume takes the other path. [anicli-api](https://github.com/vypivshiy/anicli-api)
resolves a title down to a direct m3u8 or mp4, and everything above that line
is ours — the scrubber, the dub picker, the quality switch that keeps your
position, the progress that survives a restart.

open source, mit, no ads, no account, no telemetry.

## install

builds are in [releases](https://github.com/mekkadev/anilume/releases): a `.dmg`
for apple silicon, an `.msi` or `-setup.exe` for windows x64, and a portable zip
for each.

the portable builds launch through `anilume-portable.cmd`
(`anilume-portable.command` on macos) and point `ANILUME_DATA_DIR` and
`ANILUME_DOWNLOADS_DIR` at folders next to the app, so nothing is written
outside the folder you unpacked. both variables work in the installed builds too.

neither build is signed — apple notarisation costs $99 a year and nobody is
paying it, so macos will object to the first launch. no terminal is needed to
get past it: launch the app, let it be refused, then open system settings →
privacy & security, scroll to the line about the blocked app and press "open
anyway". once per version. on macos 14 and earlier, right-click → open → open
does the same thing faster.

there is also a way to never see the warning: quarantine is attached by the
browser that downloaded the file, so downloading outside a browser leaves
nothing to attach.

```bash
curl -L -o ~/Downloads/anilume.dmg \
  https://github.com/mekkadev/anilume/releases/latest/download/anilume_0.3.2_aarch64.dmg
open ~/Downloads/anilume.dmg
```

and if it is already downloaded, one command clears the flag:

```bash
xattr -dr com.apple.quarantine /Applications/anilume.app
```

on windows, smartscreen wants "more info" → "run anyway", and the build needs
microsoft edge webview2, which ships with windows 10 21h2 and later.

## what the player does

resume at the second you left off, dub switching without losing your position,
quality switching that keeps it too, speeds from 0.25× to 3×, picture-in-picture,
fullscreen, opening and ending skipped where [aniskip](https://api.aniskip.com)
knows the timings, and a next-episode countdown fifteen seconds out with a way
to say no.

subtitles come from three places: the ones baked into an hls stream, the ones a
source hands over as a separate track, and a `.srt` or `.vtt` file you open
yourself from the tracks menu. srt is converted to vtt in the app; ass is not
supported, and the menu says so rather than failing silently.

audio tracks work the same way — an hls stream with several of them switches
inside the player, and where a source ships each dub as a separate stream
instead (animelib, kodik), the dub picker does the same job in one click.

decoding is the webview's: videotoolbox on macos, media foundation on windows,
both hardware-accelerated for h.264 and hevc with nothing to configure. that
also fixes the format list — mp4 everywhere, webm on both, mkv on neither. no
source serves mkv and downloads are remuxed to mp4, so this has not come up in
practice, but it is a real limit rather than a missing feature.

## the catalogue

search by name is what a source can do. search by genre, year, studio and status
is what none of them can — the animelib api takes genres, types and a year range
but has no studio filter at all, and the anicli-api sources expose a search box
and nothing else.

so the catalogue page asks [shikimori](https://shikimori.one) instead: 46 genres,
1910 studios, a year range, airing status, type, and five sort orders, all from
its public api with no account needed. picking a title opens it by name; where to
watch it is decided on its own page.

the same connection feeds the home rows, the studio and runtime on a title page,
its seasons, what else is like it, and the discussion under it. a title opened
from a source is matched back to shikimori by name and year when the source did
not hand over an id. requests are paced to one every 240ms and eighty a minute —
shikimori limits both, and a gap between requests alone is not enough — and a
dropped connection or a 429 is retried three times with a growing delay.

## where the art comes from

shikimori posters are 225×350. that is fine in a list, not on a retina grid card,
and hopeless as a hero image — a stretched poster looks like 240p because it is.

so covers come from [anilist](https://anilist.co): `extraLarge` is 460×636, twice
the size on each side. matching is by myanimelist id, and for anime the shikimori
and mal ids are the same, so no intermediate search is needed. one request covers
fifty titles, answers are cached on disk for a month, and requests are spaced
800ms apart.

the wide art behind the home hero and the title page header is a shikimori
screenshot (1920×1080), or an anilist banner (1900×400) when there is none. with
neither, the poster is shown blurred rather than stretched — better to admit
there is no big image than to pass mush off as one.

## the catalogue cache

everything shikimori and anilist return is stored in sqlite next to the watch
database. rows live for an hour, title descriptions for a day, related and
similar for a week, cover art for a month. while an entry is fresh the app does
not go online at all: the home screen paints instantly on launch and shikimori's
limits (5 requests a second, 90 a minute) are not wasted.

when an entry goes stale the app fetches a new one — and if the catalogue does
not answer, it serves the old one instead of an empty screen. your isp blocks
shikimori, the mirrors are down, there is no internet at all: yesterday's rows
and descriptions are still there. the cache size and a clear button sit in
settings.

## the interface

one window, no chrome. a floating glass rail on the left holds the six places
you can be; everything else is content. behind it sits an ambient layer that
takes the key art of whatever you are looking at, blurs it to 72px and
desaturates it under a veil — the window is tinted by the thing on screen
rather than by a theme.

the home screen is a hero carousel over key art plus rows: popular, new, airing
now, top rated, for you. four of those come from shikimori; "airing now" comes
from the source you picked, because that is the row you can actually press play
on. "for you" is anchored on the last thing you watched and says so in the
header rather than pretending to be a model.

the title page carries the poster, the score, the studio, the runtime, the
genres, the episode list, the seasons and side-stories, what else is like it,
and the shikimori discussion under it. bbcode is stripped to plain text on the
rust side and spoiler blocks are dropped with their contents, so nothing renders
as markup and nothing arrives as html.

light and dark both work. the accent follows the system accent colour on macos.

## why the player is ours

a kodik segment url returns 403 unless the request carries the right `Referer`.
hls.js runs on `fetch`, and `Referer` is a forbidden header — the browser will
not let you set it. that is the whole reason a naive "just play the m3u8" build
does not work.

so playback goes through a local proxy on the loopback interface. it attaches
the headers anicli-api handed us, and rewrites the playlist so nested links come
back through it too:

```
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"     →  URI="http://127.0.0.1:PORT/s/<session>/<b64>"
parts/seg-1.ts                              →  http://127.0.0.1:PORT/s/<session>/<b64>
```

relative paths resolve against the playlist url before rewriting, or variant
playlists would end up pointing at localhost. encryption keys, init maps and
alternate audio tracks hide their url inside a `URI="…"` attribute, so those are
rewritten in place with the rest of the tag left alone. range requests pass
through, because seeking depends on them. the target url is base64 in the path
and anything that is not http or https is refused, so the proxy cannot be talked
into reading local files.

sessions are uuids and die when the player closes. a stale link returns `410`,
not video.

## sources

ten catalogues. nine come from anicli-api; animelib is talked to directly. you
never pick a source up front: opening a title searches all ten at once, measures
what quality each one actually serves, and selects the best. the rest sit next to
it in a "where to watch" row with the real resolution and dub count, one click to
switch, remembered per title.

| source | note |
| --- | --- |
| animelib | ten-plus dub teams per episode, full-size covers, and its own player up to 2160p — the 4k tier needs your account token. the default |
| anilibria | works without a vpn, own dub, official rest api |
| animego | biggest catalogue, most dubs, kodik and aniboom — needs a cis ip |
| yummy anime | rich metadata, and the only one that hands over a `shikimori_id` |
| animevost | direct mp4, so downloads are fast |
| anilib, sameband, dreamcast, hdrezka | smaller, or not anime-only |

the measurement is not a declared ceiling but the real one: in a single call the
sidecar walks every source that has the title, in parallel, taking the first
episode, the first dub and the highest quality it actually returns. a source that
died or served nothing is labelled as such rather than silently dropped.

the search page runs against one source by default and against all nine on
request, concurrently. a source that fails does not take the page down with it —
it comes back in a separate list, and geo-blocked ones say so.

anicli-api objects are a stateful chain: episodes come off a live `Anime` object,
which comes off a live `Search` object, and none of it is addressable by id. so
the python sidecar keeps those objects in an lru and hands out string handles.
when a handle is evicted you get `-32001` and the app quietly re-resolves the
title by search. that is also why watch history and library store the source url
rather than a handle — it is the only identifier that survives a restart.

## the animelib token

animelib answers anonymously with kodik links only. with your account token the
same episode also returns animelib's own player — direct mp4, up to 2160p, no
iframe.

the token lives in your browser on v5.animelib.org: sign in, open any episode,
devtools, network tab, the request to hapi.hentaicdn.org that looks like
`/api/episodes/…` — the GET row, not the OPTIONS one: a preflight carries no
headers, it only announces that `Authorization` will be sent. take the
`Authorization` header minus the word `Bearer` and paste it into settings — or
skip the digging: right-click the request, "copy as cURL", paste the whole thing
and the app will pull the token out of it. the account is free. if you cannot
find it, there is a [step-by-step guide](./docs/animelib-token.md) with a console
snippet that digs it out for you. it is stored in the local sqlite database on
your machine and sent to animelib and nowhere else. the app works without it.

three cdn servers are published; they do not all answer at any given moment, so
the server picker sits in settings next to the token.

## shikimori

list sync is optional, and it needs your own oauth app — there is no shared
client id to leak or get rate-limited. register one at
[shikimori.one/oauth/applications](https://shikimori.one/oauth/applications),
paste the client id and secret into settings, and pick how the code comes back:
a loopback redirect to `http://127.0.0.1:53682/`, or `oob` and copy it by hand.

tokens refresh on their own and requests are paced. changing a title's status in
the library pushes it upstream when the source gave us a shikimori id. the
catalogue, descriptions, seasons and comments need no authorisation at all —
that is the public half of the api.

## downloads

ffmpeg is bundled, so downloads work out of the box. it remuxes the stream to
mp4 without re-encoding, so a 24-minute episode takes about as long as the bytes
take to arrive. progress comes from parsing ffmpeg's own output, two at a time,
cancellable. `ANILUME_FFMPEG` overrides the bundled binary.

that convenience is most of the download size: the app itself is around 20 mb
and ffmpeg is 50-110 mb on top. the builds are pinned by sha256 and ci refuses
to package one until it has actually remuxed a test stream on that runner — a
static build that segfaults on mpeg-ts is a real thing, and it happened while
wiring this up.

files land in `~/Videos/anilume/<title>/<title> - 03 серия [dub] [1080p].mp4`.

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
pytest                          # 55, sidecar, no network
cargo test -p anilume-core      # 104, includes a real proxy round-trip
npm run typecheck
npm run test:ui                 # 9, the interface end to end in a browser
python scripts/design_lint.py
```

the end-to-end tests serve the built interface to headless chromium with the
tauri bridge replaced: every backend call answers with fixed data, and chosen
calls can be stalled on purpose. that is how we check that the anime page opens
while the sources are still being polled, that moving between titles repaints
the page, that an episode opens the player — and that not a single exception
reached the console during the whole run.

the rust core is a separate crate from the tauri shell on purpose: the shell
needs webview system libraries, the core does not, so tests and lint run
anywhere including a bare ci container.

## limits

- **parsers break.** sites change their markup and anicli-api catches up on its
  own schedule. when a source fails, the app names it and suggests another
  rather than pretending nothing happened.
- **animego, kodik and aniboom want a cis ip.** anilibria and animelib do not,
  which is why animelib is the default.
- **handles do not survive a restart.** the app re-resolves by title search,
  which is fast but can land on the wrong entry if a catalogue has
  near-duplicates.
- **the home feed is not the source.** four of its five rows describe what
  exists, from shikimori; only one describes what the selected source can
  actually play.
- **the download is large.** bundling ffmpeg is the whole reason. see
  [third-party licenses](./THIRD-PARTY.md) — the macos build is gpl, the windows
  one lgpl.
- **the sidecar is python.** pyinstaller adds about 17 mb to the bundle.
- **neither build is signed.** see install.
- **not a library.** it plays what public sources already serve; it hosts and
  decrypts nothing.

## stack

rust, tauri 2, solidjs, python, hls.js, sqlite, ffmpeg, [lucide](https://lucide.dev) icons,
[shikimori](https://shikimori.one) metadata, [anilist](https://anilist.co) artwork.

solid rather than react because the catalogue is a long scroll of images and
fine-grained updates beat memoising a tree into behaving. hls.js loads on demand
— the app starts on 74 kb of javascript and pulls the other 523 kb the first
time you press play.

built on [anicli-api](https://github.com/vypivshiy/anicli-api) by vypivshiy,
which does the actual work of turning a title into a url.

mit

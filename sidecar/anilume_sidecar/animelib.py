from __future__ import annotations

import urllib.parse
from typing import Any

import httpx

from . import settings

API = "https://hapi.hentaicdn.org/api"
SITE_ORIGIN = "https://v5.animelib.org"
SITE_ID = "5"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:153.0) "
    "Gecko/20100101 Firefox/153.0"
)

DEFAULT_SERVER = "main"
FALLBACK_SERVERS = (
    ("main", "https://video1.cdnlibs.org/.аs/"),
    ("secondary_1", "https://video2.anilib.me/.аs/"),
    ("secondary_2", "https://video3.anilib.me/.аs/"),
)

SEARCH_LIMIT = 30
PROBE_TIMEOUT = 6.0
DETAIL_FIELDS = (
    "background",
    "eng_name",
    "otherNames",
    "summary",
    "releaseDate",
    "type_id",
    "caution",
    "views",
    "rate_avg",
    "rate",
    "genres",
    "tags",
    "teams",
    "franchise",
    "authors",
    "publisher",
    "anime_status_id",
    "time",
    "episodes_count",
    "shiki_rate",
)

def _headers(token: str | None) -> dict[str, str]:
    headers = {
        "Site-Id": SITE_ID,
        "Referer": f"{SITE_ORIGIN}/",
        "Origin": SITE_ORIGIN,
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Client-Time-Zone": "Europe/Moscow",
    }
    if token:
        headers["Authorization"] = f"Bearer {token.strip()}"
    return headers

def _token() -> str | None:
    value = settings.get("animelib", "token")
    return value.strip() if isinstance(value, str) and value.strip() else None

def _server_bases() -> list[tuple[str, str]]:
    chosen = settings.get("animelib", "server") or DEFAULT_SERVER
    known = dict(settings.get("animelib", "servers") or {}) or dict(FALLBACK_SERVERS)

    ordered = []
    if chosen in known:
        ordered.append((chosen, known[chosen]))
    ordered.extend((key, url) for key, url in known.items() if key != chosen)
    return ordered

def video_url(base: str, href: str) -> str:
    joined = base.rstrip("/") + "/" + href.lstrip("/")
    return urllib.parse.quote(joined, safe=":/?&=%.-_~")

def _cover(payload: dict[str, Any]) -> str | None:
    cover = payload.get("cover")
    if not isinstance(cover, dict):
        return None
    for key in ("default", "md", "thumbnail"):
        value = cover.get(key)
        if isinstance(value, str) and value:
            return value
    return None

def _text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()

    if isinstance(value, list):
        parts = [_text(item) for item in value]
        return " ".join(part for part in parts if part)

    if not isinstance(value, dict):
        return ""

    if isinstance(value.get("text"), str):
        return value["text"]

    if "content" in value:
        node = value.get("type")
        inner = _text(value["content"])
        return f"{inner}\n\n" if node == "paragraph" else inner

    for key in ("ru", "value", "content", "en"):
        nested = value.get(key)
        if isinstance(nested, str) and nested.strip():
            return nested.strip()
    return ""

RECAP_MARKS = ("рекап", "recap", "обзор за", "in minutes", " pv", "промо", "трейлер")

def _names(payload: dict[str, Any]) -> list[str]:
    found = []
    for key in ("rus_name", "name", "eng_name"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            found.append(value.strip().lower())
    return found

def relevance(payload: dict[str, Any], query: str) -> tuple[int, int, float]:
    needle = query.strip().lower()
    names = _names(payload)

    if any(name == needle for name in names):
        rank = 0
    elif any(name.startswith(needle) for name in names):
        rank = 1
    elif any(needle in name for name in names):
        rank = 2
    else:
        rank = 3

    if any(mark in name for name in names for mark in RECAP_MARKS):
        rank += 4

    rating = payload.get("rating")
    votes = 0
    if isinstance(rating, dict):
        try:
            votes = int(rating.get("votes") or 0)
        except (TypeError, ValueError):
            votes = 0

    try:
        score = float(payload.get("shiki_rate") or 0)
    except (TypeError, ValueError):
        score = 0.0

    return (rank, -votes, -score)

def _title(payload: dict[str, Any]) -> str:
    for key in ("rus_name", "name", "eng_name"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "Без названия"

class Video:
    __slots__ = ("type", "quality", "url", "headers")

    def __init__(self, type: str, quality: int, url: str, headers: dict[str, str]):
        self.type = type
        self.quality = quality
        self.url = url
        self.headers = headers

class Source:
    def __init__(self, client: "Client", player: dict[str, Any]) -> None:
        self._client = client
        self._player = player

        team = player.get("team") or {}
        team_name = team.get("name") if isinstance(team, dict) else None
        translation = (player.get("translation_type") or {}).get("label")
        backend = player.get("player") or "?"

        parts = [team_name or "Без команды"]
        if translation:
            parts.append(translation.lower())
        self.title = " · ".join(parts)
        self.player = backend

        src = player.get("src") or ""
        if src.startswith("//"):
            src = "https:" + src
        self.url = src or f"{SITE_ORIGIN}/ru/anime"

    async def a_get_videos(self, **_: Any) -> list[Video]:
        native = self._player.get("video")
        if isinstance(native, dict) and native.get("quality"):
            return await self._client.native_videos(native)
        return await self._client.kodik_videos(self.url)

class Episode:
    def __init__(self, client: "Client", payload: dict[str, Any]) -> None:
        self._client = client
        self._payload = payload
        self.id = payload.get("id")

        number = payload.get("number") or payload.get("item_number") or 0
        try:
            self.ordinal = int(float(number))
        except (TypeError, ValueError):
            self.ordinal = 0

        name = (payload.get("name") or "").strip()
        season = payload.get("season")
        label = f"Серия {self.ordinal}"
        if season and str(season) not in ("1", "0", "None"):
            label = f"Сезон {season}, {label.lower()}"
        self.title = f"{label}. {name}" if name else label

    async def a_get_sources(self) -> list[Source]:
        return await self._client.sources(self.id)

class Anime:
    def __init__(self, client: "Client", payload: dict[str, Any]) -> None:
        self._client = client
        self.data = payload
        self.title = _title(payload)
        self.thumbnail = _cover(payload)
        self.description = _text(payload.get("summary"))
        self.slug = payload.get("slug_url") or payload.get("slug")

    async def a_get_episodes(self) -> list[Episode]:
        return await self._client.episodes(self.data.get("id"))

class Card:
    def __init__(self, client: "Client", payload: dict[str, Any]) -> None:
        self._client = client
        self.data = payload
        self.title = _title(payload)
        self.thumbnail = _cover(payload)
        self.slug = payload.get("slug_url") or payload.get("slug")
        self.url = f"{SITE_ORIGIN}/ru/anime/{self.slug}"

    async def a_get_anime(self) -> Anime:
        return await self._client.anime(self.slug)

class Client:
    def __init__(self) -> None:
        self._servers: dict[str, str] | None = None

    async def _request(self, path: str, params: Any = None) -> Any:
        async with httpx.AsyncClient(timeout=25, follow_redirects=True) as http:
            response = await http.get(
                f"{API}{path}", params=params, headers=_headers(_token())
            )
            response.raise_for_status()
            return response.json().get("data")

    async def servers(self) -> dict[str, str]:
        if self._servers is not None:
            return self._servers

        try:
            data = await self._request("/constants", {"fields[]": "videoServers"})
            found = {
                entry["id"]: entry["url"]
                for entry in (data or {}).get("videoServers", [])
                if entry.get("id") and entry.get("url")
            }
        except Exception:
            found = {}

        self._servers = found or dict(FALLBACK_SERVERS)
        settings.set_section(
            "animelib",
            {**settings.section("animelib"), "servers": self._servers},
        )
        return self._servers

    async def search(self, query: str) -> list[Card]:
        data = await self._request("/anime", {"q": query, "limit": SEARCH_LIMIT})
        ranked = sorted(data or [], key=lambda item: relevance(item, query))
        return [Card(self, item) for item in ranked]

    async def ongoing(self) -> list[Card]:
        data = await self._request(
            "/anime", {"limit": SEARCH_LIMIT, "sort_by": "last_episode_at"}
        )
        return [Card(self, item) for item in (data or [])]

    async def anime(self, slug: str) -> Anime:
        data = await self._request(
            f"/anime/{slug}", [("fields[]", field) for field in DETAIL_FIELDS]
        )
        return Anime(self, data or {})

    async def episodes(self, anime_id: Any) -> list[Episode]:
        data = await self._request("/episodes", {"anime_id": anime_id})
        episodes = [Episode(self, item) for item in (data or [])]
        episodes.sort(key=lambda item: item.ordinal)
        return episodes

    async def sources(self, episode_id: Any) -> list[Source]:
        data = await self._request(f"/episodes/{episode_id}")
        players = (data or {}).get("players") or []

        sources = [Source(self, player) for player in players]
        sources.sort(key=lambda item: 0 if item.player == "Animelib" else 1)
        return sources

    async def native_videos(self, video: dict[str, Any]) -> list[Video]:
        servers = await self.servers()
        settings.set_section(
            "animelib", {**settings.section("animelib"), "servers": servers}
        )

        bases = [url for _, url in _server_bases() if url]
        if not bases:
            bases = [url for _, url in FALLBACK_SERVERS]

        headers = {"Referer": f"{SITE_ORIGIN}/", "User-Agent": USER_AGENT}
        entries = [
            (int(entry["quality"]), entry["href"])
            for entry in (video.get("quality") or [])
            if entry.get("href") and entry.get("quality")
        ]
        if not entries:
            return []

        entries.sort(reverse=True)
        base = await self._working_base(bases, entries[0][1])

        return [
            Video("mp4", quality, video_url(base, href), headers)
            for quality, href in entries
        ]

    async def _working_base(self, bases: list[str], href: str) -> str:
        headers = {"Referer": f"{SITE_ORIGIN}/", "User-Agent": USER_AGENT}
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT, follow_redirects=True) as http:
            for base in bases:
                url = video_url(base, href)
                try:
                    response = await http.get(
                        url, headers={**headers, "Range": "bytes=0-1"}
                    )
                except Exception:
                    continue
                if response.status_code < 400:
                    return base
        return bases[0]

    async def kodik_videos(self, url: str) -> list[Video]:
        from anicli_api.player.kodik import Kodik

        raw = await Kodik().a_parse(url)
        return [
            Video(item.type, int(item.quality), item.url, dict(item.headers or {}))
            for item in raw
        ]

class Extractor:
    def __init__(self, *_: Any, **__: Any) -> None:
        self._client = Client()

    async def a_search(self, query: str) -> list[Card]:
        return await self._client.search(query)

    async def a_ongoing(self) -> list[Card]:
        return await self._client.ongoing()

    def search(self, query: str) -> list[Card]:
        raise NotImplementedError("Источник работает только асинхронно")

    def ongoing(self) -> list[Card]:
        raise NotImplementedError("Источник работает только асинхронно")

from __future__ import annotations

import asyncio
import logging
from typing import Any

from . import __version__, dto, settings
from .handles import HandleRegistry
from .protocol import (
    INVALID_PARAMS,
    SOURCE_UNAVAILABLE,
    UPSTREAM_ERROR,
    RpcError,
)
from .sources import DEFAULT_SOURCE, SOURCES, SOURCES_BY_KEY, ExtractorPool

log = logging.getLogger("anilume.service")

UPSTREAM_TIMEOUT = 30.0

def _require(params: dict[str, Any], name: str) -> Any:
    value = params.get(name)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise RpcError(INVALID_PARAMS, f"Не передан обязательный параметр «{name}»")
    return value

async def _call(source_key: str, what: str, coro: Any) -> Any:
    info = SOURCES_BY_KEY.get(source_key)
    name = info.name if info else source_key
    try:
        return await asyncio.wait_for(coro, timeout=UPSTREAM_TIMEOUT)
    except asyncio.TimeoutError as exc:
        raise RpcError(
            UPSTREAM_ERROR,
            f"«{name}» не ответил вовремя",
            {"source": source_key, "op": what},
        ) from exc
    except RpcError:
        raise
    except Exception as exc:
        log.warning("source=%s op=%s failed: %r", source_key, what, exc)
        hint = None
        if info and info.geo_restricted:
            hint = "Источник отдаёт контент только с IP СНГ — попробуйте VPN или другой источник"
        raise RpcError(
            SOURCE_UNAVAILABLE,
            f"«{name}» не отдал данные",
            {"source": source_key, "op": what, "reason": str(exc), "hint": hint},
        ) from exc

class AnilumeService:
    def __init__(self, registry: HandleRegistry | None = None) -> None:
        self.handles = registry or HandleRegistry()
        self.pool = ExtractorPool()

    async def ping(self, _: dict[str, Any]) -> dict[str, Any]:
        return {
            "ok": True,
            "version": __version__,
            "handles": len(self.handles),
            "defaultSource": DEFAULT_SOURCE,
        }

    async def config_set(self, params: dict[str, Any]) -> dict[str, Any]:
        section = str(_require(params, "section"))
        values = params.get("values")
        if not isinstance(values, dict):
            raise RpcError(INVALID_PARAMS, "Параметр «values» должен быть объектом")

        merged = {**settings.section(section), **values}
        settings.set_section(section, merged)
        self.pool.reset(section)
        return {"section": section, "keys": sorted(merged)}

    async def sources_list(self, _: dict[str, Any]) -> dict[str, Any]:
        return {"sources": [s.to_json() for s in SOURCES], "default": DEFAULT_SOURCE}

    async def animelib_servers(self, _: dict[str, Any]) -> dict[str, Any]:
        extractor = self.pool.get("animelib")
        servers = await _call("animelib", "servers", extractor._client.servers())
        return {
            "servers": [{"id": key, "url": url} for key, url in servers.items()],
            "selected": settings.get("animelib", "server") or "main",
            "hasToken": bool(settings.get("animelib", "token")),
        }

    async def catalog_ongoing(self, params: dict[str, Any]) -> dict[str, Any]:
        source_key = params.get("source") or DEFAULT_SOURCE
        extractor = self.pool.get(source_key)
        items = await _call(source_key, "ongoing", extractor.a_ongoing())
        return {"items": self._cards(items, "ongoing", source_key)}

    async def catalog_search(self, params: dict[str, Any]) -> dict[str, Any]:
        source_key = params.get("source") or DEFAULT_SOURCE
        query = str(_require(params, "query")).strip()
        extractor = self.pool.get(source_key)
        items = await _call(source_key, "search", extractor.a_search(query))
        return {"items": self._cards(items, "search", source_key), "query": query}

    async def catalog_search_multi(self, params: dict[str, Any]) -> dict[str, Any]:
        query = str(_require(params, "query")).strip()
        requested = params.get("sources") or [DEFAULT_SOURCE]
        if not isinstance(requested, list):
            raise RpcError(INVALID_PARAMS, "Параметр «sources» должен быть списком")

        async def one(source_key: str) -> tuple[str, Any]:
            try:
                extractor = self.pool.get(source_key)
                items = await _call(source_key, "search", extractor.a_search(query))
                return source_key, self._cards(items, "search", source_key)
            except RpcError as exc:
                return source_key, exc

        results = await asyncio.gather(*(one(str(s)) for s in requested))

        groups: list[dict[str, Any]] = []
        failures: list[dict[str, Any]] = []
        for source_key, outcome in results:
            if isinstance(outcome, RpcError):
                failures.append({"source": source_key, "error": outcome.to_json()})
            else:
                groups.append({"source": source_key, "items": outcome})
        return {"query": query, "groups": groups, "failures": failures}

    async def anime_get(self, params: dict[str, Any]) -> dict[str, Any]:
        handle = str(_require(params, "handle"))
        entry = self.handles.get(handle)
        if entry.kind not in ("search", "ongoing"):
            raise RpcError(INVALID_PARAMS, "Ожидался хендл карточки каталога")

        anime = await _call(entry.source_key, "anime", entry.obj.a_get_anime())
        anime_handle = self.handles.put("anime", entry.source_key, anime)
        key = getattr(entry.obj, "url", "") or ""
        detail = dto.anime_detail(anime, anime_handle, entry.source_key, key)

        episodes = await _call(entry.source_key, "episodes", anime.a_get_episodes())
        detail["episodes"] = [
            dto.episode(ep, self.handles.put("episode", entry.source_key, ep))
            for ep in episodes
        ]
        return detail

    async def anime_episodes(self, params: dict[str, Any]) -> dict[str, Any]:
        handle = str(_require(params, "handle"))
        entry = self.handles.get(handle, "anime")
        episodes = await _call(entry.source_key, "episodes", entry.obj.a_get_episodes())
        return {
            "episodes": [
                dto.episode(ep, self.handles.put("episode", entry.source_key, ep))
                for ep in episodes
            ]
        }

    async def episode_studios(self, params: dict[str, Any]) -> dict[str, Any]:
        handle = str(_require(params, "handle"))
        entry = self.handles.get(handle, "episode")
        studios = await _call(entry.source_key, "sources", entry.obj.a_get_sources())
        return {
            "studios": [
                dto.studio(s, self.handles.put("source", entry.source_key, s))
                for s in studios
            ]
        }

    async def studio_videos(self, params: dict[str, Any]) -> dict[str, Any]:
        handle = str(_require(params, "handle"))
        entry = self.handles.get(handle, "source")
        videos = await _call(entry.source_key, "videos", entry.obj.a_get_videos())
        items = [dto.video(v) for v in videos]

        items.sort(key=lambda v: v["quality"], reverse=True)
        return {"videos": items}

    def _cards(self, items: Any, kind: str, source_key: str) -> list[dict[str, Any]]:
        return [
            dto.card(item, self.handles.put(kind, source_key, item), source_key)
            for item in items
        ]

    def dispatch_table(self) -> dict[str, Any]:
        return {
            "ping": self.ping,
            "sources.list": self.sources_list,
            "config.set": self.config_set,
            "animelib.servers": self.animelib_servers,
            "catalog.ongoing": self.catalog_ongoing,
            "catalog.search": self.catalog_search,
            "catalog.searchMulti": self.catalog_search_multi,
            "anime.get": self.anime_get,
            "anime.episodes": self.anime_episodes,
            "episode.studios": self.episode_studios,
            "studio.videos": self.studio_videos,
        }

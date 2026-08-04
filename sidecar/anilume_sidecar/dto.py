from __future__ import annotations

from typing import Any, Callable
from urllib.parse import urlsplit

def _dig(obj: Any, *path: str) -> Any:
    current = obj
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
        if current is None:
            return None
    return current

def _as_int(value: Any) -> int | None:
    try:
        if value is None or isinstance(value, bool):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None

def _as_float(value: Any) -> float | None:
    try:
        if value is None or isinstance(value, bool):
            return None
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None

def _year_from_date(value: Any) -> int | None:
    if not isinstance(value, str) or len(value) < 4:
        return None
    return _as_int(value[:4])

def _names(items: Any, *keys: str) -> list[str]:
    if not isinstance(items, list):
        return []
    result: list[str] = []
    for item in items:
        if isinstance(item, str):
            result.append(item)
            continue
        for key in keys:
            value = _dig(item, key)
            if isinstance(value, str) and value:
                result.append(value)
                break
    return result

def _raw_of(obj: Any) -> Any:
    for attr in ("raw_json", "data"):
        value = getattr(obj, attr, None)
        if value is not None:
            return value
    return None

def empty_meta() -> dict[str, Any]:
    return {
        "year": None,
        "genres": [],
        "score": None,
        "episodesTotal": None,
        "kind": None,
        "ageRating": None,
        "status": None,
        "altTitle": None,
        "shikimoriId": None,
        "episodeDurationMin": None,
        "tags": [],
    }

def _meta_animego(raw: Any) -> dict[str, Any]:
    meta = empty_meta()
    if not isinstance(raw, dict):
        return meta
    meta["year"] = _year_from_date(raw.get("datePublished"))
    meta["genres"] = _names(raw.get("genre"), "name")
    meta["score"] = _as_float(_dig(raw, "aggregateRating", "ratingValue"))
    meta["episodesTotal"] = _as_int(raw.get("numberOfEpisodes"))
    meta["ageRating"] = raw.get("contentRating") or None
    meta["altTitle"] = raw.get("alternateName") or None
    return meta

def _meta_anilibria(raw: Any) -> dict[str, Any]:
    meta = empty_meta()
    if not isinstance(raw, dict):
        return meta
    meta["year"] = _as_int(raw.get("year"))
    meta["genres"] = _names(raw.get("genres"), "name")
    meta["episodesTotal"] = _as_int(raw.get("episodes_total"))
    meta["kind"] = _dig(raw, "type", "description") or _dig(raw, "type", "value")
    meta["ageRating"] = _dig(raw, "age_rating", "label")
    meta["altTitle"] = _dig(raw, "name", "english") or _dig(raw, "name", "alternative")
    meta["episodeDurationMin"] = _as_int(raw.get("average_duration_of_episode"))
    if raw.get("is_ongoing"):
        meta["status"] = "Онгоинг"
    elif raw.get("is_in_production"):
        meta["status"] = "В производстве"
    elif raw.get("episodes_total"):
        meta["status"] = "Вышел"
    return meta

def _meta_yummy(raw: Any) -> dict[str, Any]:
    meta = empty_meta()
    if not isinstance(raw, dict):
        return meta
    meta["year"] = _as_int(raw.get("year"))
    meta["genres"] = _names(raw.get("genres"), "title", "name")
    meta["kind"] = _dig(raw, "type", "name")
    meta["status"] = _dig(raw, "anime_status", "title")
    meta["ageRating"] = _dig(raw, "min_age", "title")
    meta["shikimoriId"] = _as_int(_dig(raw, "remote_ids", "shikimori_id"))

    meta["score"] = _as_float(_dig(raw, "rating", "average")) or _as_float(
        _dig(raw, "rating", "shikimori_rating")
    )
    return meta

def _meta_animelib(raw: Any) -> dict[str, Any]:
    meta = empty_meta()
    if not isinstance(raw, dict):
        return meta

    meta["year"] = _year_from_date(raw.get("releaseDate")) or _as_int(
        raw.get("releaseDateString")
    )
    meta["genres"] = _names(raw.get("genres"), "name")
    meta["score"] = _as_float(raw.get("rate_avg")) or _as_float(raw.get("shiki_rate"))
    meta["episodesTotal"] = (
        _as_int(_dig(raw, "items_count", "total"))
        or _as_int(_dig(raw, "items_count", "uploaded"))
        or _as_int(raw.get("episodes_count"))
    )
    meta["tags"] = _names(raw.get("tags"), "name")[:12]
    meta["kind"] = _dig(raw, "type", "label")
    meta["status"] = _dig(raw, "status", "label")
    meta["ageRating"] = _dig(raw, "ageRestriction", "label")

    other = raw.get("otherNames")
    if isinstance(other, list) and other:
        first = other[0]
        meta["altTitle"] = first if isinstance(first, str) else None
    if not meta["altTitle"]:
        meta["altTitle"] = raw.get("eng_name") or raw.get("name")

    return meta

_META_EXTRACTORS: dict[str, Callable[[Any], dict[str, Any]]] = {
    "animego": _meta_animego,
    "animelib": _meta_animelib,
    "anilibria": _meta_anilibria,
    "yummy_anime": _meta_yummy,
    "yummy_anime_org": _meta_yummy,
}

def extract_meta(source_key: str, obj: Any) -> dict[str, Any]:
    extractor = _META_EXTRACTORS.get(source_key)
    if extractor is None:
        return empty_meta()
    try:
        return extractor(_raw_of(obj))
    except Exception:
        return empty_meta()

def _best_poster(source_key: str, obj: Any) -> str | None:
    raw = _raw_of(obj)
    if isinstance(raw, dict):
        if source_key.startswith("yummy"):
            for key in ("huge", "fullsize", "big", "medium"):
                value = _dig(raw, "poster", key)
                if isinstance(value, str) and value:
                    return value
        elif source_key == "anilibria":
            for key in ("src", "preview"):
                value = _dig(raw, "poster", key)
                if isinstance(value, str) and value:
                    return value
    thumbnail = getattr(obj, "thumbnail", None)
    return thumbnail or None

def card(obj: Any, handle: str, source_key: str) -> dict[str, Any]:
    episode = getattr(obj, "episode", None)
    dub = getattr(obj, "dub", None)
    return {
        "handle": handle,
        "source": source_key,
        "title": getattr(obj, "title", "") or "Без названия",
        "poster": _best_poster(source_key, obj),

        "key": getattr(obj, "url", "") or "",
        "episodeBadge": episode or None,
        "dubBadge": dub or None,
        "meta": extract_meta(source_key, obj),
    }

def anime_detail(obj: Any, handle: str, source_key: str, key: str) -> dict[str, Any]:
    return {
        "handle": handle,
        "source": source_key,
        "key": key,
        "title": getattr(obj, "title", "") or "Без названия",
        "poster": _best_poster(source_key, obj),
        "description": (getattr(obj, "description", "") or "").strip(),
        "meta": extract_meta(source_key, obj),
    }

def episode(obj: Any, handle: str) -> dict[str, Any]:
    ordinal = _as_int(getattr(obj, "ordinal", None))
    title = (getattr(obj, "title", "") or "").strip()
    return {
        "handle": handle,
        "ordinal": ordinal if ordinal is not None else 0,
        "title": title or (f"Серия {ordinal}" if ordinal is not None else "Серия"),
    }

def studio(obj: Any, handle: str) -> dict[str, Any]:
    url = getattr(obj, "url", "") or ""
    hostname = urlsplit(url).hostname or ""
    return {
        "handle": handle,
        "title": (getattr(obj, "title", "") or "").strip() or "Неизвестная озвучка",
        "player": hostname.removeprefix("www."),
        "url": url,
    }

def video(obj: Any) -> dict[str, Any]:
    headers = getattr(obj, "headers", None)
    return {
        "type": getattr(obj, "type", "m3u8"),
        "quality": _as_int(getattr(obj, "quality", None)) or 0,
        "url": getattr(obj, "url", ""),
        "headers": dict(headers) if isinstance(headers, dict) else {},
    }

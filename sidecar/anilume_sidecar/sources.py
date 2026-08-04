"""Реестр доступных источников аниме.

Каждый источник — модуль anicli-api с классом `Extractor`. Экстракторы
создаются лениво и переиспользуются: внутри они держат HTTP-клиент с
пулом соединений, пересоздавать их на каждый запрос дорого.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from importlib import import_module
from typing import Any

from .protocol import RpcError, SOURCE_UNAVAILABLE


@dataclass(frozen=True)
class SourceInfo:
    key: str
    module: str
    name: str
    description: str
    geo_restricted: bool = False
    """Источник или его плееры отдают контент только с IP СНГ."""

    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_json(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "description": self.description,
            "geoRestricted": self.geo_restricted,
            "notes": list(self.notes),
        }


SOURCES: tuple[SourceInfo, ...] = (
    SourceInfo(
        key="animego",
        module="anicli_api.source.animego",
        name="AnimeGO",
        description="Крупнейший каталог с множеством озвучек, плееры Kodik и Aniboom",
        geo_restricted=True,
        notes=("Требуется IP СНГ", "Больше всего вариантов озвучки"),
    ),
    SourceInfo(
        key="anilibria",
        module="anicli_api.source.anilibria",
        name="AniLibria",
        description="Собственная озвучка студии, официальный REST API, стабильные ссылки",
        notes=("Работает без VPN", "Только релизы студии"),
    ),
    SourceInfo(
        key="yummy_anime",
        module="anicli_api.source.yummy_anime",
        name="Yummy Anime",
        description="Богатые метаданные и связка с Shikimori по remote_ids",
        notes=("Отдаёт shikimori_id", "Много озвучек"),
    ),
    SourceInfo(
        key="yummy_anime_org",
        module="anicli_api.source.yummy_anime_org",
        name="Yummy Anime (зеркало)",
        description="Альтернативный домен Yummy Anime на случай блокировки основного",
    ),
    SourceInfo(
        key="animevost",
        module="anicli_api.source.animevost",
        name="AnimeVost",
        description="Классический каталог с собственной озвучкой и прямыми mp4",
        notes=("Прямые mp4 — быстро качается оффлайн",),
    ),
    SourceInfo(
        key="anilibme",
        module="anicli_api.source.anilibme",
        name="AniLib",
        description="Каталог AniLib с большим выбором озвучек и субтитров",
    ),
    SourceInfo(
        key="sameband",
        module="anicli_api.source.sameband",
        name="Sameband",
        description="Студия авторской озвучки, небольшой каталог",
    ),
    SourceInfo(
        key="dreamcast",
        module="anicli_api.source.dreamcast",
        name="Dreamcast",
        description="Студия Dreamerscast, собственная озвучка",
    ),
    SourceInfo(
        key="hdrezka",
        module="anicli_api.source.hdrezka",
        name="HDRezka",
        description="Не только аниме: пригодится для полнометражек и дорам",
        geo_restricted=True,
        notes=("Требуется IP СНГ", "Каталог шире, чем аниме"),
    ),
)

SOURCES_BY_KEY: dict[str, SourceInfo] = {s.key: s for s in SOURCES}

DEFAULT_SOURCE = "anilibria"
"""Источник по умолчанию: единственный, который стабильно работает без IP СНГ."""


class ExtractorPool:
    """Ленивый кеш экстракторов по ключу источника."""

    def __init__(self) -> None:
        self._cache: dict[str, Any] = {}

    def get(self, source_key: str) -> Any:
        if source_key in self._cache:
            return self._cache[source_key]

        info = SOURCES_BY_KEY.get(source_key)
        if info is None:
            raise RpcError(
                SOURCE_UNAVAILABLE,
                f"Неизвестный источник: {source_key}",
                {"known": sorted(SOURCES_BY_KEY)},
            )

        try:
            module = import_module(info.module)
            extractor = module.Extractor()
        except Exception as exc:  # noqa: BLE001 — превращаем в доменную ошибку
            raise RpcError(
                SOURCE_UNAVAILABLE,
                f"Не удалось загрузить источник «{info.name}»",
                {"source": source_key, "reason": str(exc)},
            ) from exc

        self._cache[source_key] = extractor
        return extractor

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from anilume_sidecar.service import AnilumeService

class FakeVideo:
    def __init__(self, quality: int, url: str, type_: str = "m3u8", headers=None):
        self.quality = quality
        self.url = url
        self.type = type_
        self.headers = headers or {}

class FakeSource:
    def __init__(self, title: str, url: str, videos=None, fail: bool = False):
        self.title = title
        self.url = url
        self._videos = videos or []
        self._fail = fail

    async def a_get_videos(self):
        if self._fail:
            raise RuntimeError("player is dead")
        return self._videos

class FakeEpisode:
    def __init__(self, ordinal: int, title: str, sources=None):
        self.ordinal = ordinal
        self.title = title
        self._sources = sources or []

    async def a_get_sources(self):
        return self._sources

class FakeAnime:
    def __init__(self, title, thumbnail, description, episodes=None, data=None):
        self.title = title
        self.thumbnail = thumbnail
        self.description = description
        self._episodes = episodes or []
        if data is not None:
            self.data = data

    async def a_get_episodes(self):
        return self._episodes

class FakeCard:
    def __init__(self, title, url, thumbnail="", anime=None, data=None, episode=None, dub=None):
        self.title = title
        self.url = url
        self.thumbnail = thumbnail
        self._anime = anime
        if data is not None:
            self.data = data
        if episode is not None:
            self.episode = episode
        if dub is not None:
            self.dub = dub

    async def a_get_anime(self):
        if self._anime is None:
            raise RuntimeError("layout changed")
        return self._anime

class FakeExtractor:
    def __init__(self, cards=None, ongoing=None, fail_search: bool = False):
        self._cards = cards or []
        self._ongoing = ongoing or []
        self._fail_search = fail_search

    async def a_search(self, query: str):
        if self._fail_search:
            raise RuntimeError("blocked by geo")
        return [c for c in self._cards if query.lower() in c.title.lower()]

    async def a_ongoing(self):
        return self._ongoing

ANILIBRIA_RAW = {
    "id": 9000,
    "year": 2023,
    "episodes_total": 12,
    "type": {"value": "TV", "description": "ТВ-сериал"},
    "age_rating": {"value": "R16_PLUS", "label": "16+"},
    "name": {"main": "Тестовый релиз", "english": "Test Release"},
    "genres": [{"id": 1, "name": "Экшен"}, {"id": 2, "name": "Фэнтези"}],
    "is_ongoing": True,
    "average_duration_of_episode": 24,
    "poster": {"src": "https://cdn.test/poster-big.jpg", "preview": "https://cdn.test/p.jpg"},
}

YUMMY_RAW = {
    "year": 2021,
    "genres": [{"title": "Комедия", "id": 3}],
    "type": {"name": "ТВ"},
    "anime_status": {"title": "Вышел"},
    "min_age": {"title": "12+"},
    "rating": {"average": 8.42, "shikimori_rating": 8.1},
    "remote_ids": {"shikimori_id": 54321},
    "poster": {"huge": "https://cdn.test/huge.jpg", "small": "https://cdn.test/small.jpg"},
}

ANIMEGO_RAW = {
    "datePublished": "2019-04-06",
    "genre": ["Драма", "Сёнэн"],
    "aggregateRating": {"ratingValue": 9.1, "ratingCount": 5000},
    "numberOfEpisodes": 25,
    "contentRating": "R-17",
    "alternateName": "Alternate Name",
}

@pytest.fixture
def service():
    return AnilumeService()

@pytest.fixture
def wire(service):
    def _wire(source_key: str, extractor):
        service.pool._cache[source_key] = extractor
        return extractor

    return _wire

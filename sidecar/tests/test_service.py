import pytest

from anilume_sidecar import settings

from anilume_sidecar.protocol import (
    HANDLE_EXPIRED,
    INVALID_PARAMS,
    SOURCE_UNAVAILABLE,
    RpcError,
)
from conftest import (
    ANILIBRIA_RAW,
    FakeAnime,
    FakeCard,
    FakeEpisode,
    FakeExtractor,
    FakeSource,
    FakeVideo,
)

def build_catalog():
    videos = [
        FakeVideo(480, "https://cdn/480.m3u8"),
        FakeVideo(1080, "https://cdn/1080.m3u8", headers={"Referer": "https://kodik.info/"}),
        FakeVideo(720, "https://cdn/720.m3u8"),
    ]
    studios = [
        FakeSource("AniLibria", "https://kodik.info/s/1", videos=videos),
        FakeSource("Студийная банда", "https://aniboom.one/s/2", videos=[]),
    ]
    episodes = [FakeEpisode(i, f"Серия {i}", sources=studios) for i in (1, 2, 3)]
    anime = FakeAnime("Атака титанов", "p.jpg", "  описание  ", episodes, data=ANILIBRIA_RAW)
    return FakeExtractor(cards=[FakeCard("Атака титанов", "https://site/a/1", anime=anime)])

async def test_sources_list_is_not_empty(service):
    result = await service.sources_list({})
    assert result["default"] in {s["key"] for s in result["sources"]}
    assert any(s["geoRestricted"] for s in result["sources"])

async def test_full_navigation_chain(service, wire):
    wire("anilibria", build_catalog())

    found = await service.catalog_search({"source": "anilibria", "query": "атака"})
    assert len(found["items"]) == 1
    card = found["items"][0]
    assert card["key"] == "https://site/a/1"

    detail = await service.anime_get({"handle": card["handle"]})
    assert detail["title"] == "Атака титанов"
    assert detail["description"] == "описание"
    assert detail["meta"]["year"] == 2023
    assert len(detail["episodes"]) == 3

    studios = await service.episode_studios({"handle": detail["episodes"][0]["handle"]})
    assert [s["title"] for s in studios["studios"]] == ["AniLibria", "Студийная банда"]
    assert studios["studios"][0]["player"] == "kodik.info"

    videos = await service.studio_videos({"handle": studios["studios"][0]["handle"]})
    assert [v["quality"] for v in videos["videos"]] == [1080, 720, 480]
    assert videos["videos"][0]["headers"] == {"Referer": "https://kodik.info/"}

async def test_anime_get_rejects_wrong_handle_kind(service, wire):
    wire("anilibria", build_catalog())
    found = await service.catalog_search({"source": "anilibria", "query": "атака"})
    detail = await service.anime_get({"handle": found["items"][0]["handle"]})

    with pytest.raises(RpcError) as exc:
        await service.anime_get({"handle": detail["episodes"][0]["handle"]})
    assert exc.value.code == INVALID_PARAMS

async def test_expired_handle_is_reported_clearly(service):
    with pytest.raises(RpcError) as exc:
        await service.anime_get({"handle": "search-404"})
    assert exc.value.code == HANDLE_EXPIRED

async def test_missing_required_param(service):
    with pytest.raises(RpcError) as exc:
        await service.catalog_search({"source": "anilibria"})
    assert exc.value.code == INVALID_PARAMS

async def test_unknown_source_is_rejected(service):
    with pytest.raises(RpcError) as exc:
        await service.catalog_ongoing({"source": "не-существует"})
    assert exc.value.code == SOURCE_UNAVAILABLE

async def test_upstream_failure_maps_to_source_unavailable(service, wire):
    wire("animego", FakeExtractor(fail_search=True))
    with pytest.raises(RpcError) as exc:
        await service.catalog_search({"source": "animego", "query": "что-нибудь"})
    assert exc.value.code == SOURCE_UNAVAILABLE

    assert "VPN" in exc.value.data["hint"]

async def test_search_multi_isolates_failing_source(service, wire):
    wire("anilibria", build_catalog())
    wire("animego", FakeExtractor(fail_search=True))

    result = await service.catalog_search_multi(
        {"query": "атака", "sources": ["anilibria", "animego"]}
    )

    assert [g["source"] for g in result["groups"]] == ["anilibria"]
    assert len(result["groups"][0]["items"]) == 1
    assert [f["source"] for f in result["failures"]] == ["animego"]

async def test_search_multi_requires_list(service):
    with pytest.raises(RpcError) as exc:
        await service.catalog_search_multi({"query": "x", "sources": "anilibria"})
    assert exc.value.code == INVALID_PARAMS

async def test_dispatch_table_covers_documented_methods(service):
    assert set(service.dispatch_table()) == {
        "ping",
        "sources.list",
        "config.set",
        "animelib.servers",
        "catalog.ongoing",
        "catalog.search",
        "catalog.searchMulti",
        "catalog.probe",
        "anime.get",
        "anime.episodes",
        "episode.studios",
        "studio.videos",
        "studio.qualities",
    }


async def test_config_set_merges_and_resets_extractor(service, wire):
    marker = FakeExtractor()
    wire("animelib", marker)

    first = await service.config_set({"section": "animelib", "values": {"token": "abc"}})
    assert first["keys"] == ["token"]

    second = await service.config_set({"section": "animelib", "values": {"server": "main"}})
    assert second["keys"] == ["server", "token"]

    from anilume_sidecar import settings

    assert settings.get("animelib", "token") == "abc"
    assert service.pool._cache.get("animelib") is not marker

async def test_config_set_requires_object(service):
    with pytest.raises(RpcError) as exc:
        await service.config_set({"section": "animelib", "values": "не объект"})
    assert exc.value.code == INVALID_PARAMS

async def test_probe_reports_quality_and_dubs_per_source(service, wire):
    wire("anilibria", build_catalog())
    cards = (await service.catalog_search({"source": "anilibria", "query": "атака"}))["items"]

    result = await service.catalog_probe({"items": [{"handle": cards[0]["handle"]}]})
    probe = result["probes"][0]

    assert probe["source"] == "anilibria"
    assert probe["quality"] == 1080
    assert probe["dubs"] == 2
    assert probe["episodes"] == 3
    assert probe["error"] is None

async def test_probe_reports_a_failing_source_instead_of_raising(service, wire):
    wire("anilibria", FakeExtractor(cards=[FakeCard("Атака титанов", "https://site/a/1")]))
    cards = (await service.catalog_search({"source": "anilibria", "query": "атака"}))["items"]

    result = await service.catalog_probe({"items": [{"handle": cards[0]["handle"]}]})
    probe = result["probes"][0]

    assert probe["quality"] is None
    assert probe["dubs"] == 0
    assert probe["error"]

async def test_probe_runs_every_source_even_when_one_dies(service, wire):
    wire("anilibria", build_catalog())
    wire("animego", FakeExtractor(cards=[FakeCard("Атака титанов", "https://ag/1")]))

    alive = (await service.catalog_search({"source": "anilibria", "query": "атака"}))["items"]
    dead = (await service.catalog_search({"source": "animego", "query": "атака"}))["items"]

    result = await service.catalog_probe(
        {"items": [{"handle": dead[0]["handle"]}, {"handle": alive[0]["handle"]}]}
    )

    by_source = {p["source"]: p for p in result["probes"]}
    assert by_source["animego"]["quality"] is None
    assert by_source["anilibria"]["quality"] == 1080

async def test_probe_requires_a_list(service):
    with pytest.raises(RpcError) as exc:
        await service.catalog_probe({"items": "нет"})
    assert exc.value.code == INVALID_PARAMS


async def test_animelib_loses_priority_without_a_token(service):
    settings.set_section("animelib", {})

    listed = await service.sources_list({})
    animelib = next(s for s in listed["sources"] if s["key"] == "animelib")

    assert animelib["priority"] == 45
    assert "720p" in animelib["notes"][0]
    assert listed["default"] == "yummy_anime"


async def test_animelib_leads_again_once_a_token_is_set(service):
    settings.set_section("animelib", {"token": "abc"})

    listed = await service.sources_list({})
    animelib = next(s for s in listed["sources"] if s["key"] == "animelib")

    assert animelib["priority"] == 10
    assert listed["default"] == "animelib"
    settings.set_section("animelib", {})

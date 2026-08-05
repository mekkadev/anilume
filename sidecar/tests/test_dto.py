from anilume_sidecar import dto
from conftest import ANILIBRIA_RAW, ANIMEGO_RAW, YUMMY_RAW, FakeAnime, FakeCard, FakeEpisode, FakeSource

def test_anilibria_meta_is_normalized():
    anime = FakeAnime("Тестовый релиз", "t.jpg", "описание", data=ANILIBRIA_RAW)
    meta = dto.extract_meta("anilibria", anime)
    assert meta["year"] == 2023
    assert meta["genres"] == ["Экшен", "Фэнтези"]
    assert meta["episodesTotal"] == 12
    assert meta["kind"] == "ТВ-сериал"
    assert meta["ageRating"] == "16+"
    assert meta["altTitle"] == "Test Release"
    assert meta["status"] == "Онгоинг"
    assert meta["episodeDurationMin"] == 24

def test_yummy_meta_exposes_shikimori_id():
    anime = FakeAnime("Y", "t.jpg", "d", data=YUMMY_RAW)
    meta = dto.extract_meta("yummy_anime", anime)
    assert meta["shikimoriId"] == 54321
    assert meta["score"] == 8.42
    assert meta["genres"] == ["Комедия"]
    assert meta["status"] == "Вышел"

def test_animego_meta_derives_year_from_date():
    anime = FakeAnime("A", "t.jpg", "d")
    anime.raw_json = ANIMEGO_RAW
    meta = dto.extract_meta("animego", anime)
    assert meta["year"] == 2019
    assert meta["score"] == 9.1
    assert meta["episodesTotal"] == 25
    assert meta["genres"] == ["Драма", "Сёнэн"]

def test_unknown_source_yields_empty_meta():
    anime = FakeAnime("S", "t.jpg", "d", data={"whatever": 1})
    assert dto.extract_meta("sameband", anime) == dto.empty_meta()

def test_broken_raw_data_does_not_raise():
    anime = FakeAnime("X", "t.jpg", "d", data={"year": "не число", "genres": "не список"})
    meta = dto.extract_meta("anilibria", anime)
    assert meta["year"] is None
    assert meta["genres"] == []

def test_poster_prefers_high_resolution_variant():
    card = FakeCard("Y", "https://site/1", thumbnail="https://cdn.test/thumb.jpg", data=YUMMY_RAW)
    assert dto.card(card, "h1", "yummy_anime")["poster"] == "https://cdn.test/huge.jpg"

def test_poster_falls_back_to_thumbnail():
    card = FakeCard("S", "https://site/2", thumbnail="https://cdn.test/thumb.jpg")
    assert dto.card(card, "h1", "sameband")["poster"] == "https://cdn.test/thumb.jpg"

def test_card_uses_url_as_stable_key():
    card = FakeCard("Название", "https://site/anime/42", data=ANILIBRIA_RAW)
    result = dto.card(card, "h1", "anilibria")
    assert result["key"] == "https://site/anime/42"
    assert result["handle"] == "h1"

def test_ongoing_badges_are_passed_through():
    card = FakeCard("O", "https://site/3", episode="12 серия", dub="AniLibria")
    result = dto.card(card, "h1", "animego")
    assert result["episodeBadge"] == "12 серия"
    assert result["dubBadge"] == "AniLibria"

def test_episode_gets_generated_title_when_empty():
    assert dto.episode(FakeEpisode(7, ""), "h1")["title"] == "Серия 7"
    assert dto.episode(FakeEpisode(7, "Название"), "h1")["title"] == "Серия 7. Название"

def test_studio_extracts_player_hostname():
    result = dto.studio(FakeSource("AniLibria", "https://www.kodik.info/seria/1?x=2"), "h1")
    assert result["player"] == "kodik.info"
    assert result["title"] == "AniLibria"

def test_video_carries_headers_for_proxy():
    from conftest import FakeVideo

    result = dto.video(FakeVideo(1080, "https://cdn/x.m3u8", headers={"Referer": "https://kodik"}))
    assert result == {
        "type": "m3u8",
        "quality": 1080,
        "url": "https://cdn/x.m3u8",
        "headers": {"Referer": "https://kodik"},
    }


def test_generic_episode_names_become_numbered():
    from anilume_sidecar import dto

    class Ep:
        def __init__(self, ordinal, title):
            self.ordinal = ordinal
            self.title = title

    assert dto.episode(Ep(3, "Episode"), "h")["title"] == "Серия 3"
    assert dto.episode(Ep(3, ""), "h")["title"] == "Серия 3"
    assert dto.episode(Ep(3, "серия"), "h")["title"] == "Серия 3"
    assert dto.episode(Ep(3, "Битва под дождём"), "h")["title"] == "Серия 3. Битва под дождём"
    assert dto.episode(Ep(3, "Серия 3"), "h")["title"] == "Серия 3"

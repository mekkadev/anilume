from anilume_sidecar import settings
from anilume_sidecar.animelib import (
    Card,
    Episode,
    Source,
    _cover,
    _server_bases,
    _text,
    _title,
    video_url,
)
from anilume_sidecar.dto import extract_meta

DOC = {
    "type": "doc",
    "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Первый абзац."}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "Второй абзац."}]},
    ],
}

def test_description_is_pulled_out_of_the_document_tree():
    result = _text(DOC)
    assert "Первый абзац." in result
    assert "Второй абзац." in result
    assert "paragraph" not in result

def test_description_handles_plain_and_missing_values():
    assert _text("просто строка") == "просто строка"
    assert _text(None) == ""
    assert _text({}) == ""
    assert _text({"ru": "русский текст"}) == "русский текст"

def test_cover_prefers_full_size():
    payload = {
        "cover": {
            "thumbnail": "https://cdn/t.jpg",
            "md": "https://cdn/m.jpg",
            "default": "https://cdn/full.jpg",
        }
    }
    assert _cover(payload) == "https://cdn/full.jpg"
    assert _cover({"cover": {"thumbnail": "https://cdn/t.jpg"}}) == "https://cdn/t.jpg"
    assert _cover({}) is None

def test_title_prefers_russian_name():
    assert _title({"rus_name": "Клинок", "name": "Kimetsu"}) == "Клинок"
    assert _title({"name": "Kimetsu"}) == "Kimetsu"
    assert _title({}) == "Без названия"

def test_video_url_keeps_the_cyrillic_path_segment():
    url = video_url("https://video1.cdnlibs.org/.аs/", "/uploads/x/y_2160.mp4")
    assert url.startswith("https://video1.cdnlibs.org/.%D0%B0s/")
    assert url.endswith("/uploads/x/y_2160.mp4")
    assert " " not in url

def test_video_url_does_not_double_the_slash():
    assert video_url("https://host/base/", "/a.mp4").endswith("/base/a.mp4")
    assert video_url("https://host/base", "a.mp4").endswith("/base/a.mp4")

def test_chosen_server_is_tried_first_then_the_rest():
    settings.clear()
    settings.set_section(
        "animelib",
        {
            "server": "secondary_1",
            "servers": {"main": "https://a/", "secondary_1": "https://b/"},
        },
    )
    order = [key for key, _ in _server_bases()]
    assert order[0] == "secondary_1"
    assert set(order) == {"main", "secondary_1"}
    settings.clear()

def test_unknown_server_falls_back_without_losing_the_others():
    settings.clear()
    settings.set_section("animelib", {"server": "нет-такого", "servers": {"main": "https://a/"}})
    assert [key for key, _ in _server_bases()] == ["main"]
    settings.clear()

def test_source_label_joins_team_and_translation_type():
    source = Source(
        None,
        {
            "player": "Animelib",
            "team": {"name": "Studio Band"},
            "translation_type": {"label": "Озвучка"},
            "video": {"quality": []},
        },
    )
    assert source.title == "Studio Band · озвучка"
    assert source.player == "Animelib"

def test_kodik_source_gets_absolute_url():
    source = Source(None, {"player": "Kodik", "src": "//kodikplayer.com/seria/1/abc"})
    assert source.url.startswith("https://kodikplayer.com/")

def test_episode_title_includes_name_and_season():
    plain = Episode(None, {"id": 1, "number": "3", "name": "Жестокость", "season": "1"})
    assert plain.ordinal == 3
    assert plain.title == "Серия 3. Жестокость"

    second = Episode(None, {"id": 2, "number": "1", "name": "", "season": "2"})
    assert second.title == "Сезон 2, серия 1"

def test_card_key_is_a_stable_site_url():
    card = Card(None, {"rus_name": "Клинок", "slug_url": "14421--kimetsu"})
    assert card.url == "https://v5.animelib.org/ru/anime/14421--kimetsu"

def test_meta_normalizes_animelib_payload():
    class Payload:
        data = {
            "releaseDate": "2019-04-06",
            "genres": [{"name": "Фэнтези"}],
            "tags": [{"name": "Демоны"}, {"name": "Месть"}],
            "rate_avg": "8.42",
            "items_count": {"uploaded": 26, "total": 26},
            "type": {"label": "TV Сериал"},
            "status": {"label": "Завершён"},
            "ageRestriction": {"label": "R-17"},
            "otherNames": ["Demon Slayer"],
        }

    meta = extract_meta("animelib", Payload())
    assert meta["year"] == 2019
    assert meta["score"] == 8.42
    assert meta["episodesTotal"] == 26
    assert meta["genres"] == ["Фэнтези"]
    assert meta["tags"] == ["Демоны", "Месть"]
    assert meta["kind"] == "TV Сериал"
    assert meta["altTitle"] == "Demon Slayer"

def test_meta_survives_a_changed_payload_shape():
    class Broken:
        data = {"genres": "не список", "items_count": 5, "rate_avg": None}

    meta = extract_meta("animelib", Broken())
    assert meta["genres"] == []
    assert meta["tags"] == []
    assert meta["episodesTotal"] is None


def test_relevance_puts_the_real_title_above_recaps():
    from anilume_sidecar.animelib import relevance

    cards = [
        {"rus_name": "Магическая битва: Рекапы", "rating": {"votes": 10}, "shiki_rate": 5.0},
        {"rus_name": "Магическая битва 2", "rating": {"votes": 7000}, "shiki_rate": 8.6},
        {"rus_name": "Магическая битва", "rating": {"votes": 9000}, "shiki_rate": 8.52},
        {"rus_name": "Атака титанов: Обзор за двадцать минут", "rating": {"votes": 50}},
    ]

    ordered = [c["rus_name"] for c in sorted(cards, key=lambda c: relevance(c, "Магическая битва"))]

    assert ordered[0] == "Магическая битва"
    assert ordered[1] == "Магическая битва 2"
    assert "Рекапы" in ordered[2]
    assert "Обзор" in ordered[3]


def test_relevance_prefers_more_votes_among_equal_matches():
    from anilume_sidecar.animelib import relevance

    quiet = {"rus_name": "Тайтл", "rating": {"votes": 3}}
    loud = {"rus_name": "Тайтл", "rating": {"votes": 900}}

    assert relevance(loud, "Тайтл") < relevance(quiet, "Тайтл")

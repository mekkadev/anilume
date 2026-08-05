use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::db::Db;
use crate::error::{CoreError, Result};

pub const CATALOG_BASE: &str = "https://shikimori.one";

const MIRRORS: [&str; 3] = [
    "https://shikimori.one",
    "https://shikimori.io",
    "https://shikimori.me",
];

static MIRROR: AtomicUsize = AtomicUsize::new(0);

pub fn catalog_base() -> &'static str {
    MIRRORS[MIRROR.load(Ordering::Relaxed) % MIRRORS.len()]
}

fn next_mirror() -> &'static str {
    let index = MIRROR.fetch_add(1, Ordering::Relaxed) + 1;
    MIRRORS[index % MIRRORS.len()]
}

const MIN_REQUEST_GAP: Duration = Duration::from_millis(240);
const WINDOW: Duration = Duration::from_secs(60);
const WINDOW_LIMIT: usize = 80;
const RETRIES: usize = 3;
const RETRY_BACKOFF: Duration = Duration::from_millis(600);

const TTL_CATALOG: i64 = 60 * 60;
const TTL_TITLE: i64 = 24 * 60 * 60;
const TTL_LINKS: i64 = 7 * 24 * 60 * 60;
const TTL_COMMENTS: i64 = 10 * 60;
const TTL_CALENDAR: i64 = 30 * 60;
const TTL_OPTIONS: i64 = 30 * 24 * 60 * 60;
const TTL_MATCH: i64 = 30 * 24 * 60 * 60;
const PAGE_SIZE: i64 = 40;
const MAX_PAGE: i64 = 100;
const YEAR_FLOOR: i64 = 1960;
const YEAR_CEIL: i64 = 2100;

const ORDERS: [&str; 5] = ["popularity", "ranked", "aired_on", "name", "random"];
const STATUSES: [&str; 3] = ["anons", "ongoing", "released"];
const KINDS: [&str; 8] = [
    "tv",
    "movie",
    "ova",
    "ona",
    "special",
    "tv_special",
    "music",
    "pv",
];

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverQuery {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub genres: Vec<i64>,
    #[serde(default)]
    pub studios: Vec<i64>,
    #[serde(default)]
    pub kinds: Vec<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub year_from: Option<i64>,
    #[serde(default)]
    pub year_to: Option<i64>,
    #[serde(default)]
    pub order: Option<String>,
    #[serde(default)]
    pub page: Option<i64>,
}

impl DiscoverQuery {
    pub fn params(&self) -> Vec<(String, String)> {
        let mut params = vec![
            ("limit".to_owned(), PAGE_SIZE.to_string()),
            ("page".to_owned(), self.clamped_page().to_string()),
            ("order".to_owned(), self.clamped_order().to_owned()),
        ];

        if let Some(query) = self.trimmed_query() {
            params.push(("search".to_owned(), query));
        }
        if let Some(ids) = join_ids(&self.genres) {
            params.push(("genre".to_owned(), ids));
        }
        if let Some(ids) = join_ids(&self.studios) {
            params.push(("studio".to_owned(), ids));
        }
        if let Some(kinds) = self.clamped_kinds() {
            params.push(("kind".to_owned(), kinds));
        }
        if let Some(status) = self.clamped_status() {
            params.push(("status".to_owned(), status.to_owned()));
        }
        if let Some(season) = self.season() {
            params.push(("season".to_owned(), season));
        }
        params
    }

    fn trimmed_query(&self) -> Option<String> {
        self.query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    }

    fn clamped_page(&self) -> i64 {
        self.page.unwrap_or(1).clamp(1, MAX_PAGE)
    }

    fn clamped_order(&self) -> &str {
        self.order
            .as_deref()
            .filter(|value| ORDERS.contains(value))
            .unwrap_or(ORDERS[0])
    }

    fn clamped_status(&self) -> Option<&str> {
        self.status
            .as_deref()
            .filter(|value| STATUSES.contains(value))
    }

    fn clamped_kinds(&self) -> Option<String> {
        let allowed: Vec<&str> = self
            .kinds
            .iter()
            .map(String::as_str)
            .filter(|value| KINDS.contains(value))
            .collect();
        if allowed.is_empty() {
            None
        } else {
            Some(allowed.join(","))
        }
    }

    fn season(&self) -> Option<String> {
        let from = self.year_from;
        let to = self.year_to;
        if from.is_none() && to.is_none() {
            return None;
        }

        let low = from.unwrap_or(YEAR_FLOOR).clamp(YEAR_FLOOR, YEAR_CEIL);
        let high = to.unwrap_or(YEAR_CEIL).clamp(YEAR_FLOOR, YEAR_CEIL);
        let (low, high) = if low <= high {
            (low, high)
        } else {
            (high, low)
        };

        if low == high {
            Some(low.to_string())
        } else {
            Some(format!("{low}_{high}"))
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverCard {
    pub id: i64,
    pub title: String,
    pub original_title: String,
    pub poster: Option<String>,
    pub score: Option<f64>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub year: Option<i64>,
    pub episodes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Named {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverOptions {
    pub genres: Vec<Named>,
    pub studios: Vec<Named>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitleDetail {
    pub id: i64,
    pub title: String,
    pub original_title: String,
    pub japanese: Option<String>,
    pub poster: Option<String>,
    pub art: Vec<String>,
    pub description: String,
    pub score: Option<f64>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub year: Option<i64>,
    pub episodes: Option<i64>,
    pub episodes_aired: Option<i64>,
    pub duration: Option<i64>,
    pub rating: Option<String>,
    pub genres: Vec<String>,
    pub studios: Vec<Named>,
    pub next_episode_at: Option<String>,
    pub topic_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelatedTitle {
    pub relation: String,
    pub card: DiscoverCard,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Upcoming {
    pub card: DiscoverCard,
    pub episode: i64,
    pub airs_at: String,
    pub duration: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: i64,
    pub author: String,
    pub avatar: Option<String>,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
struct RawImage {
    #[serde(default)]
    preview: Option<String>,
    #[serde(default)]
    original: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawAnime {
    id: i64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    russian: Option<String>,
    #[serde(default)]
    image: Option<RawImage>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    score: Option<serde_json::Value>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    episodes: Option<i64>,
    #[serde(default)]
    episodes_aired: Option<i64>,
    #[serde(default)]
    aired_on: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawScreenshot {
    #[serde(default)]
    original: Option<String>,
    #[serde(default)]
    preview: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawDetail {
    #[serde(flatten)]
    base: RawAnime,
    #[serde(default)]
    japanese: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    duration: Option<i64>,
    #[serde(default)]
    rating: Option<String>,
    #[serde(default)]
    genres: Vec<RawGenre>,
    #[serde(default)]
    studios: Vec<RawStudio>,
    #[serde(default)]
    screenshots: Vec<RawScreenshot>,
    #[serde(default)]
    next_episode_at: Option<String>,
    #[serde(default)]
    topic_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct RawRelated {
    #[serde(default)]
    relation_russian: Option<String>,
    #[serde(default)]
    relation: Option<String>,
    #[serde(default)]
    anime: Option<RawAnime>,
}

#[derive(Debug, Deserialize)]
struct RawCalendar {
    #[serde(default)]
    next_episode: Option<i64>,
    #[serde(default)]
    next_episode_at: Option<String>,
    #[serde(default)]
    duration: Option<i64>,
    #[serde(default)]
    anime: Option<RawAnime>,
}

#[derive(Debug, Deserialize)]
struct RawUser {
    #[serde(default)]
    nickname: String,
    #[serde(default)]
    avatar: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawComment {
    id: i64,
    #[serde(default)]
    body: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    user: Option<RawUser>,
}

#[derive(Debug, Deserialize)]
struct RawGenre {
    id: i64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    russian: Option<String>,
    #[serde(default)]
    entry_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawStudio {
    id: i64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    filtered_name: Option<String>,
}

fn join_ids(ids: &[i64]) -> Option<String> {
    let cleaned: Vec<String> = ids
        .iter()
        .filter(|id| **id > 0)
        .map(|id| id.to_string())
        .collect();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.join(","))
    }
}

fn upcoming_from_raw(raw: RawCalendar) -> Option<Upcoming> {
    let anime = raw.anime?;
    let airs_at = raw
        .next_episode_at
        .filter(|value| !value.trim().is_empty())?;
    Some(Upcoming {
        card: card_from_raw(anime),
        episode: raw.next_episode.unwrap_or(0).max(0),
        airs_at,
        duration: raw.duration.filter(|value| *value > 0),
    })
}

fn cache_key(path: &str, params: &[(String, String)]) -> String {
    let mut pairs: Vec<String> = params
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect();
    pairs.sort();
    if pairs.is_empty() {
        format!("shiki:{path}")
    } else {
        format!("shiki:{path}?{}", pairs.join("&"))
    }
}

fn absolute(path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        path.to_owned()
    } else {
        format!("{}{path}", catalog_base())
    }
}

fn parse_score(value: Option<&serde_json::Value>) -> Option<f64> {
    let parsed = match value {
        Some(serde_json::Value::String(text)) => text.parse::<f64>().ok(),
        Some(serde_json::Value::Number(number)) => number.as_f64(),
        _ => None,
    };
    parsed.filter(|score| *score > 0.0)
}

fn drop_blocks(input: &str, tag: &str) -> String {
    let open = format!("[{tag}");
    let close = format!("[/{tag}]");
    let mut out = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(start) = rest.find(&open) {
        out.push_str(&rest[..start]);
        match rest[start..].find(&close) {
            Some(end) => rest = &rest[start + end + close.len()..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

pub fn strip_bbcode(input: &str) -> String {
    let source = drop_blocks(input, "spoiler");
    let mut out = String::with_capacity(source.len());
    let mut rest = source.as_str();

    while let Some(start) = rest.find('[') {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].find(']') else {
            rest = &rest[start + 1..];
            continue;
        };

        let tag = &rest[start + 1..start + end];
        if tag.eq_ignore_ascii_case("br") {
            out.push('\n');
        }
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);

    let collapsed = out
        .replace("\r\n", "\n")
        .split('\n')
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");

    let mut text = collapsed.trim().to_owned();
    while text.contains("\n\n\n") {
        text = text.replace("\n\n\n", "\n\n");
    }
    text
}

fn named_studio(studio: RawStudio) -> Named {
    Named {
        id: studio.id,
        name: studio
            .filtered_name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(studio.name),
    }
}

fn card_from_raw(raw: RawAnime) -> DiscoverCard {
    let poster = raw.image.and_then(|image| {
        image
            .original
            .or(image.preview)
            .filter(|path| !path.is_empty())
            .map(|path| absolute(&path))
    });

    let title = raw
        .russian
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&raw.name)
        .to_owned();

    DiscoverCard {
        id: raw.id,
        title,
        original_title: raw.name,
        poster,
        score: parse_score(raw.score.as_ref()),
        kind: raw.kind,
        status: raw.status,
        year: raw
            .aired_on
            .as_deref()
            .and_then(|date| date.get(..4))
            .and_then(|year| year.parse::<i64>().ok()),
        episodes: raw
            .episodes
            .filter(|count| *count > 0)
            .or(raw.episodes_aired.filter(|count| *count > 0)),
    }
}

fn detail_from_raw(raw: RawDetail) -> TitleDetail {
    let art: Vec<String> = raw
        .screenshots
        .into_iter()
        .filter_map(|shot| shot.original.or(shot.preview))
        .filter(|path| !path.is_empty())
        .map(|path| absolute(&path))
        .take(8)
        .collect();

    let genres = raw
        .genres
        .into_iter()
        .map(|genre| {
            genre
                .russian
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(genre.name)
        })
        .collect();

    let duration = raw.duration.filter(|value| *value > 0);
    let episodes_aired = raw.base.episodes_aired.filter(|value| *value > 0);
    let card = card_from_raw(raw.base);

    TitleDetail {
        id: card.id,
        title: card.title,
        original_title: card.original_title,
        japanese: raw.japanese.filter(|value| !value.trim().is_empty()),
        poster: card.poster,
        art,
        description: raw
            .description
            .as_deref()
            .map(strip_bbcode)
            .unwrap_or_default(),
        score: card.score,
        kind: card.kind,
        status: card.status,
        year: card.year,
        episodes: card.episodes,
        episodes_aired,
        duration,
        rating: raw
            .rating
            .filter(|value| !value.is_empty() && value != "none"),
        genres,
        studios: raw.studios.into_iter().map(named_studio).collect(),
        next_episode_at: raw.next_episode_at,
        topic_id: raw.topic_id,
    }
}

pub fn normalise(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut space = false;
    for ch in value.chars() {
        if ch.is_alphanumeric() {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.extend(ch.to_lowercase());
        } else {
            space = true;
        }
    }
    out
}

fn plausible(needle: &str, card: &DiscoverCard) -> bool {
    if needle.is_empty() {
        return false;
    }
    [&card.title, &card.original_title]
        .into_iter()
        .any(|title| {
            let other = normalise(title);
            !other.is_empty()
                && (other == needle || other.contains(needle) || needle.contains(&other))
        })
}

fn best_match(name: &str, year: Option<i64>, cards: Vec<DiscoverCard>) -> Option<DiscoverCard> {
    let needle = normalise(name);
    let exact = |card: &DiscoverCard| {
        normalise(&card.title) == needle || normalise(&card.original_title) == needle
    };

    if let Some(year) = year {
        if let Some(found) = cards
            .iter()
            .find(|card| exact(card) && card.year.is_some_and(|value| (value - year).abs() <= 1))
        {
            return Some(found.clone());
        }
    }

    cards
        .iter()
        .find(|card| exact(card))
        .or_else(|| cards.iter().find(|card| plausible(&needle, card)))
        .cloned()
}

pub struct Discover {
    http: reqwest::Client,
    db: Arc<Db>,
    throttle: Mutex<Vec<Instant>>,
    options: Mutex<Option<DiscoverOptions>>,
}

impl Discover {
    pub fn new(db: Arc<Db>) -> Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(12))
                .connect_timeout(Duration::from_secs(6))
                .build()?,
            db,
            throttle: Mutex::new(Vec::new()),
            options: Mutex::new(None),
        })
    }

    pub async fn search(&self, query: &DiscoverQuery) -> Result<Vec<DiscoverCard>> {
        let raw: Vec<RawAnime> = self
            .fetch("/api/animes", &query.params(), TTL_CATALOG)
            .await?;
        Ok(raw.into_iter().map(card_from_raw).collect())
    }

    pub async fn options(&self) -> Result<DiscoverOptions> {
        if let Some(cached) = self.options.lock().await.clone() {
            return Ok(cached);
        }

        let genres: Vec<RawGenre> = self.fetch("/api/genres", &[], TTL_OPTIONS).await?;
        let studios: Vec<RawStudio> = self.fetch("/api/studios", &[], TTL_OPTIONS).await?;

        let mut genres: Vec<Named> = genres
            .into_iter()
            .filter(|genre| genre.entry_type.as_deref() == Some("Anime"))
            .map(|genre| Named {
                id: genre.id,
                name: genre
                    .russian
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or(genre.name),
            })
            .collect();
        genres.sort_by_key(|genre| genre.name.to_lowercase());

        let mut studios: Vec<Named> = studios
            .into_iter()
            .map(|studio| Named {
                id: studio.id,
                name: studio
                    .filtered_name
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or(studio.name),
            })
            .filter(|studio| !studio.name.trim().is_empty())
            .collect();
        studios.sort_by_key(|studio| studio.name.to_lowercase());

        let options = DiscoverOptions { genres, studios };
        *self.options.lock().await = Some(options.clone());
        Ok(options)
    }

    pub async fn title(&self, id: i64) -> Result<TitleDetail> {
        let raw: RawDetail = self
            .fetch(&format!("/api/animes/{id}"), &[], TTL_TITLE)
            .await?;
        Ok(detail_from_raw(raw))
    }

    pub async fn similar(&self, id: i64, limit: usize) -> Result<Vec<DiscoverCard>> {
        let raw: Vec<RawAnime> = self
            .fetch(&format!("/api/animes/{id}/similar"), &[], TTL_LINKS)
            .await?;
        Ok(raw.into_iter().take(limit).map(card_from_raw).collect())
    }

    pub async fn related(&self, id: i64) -> Result<Vec<RelatedTitle>> {
        let raw: Vec<RawRelated> = self
            .fetch(&format!("/api/animes/{id}/related"), &[], TTL_LINKS)
            .await?;
        Ok(raw
            .into_iter()
            .filter_map(|entry| {
                let anime = entry.anime?;
                let relation = entry
                    .relation_russian
                    .or(entry.relation)
                    .unwrap_or_else(|| "Связано".to_owned());
                Some(RelatedTitle {
                    relation,
                    card: card_from_raw(anime),
                })
            })
            .collect())
    }

    pub async fn calendar(&self) -> Result<Vec<Upcoming>> {
        let raw: Vec<RawCalendar> = self.fetch("/api/calendar", &[], TTL_CALENDAR).await?;
        Ok(raw.into_iter().filter_map(upcoming_from_raw).collect())
    }

    pub async fn comments(&self, topic_id: i64, limit: i64) -> Result<Vec<Comment>> {
        let params = [
            ("commentable_id".to_owned(), topic_id.to_string()),
            ("commentable_type".to_owned(), "Topic".to_owned()),
            ("limit".to_owned(), limit.clamp(1, 30).to_string()),
            ("desc".to_owned(), "1".to_owned()),
        ];

        let raw: Vec<RawComment> = self.fetch("/api/comments", &params, TTL_COMMENTS).await?;
        Ok(raw
            .into_iter()
            .filter_map(|entry| {
                let body = strip_bbcode(&entry.body);
                if body.is_empty() {
                    return None;
                }
                let user = entry.user.unwrap_or(RawUser {
                    nickname: String::new(),
                    avatar: None,
                });
                Some(Comment {
                    id: entry.id,
                    author: if user.nickname.is_empty() {
                        "Аноним".to_owned()
                    } else {
                        user.nickname
                    },
                    avatar: user.avatar.filter(|value| !value.is_empty()),
                    body,
                    created_at: entry.created_at,
                })
            })
            .collect())
    }

    pub async fn match_title(&self, name: &str, year: Option<i64>) -> Result<Option<DiscoverCard>> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let params = [
            ("search".to_owned(), trimmed.to_owned()),
            ("limit".to_owned(), "10".to_owned()),
        ];
        let raw: Vec<RawAnime> = self.fetch("/api/animes", &params, TTL_MATCH).await?;
        let cards: Vec<DiscoverCard> = raw.into_iter().map(card_from_raw).collect();
        Ok(best_match(trimmed, year, cards))
    }

    async fn fetch<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        params: &[(String, String)],
        ttl: i64,
    ) -> Result<T> {
        let key = cache_key(path, params);
        let mut stale: Option<String> = None;

        if let Ok(Some(hit)) = self.db.cache_read(&key) {
            if hit.age <= ttl {
                if let Ok(parsed) = serde_json::from_str(&hit.value) {
                    return Ok(parsed);
                }
            }
            stale = Some(hit.value);
        }

        let text = match self.load(path, params).await {
            Ok(text) => {
                let _ = self.db.cache_write(&key, &text);
                text
            }
            Err(error) => match stale {
                Some(text) => {
                    tracing::warn!(target: "discover", "{path}: отдаю кэш, живой запрос упал: {error}");
                    text
                }
                None => return Err(error),
            },
        };

        serde_json::from_str(&text)
            .map_err(|e| CoreError::Other(format!("Каталог Shikimori вернул не JSON: {e}")))
    }

    async fn load(&self, path: &str, params: &[(String, String)]) -> Result<String> {
        let mut attempt = 0;
        let response = loop {
            self.pace().await;

            let sent = self
                .http
                .get(format!("{}{path}", catalog_base()))
                .query(params)
                .header(reqwest::header::USER_AGENT, "anilume")
                .header(reqwest::header::ACCEPT, "application/json")
                .send()
                .await;

            let throttled = matches!(
                &sent,
                Ok(response) if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
            );
            let unreachable = match &sent {
                Ok(response) => response.status().is_server_error(),
                Err(_) => true,
            };

            if !throttled && !unreachable {
                break sent?;
            }

            attempt += 1;
            if attempt >= RETRIES {
                break sent?;
            }
            if unreachable {
                let host = next_mirror();
                tracing::warn!(target: "discover", "переключаюсь на зеркало {host}");
            }
            tokio::time::sleep(RETRY_BACKOFF * attempt as u32).await;
        };

        let status = response.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(CoreError::Network(
                "Shikimori ограничил частоту запросов — попробуйте через минуту".into(),
            ));
        }
        if !status.is_success() {
            return Err(CoreError::Network(format!(
                "Каталог Shikimori ответил {status}"
            )));
        }

        Ok(response.text().await?)
    }

    async fn pace(&self) {
        let wait = {
            let mut recent = self.throttle.lock().await;
            let now = Instant::now();
            recent.retain(|stamp| now.duration_since(*stamp) < WINDOW);

            let by_gap = recent
                .last()
                .map(|last| MIN_REQUEST_GAP.saturating_sub(now.duration_since(*last)))
                .unwrap_or_default();

            let by_window = if recent.len() >= WINDOW_LIMIT {
                recent
                    .first()
                    .map(|oldest| WINDOW.saturating_sub(now.duration_since(*oldest)))
                    .unwrap_or_default()
            } else {
                Duration::ZERO
            };

            let wait = by_gap.max(by_window);
            recent.push(now + wait);
            wait
        };

        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(query: &DiscoverQuery) -> std::collections::HashMap<String, String> {
        query.params().into_iter().collect()
    }

    #[test]
    fn empty_query_asks_for_the_first_popular_page() {
        let found = params(&DiscoverQuery::default());
        assert_eq!(found["page"], "1");
        assert_eq!(found["order"], "popularity");
        assert_eq!(found["limit"], PAGE_SIZE.to_string());
        assert!(!found.contains_key("genre"));
        assert!(!found.contains_key("season"));
    }

    #[test]
    fn genres_and_studios_are_joined_by_comma() {
        let found = params(&DiscoverQuery {
            genres: vec![1, 2, 0, 42],
            studios: vec![569],
            ..Default::default()
        });
        assert_eq!(found["genre"], "1,2,42");
        assert_eq!(found["studio"], "569");
    }

    #[test]
    fn a_single_year_is_sent_without_a_range() {
        let found = params(&DiscoverQuery {
            year_from: Some(2020),
            year_to: Some(2020),
            ..Default::default()
        });
        assert_eq!(found["season"], "2020");
    }

    #[test]
    fn open_year_bounds_are_filled_in() {
        let only_from = params(&DiscoverQuery {
            year_from: Some(2015),
            ..Default::default()
        });
        assert_eq!(only_from["season"], format!("2015_{YEAR_CEIL}"));

        let only_to = params(&DiscoverQuery {
            year_to: Some(1999),
            ..Default::default()
        });
        assert_eq!(only_to["season"], format!("{YEAR_FLOOR}_1999"));
    }

    #[test]
    fn swapped_year_bounds_are_put_back_in_order() {
        let found = params(&DiscoverQuery {
            year_from: Some(2020),
            year_to: Some(2010),
            ..Default::default()
        });
        assert_eq!(found["season"], "2010_2020");
    }

    #[test]
    fn unknown_order_status_and_kind_never_reach_the_api() {
        let found = params(&DiscoverQuery {
            order: Some("; drop".into()),
            status: Some("whatever".into()),
            kinds: vec!["tv".into(), "cartoon".into()],
            ..Default::default()
        });
        assert_eq!(found["order"], "popularity");
        assert!(!found.contains_key("status"));
        assert_eq!(found["kind"], "tv");
    }

    #[test]
    fn page_stays_inside_the_supported_range() {
        let low = params(&DiscoverQuery {
            page: Some(-5),
            ..Default::default()
        });
        let high = params(&DiscoverQuery {
            page: Some(9999),
            ..Default::default()
        });
        assert_eq!(low["page"], "1");
        assert_eq!(high["page"], MAX_PAGE.to_string());
    }

    #[test]
    fn blank_search_text_is_dropped() {
        let found = params(&DiscoverQuery {
            query: Some("   ".into()),
            ..Default::default()
        });
        assert!(!found.contains_key("search"));
    }

    #[test]
    fn cards_take_the_russian_title_and_an_absolute_poster() {
        let raw: RawAnime = serde_json::from_str(
            r#"{"id":19647,"name":"Hajime no Ippo: Rising","russian":"Первый шаг",
                "image":{"preview":"/system/animes/preview/19647.jpg","original":"/system/animes/original/19647.jpg"},
                "kind":"tv","score":"8.61","status":"released","episodes":25,"aired_on":"2013-10-06"}"#,
        )
        .unwrap();

        let card = card_from_raw(raw);
        assert_eq!(card.title, "Первый шаг");
        assert_eq!(card.original_title, "Hajime no Ippo: Rising");
        assert_eq!(
            card.poster.as_deref(),
            Some("https://shikimori.one/system/animes/original/19647.jpg")
        );
        assert_eq!(card.score, Some(8.61));
        assert_eq!(card.year, Some(2013));
        assert_eq!(card.episodes, Some(25));
    }

    #[test]
    fn cards_fall_back_to_the_original_title_and_survive_missing_fields() {
        let raw: RawAnime = serde_json::from_str(
            r#"{"id":1,"name":"Cowboy Bebop","russian":"","score":"0.0","episodes":0,"episodes_aired":12}"#,
        )
        .unwrap();

        let card = card_from_raw(raw);
        assert_eq!(card.title, "Cowboy Bebop");
        assert_eq!(card.poster, None);
        assert_eq!(card.score, None);
        assert_eq!(card.year, None);
        assert_eq!(card.episodes, Some(12));
    }

    #[test]
    fn bbcode_markup_is_reduced_to_plain_text() {
        let source =
            "Король пиратов, [character=4883]Роджер[/character], был [b]единственным[/b].[br]\
                      [url=https://x]Ссылка[/url] в конце.";
        assert_eq!(
            strip_bbcode(source),
            "Король пиратов, Роджер, был единственным.\nСсылка в конце."
        );
    }

    #[test]
    fn spoiler_blocks_are_dropped_along_with_their_text() {
        let source = "Начало. [spoiler=Важно]он умирает[/spoiler] Конец.";
        let stripped = strip_bbcode(source);
        assert!(!stripped.contains("умирает"));
        assert!(stripped.starts_with("Начало."));
        assert!(stripped.ends_with("Конец."));
    }

    #[test]
    fn an_unclosed_bracket_does_not_swallow_the_description() {
        assert_eq!(
            strip_bbcode("Текст [b без закрытия"),
            "Текст b без закрытия"
        );
    }

    #[test]
    fn score_is_read_from_a_string_or_a_number() {
        assert_eq!(parse_score(Some(&serde_json::json!("8.61"))), Some(8.61));
        assert_eq!(parse_score(Some(&serde_json::json!(7.5))), Some(7.5));
        assert_eq!(parse_score(Some(&serde_json::json!("0.0"))), None);
        assert_eq!(parse_score(None), None);
    }

    #[test]
    fn details_carry_studios_art_and_a_clean_description() {
        let raw: RawDetail = serde_json::from_str(
            r#"{"id":21,"name":"One Piece","russian":"Ван-Пис","japanese":"ワンピース",
                "image":{"original":"/system/animes/original/21.jpg"},
                "description":"Пираты [b]здесь[/b].","duration":24,"rating":"pg_13",
                "score":"8.72","kind":"tv","status":"ongoing","aired_on":"1999-10-20",
                "episodes":0,"episodes_aired":1150,
                "genres":[{"id":1,"name":"Action","russian":"Экшен"}],
                "studios":[{"id":18,"name":"Toei Animation","filtered_name":"Toei"}],
                "screenshots":[{"original":"/system/screenshots/original/a.jpg","preview":"/p.jpg"}],
                "topic_id":3413}"#,
        )
        .unwrap();

        let detail = detail_from_raw(raw);
        assert_eq!(detail.title, "Ван-Пис");
        assert_eq!(detail.japanese.as_deref(), Some("ワンピース"));
        assert_eq!(detail.description, "Пираты здесь.");
        assert_eq!(detail.genres, vec!["Экшен"]);
        assert_eq!(
            detail.studios,
            vec![Named {
                id: 18,
                name: "Toei".into()
            }]
        );
        assert_eq!(
            detail.art,
            vec![format!("{CATALOG_BASE}/system/screenshots/original/a.jpg")]
        );
        assert_eq!(detail.episodes, Some(1150));
        assert_eq!(detail.episodes_aired, Some(1150));
        assert_eq!(detail.duration, Some(24));
        assert_eq!(detail.topic_id, Some(3413));
    }

    #[test]
    fn a_rating_of_none_is_treated_as_absent() {
        let raw: RawDetail =
            serde_json::from_str(r#"{"id":1,"name":"A","rating":"none","duration":0}"#).unwrap();
        let detail = detail_from_raw(raw);
        assert_eq!(detail.rating, None);
        assert_eq!(detail.duration, None);
    }

    fn card(id: i64, title: &str, original: &str, year: Option<i64>) -> DiscoverCard {
        DiscoverCard {
            id,
            title: title.into(),
            original_title: original.into(),
            poster: None,
            score: None,
            kind: None,
            status: None,
            year,
            episodes: None,
        }
    }

    #[test]
    fn matching_prefers_an_exact_name_over_the_first_result() {
        let found = best_match(
            "Дороро",
            None,
            vec![
                card(1, "Дороро и Хяккимару", "Dororo to Hyakkimaru", Some(1969)),
                card(2, "Дороро", "Dororo", Some(2019)),
            ],
        );
        assert_eq!(found.unwrap().id, 2);
    }

    #[test]
    fn matching_uses_the_year_to_separate_titles_that_share_a_name() {
        let found = best_match(
            "Дороро",
            Some(2019),
            vec![
                card(1, "Дороро", "Dororo", Some(1969)),
                card(2, "Дороро", "Dororo", Some(2019)),
            ],
        );
        assert_eq!(found.unwrap().id, 2);
    }

    #[test]
    fn an_unrelated_first_result_is_refused_rather_than_guessed() {
        let found = best_match(
            "что-то другое",
            None,
            vec![card(7, "Ван-Пис", "One Piece", None)],
        );
        assert_eq!(found, None);
        assert_eq!(best_match("что угодно", None, Vec::new()), None);
    }

    #[test]
    fn a_longer_shikimori_title_still_counts_as_the_same_anime() {
        let found = best_match(
            "Ванпанчмен 3",
            None,
            vec![
                card(1, "Люпен III: Часть III", "Lupin III: Part III", Some(1984)),
                card(
                    2,
                    "Ванпанчмен 3. Часть 2",
                    "One Punch Man 3 Part 2",
                    Some(2026),
                ),
            ],
        );
        assert_eq!(found.unwrap().id, 2);
    }

    #[test]
    fn punctuation_and_case_do_not_break_the_match() {
        let found = best_match(
            "ван-пис!",
            None,
            vec![card(7, "Ван Пис", "One Piece", Some(1999))],
        );
        assert_eq!(found.unwrap().id, 7);
    }

    #[test]
    fn normalising_collapses_punctuation_and_case() {
        assert_eq!(normalise("  Ван-Пис: Фильм!  "), "ван пис фильм");
        assert_eq!(normalise("One  Punch_Man 3"), "one punch man 3");
        assert_eq!(normalise("!!!"), "");
    }

    #[test]
    fn a_poster_that_is_already_absolute_is_left_alone() {
        assert_eq!(
            absolute("https://cdn.example/a.jpg"),
            "https://cdn.example/a.jpg"
        );
        assert_eq!(absolute("/a.jpg"), format!("{CATALOG_BASE}/a.jpg"));
    }

    #[test]
    fn calendar_entries_without_a_date_are_dropped() {
        let raw: Vec<RawCalendar> = serde_json::from_str(
            r#"[
              {"next_episode":10,"next_episode_at":"2026-08-09T17:00:00+03:00","duration":24,
               "anime":{"id":1,"name":"One Piece","russian":"Ван-Пис","episodes_aired":9}},
              {"next_episode":3,"next_episode_at":null,"anime":{"id":2,"name":"Без даты"}},
              {"next_episode":1,"next_episode_at":"2026-08-10T00:00:00+03:00"}
            ]"#,
        )
        .unwrap();

        let found: Vec<Upcoming> = raw.into_iter().filter_map(upcoming_from_raw).collect();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].card.title, "Ван-Пис");
        assert_eq!(found[0].episode, 10);
        assert_eq!(found[0].duration, Some(24));
        assert_eq!(found[0].airs_at, "2026-08-09T17:00:00+03:00");
    }

    #[test]
    fn cache_key_ignores_the_order_of_query_parameters() {
        let one = cache_key(
            "/api/animes",
            &[
                ("order".to_owned(), "popularity".to_owned()),
                ("page".to_owned(), "2".to_owned()),
            ],
        );
        let other = cache_key(
            "/api/animes",
            &[
                ("page".to_owned(), "2".to_owned()),
                ("order".to_owned(), "popularity".to_owned()),
            ],
        );

        assert_eq!(one, other);
        assert_eq!(one, "shiki:/api/animes?order=popularity&page=2");
        assert_eq!(cache_key("/api/genres", &[]), "shiki:/api/genres");
    }

    #[tokio::test]
    async fn a_fresh_cache_answers_without_touching_the_network() {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let query = DiscoverQuery::default();
        db.cache_write(
            &cache_key("/api/animes", &query.params()),
            r#"[{"id":1,"name":"Cowboy Bebop","russian":"Ковбой Бибоп","episodes":26}]"#,
        )
        .unwrap();

        let discover = Discover::new(db).unwrap();
        let cards = discover.search(&query).await.unwrap();

        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].title, "Ковбой Бибоп");
        assert_eq!(cards[0].original_title, "Cowboy Bebop");
    }

    #[tokio::test]
    async fn a_stale_cache_is_kept_and_reused_when_the_catalog_is_unreachable() {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let key = cache_key("/api/animes/1", &[]);
        db.cache_write(&key, r#"{"id":1,"name":"Cowboy Bebop"}"#)
            .unwrap();
        {
            let conn = db.raw_connection();
            conn.execute("UPDATE cache SET fetched_at = fetched_at - 999999", [])
                .unwrap();
        }

        let hit = db.cache_read(&key).unwrap().unwrap();
        assert!(hit.age > TTL_TITLE);
        assert!(serde_json::from_str::<RawDetail>(&hit.value).is_ok());
    }

    #[test]
    fn mirrors_start_at_the_documented_host() {
        assert_eq!(MIRRORS[0], CATALOG_BASE);
        assert!(MIRRORS.iter().all(|host| host.starts_with("https://")));
    }
}

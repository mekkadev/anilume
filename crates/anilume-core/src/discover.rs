use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error::{CoreError, Result};

pub const CATALOG_BASE: &str = "https://shikimori.one";

const MIN_REQUEST_GAP: Duration = Duration::from_millis(240);
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
        let (low, high) = if low <= high { (low, high) } else { (high, low) };

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
    score: Option<String>,
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

fn absolute(path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        path.to_owned()
    } else {
        format!("{CATALOG_BASE}{path}")
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
        score: raw
            .score
            .as_deref()
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| *value > 0.0),
        kind: raw.kind,
        status: raw.status,
        year: raw
            .aired_on
            .as_deref()
            .and_then(|date| date.get(..4))
            .and_then(|year| year.parse::<i64>().ok()),
        episodes: raw.episodes.filter(|count| *count > 0).or(raw
            .episodes_aired
            .filter(|count| *count > 0)),
    }
}

pub struct Discover {
    http: reqwest::Client,
    throttle: Mutex<Option<Instant>>,
    options: Mutex<Option<DiscoverOptions>>,
}

impl Discover {
    pub fn new() -> Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()?,
            throttle: Mutex::new(None),
            options: Mutex::new(None),
        })
    }

    pub async fn search(&self, query: &DiscoverQuery) -> Result<Vec<DiscoverCard>> {
        let raw: Vec<RawAnime> = self.fetch("/api/animes", &query.params()).await?;
        Ok(raw.into_iter().map(card_from_raw).collect())
    }

    pub async fn options(&self) -> Result<DiscoverOptions> {
        if let Some(cached) = self.options.lock().await.clone() {
            return Ok(cached);
        }

        let genres: Vec<RawGenre> = self.fetch("/api/genres", &[]).await?;
        let studios: Vec<RawStudio> = self.fetch("/api/studios", &[]).await?;

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
        genres.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

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
        studios.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        let options = DiscoverOptions { genres, studios };
        *self.options.lock().await = Some(options.clone());
        Ok(options)
    }

    async fn fetch<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        params: &[(String, String)],
    ) -> Result<T> {
        self.pace().await;

        let response = self
            .http
            .get(format!("{CATALOG_BASE}{path}"))
            .query(params)
            .header(reqwest::header::USER_AGENT, "anilume")
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await?;

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

        let text = response.text().await?;
        serde_json::from_str(&text)
            .map_err(|e| CoreError::Other(format!("Каталог Shikimori вернул не JSON: {e}")))
    }

    async fn pace(&self) {
        let mut last = self.throttle.lock().await;
        if let Some(previous) = *last {
            let elapsed = previous.elapsed();
            if elapsed < MIN_REQUEST_GAP {
                tokio::time::sleep(MIN_REQUEST_GAP - elapsed).await;
            }
        }
        *last = Some(Instant::now());
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
    fn a_poster_that_is_already_absolute_is_left_alone() {
        assert_eq!(absolute("https://cdn.example/a.jpg"), "https://cdn.example/a.jpg");
        assert_eq!(absolute("/a.jpg"), format!("{CATALOG_BASE}/a.jpg"));
    }
}

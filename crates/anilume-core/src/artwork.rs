use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::db::Db;
use crate::error::{CoreError, Result};

pub const ARTWORK_API: &str = "https://graphql.anilist.co";

const MIN_REQUEST_GAP: Duration = Duration::from_millis(800);
const BATCH: usize = 50;
const MAX_IDS: usize = 200;

const TTL_ART: i64 = 30 * 24 * 60 * 60;
const TTL_ART_EMPTY: i64 = 3 * 24 * 60 * 60;

const QUERY: &str = "query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(idMal_in: $ids, type: ANIME) {
      idMal
      bannerImage
      coverImage { extraLarge }
    }
  }
}";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    pub mal_id: i64,
    pub cover: Option<String>,
    pub banner: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawCover {
    #[serde(rename = "extraLarge")]
    extra_large: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawMedia {
    #[serde(rename = "idMal")]
    id_mal: Option<i64>,
    #[serde(rename = "bannerImage")]
    banner_image: Option<String>,
    #[serde(rename = "coverImage")]
    cover_image: Option<RawCover>,
}

#[derive(Debug, Deserialize)]
struct RawPage {
    #[serde(default)]
    media: Vec<RawMedia>,
}

#[derive(Debug, Deserialize)]
struct RawData {
    #[serde(rename = "Page")]
    page: Option<RawPage>,
}

#[derive(Debug, Deserialize)]
struct RawResponse {
    #[serde(default)]
    data: Option<RawData>,
}

fn clean(value: Option<String>) -> Option<String> {
    value.filter(|text| text.starts_with("http"))
}

fn artwork_from_raw(raw: RawMedia) -> Option<Artwork> {
    let mal_id = raw.id_mal?;
    Some(Artwork {
        mal_id,
        cover: clean(raw.cover_image.and_then(|cover| cover.extra_large)),
        banner: clean(raw.banner_image),
    })
}

fn art_key(mal_id: i64) -> String {
    format!("art:{mal_id}")
}

pub fn wanted(ids: &[i64], known: &HashMap<i64, Artwork>) -> Vec<i64> {
    let mut seen = Vec::new();
    for id in ids {
        if *id <= 0 || known.contains_key(id) || seen.contains(id) {
            continue;
        }
        seen.push(*id);
        if seen.len() >= MAX_IDS {
            break;
        }
    }
    seen
}

pub struct Artworks {
    http: reqwest::Client,
    db: Arc<Db>,
    throttle: Mutex<Option<Instant>>,
    cache: Mutex<HashMap<i64, Artwork>>,
}

impl Artworks {
    pub fn new(db: Arc<Db>) -> Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()?,
            db,
            throttle: Mutex::new(None),
            cache: Mutex::new(HashMap::new()),
        })
    }

    pub async fn lookup(&self, ids: &[i64]) -> Result<Vec<Artwork>> {
        let missing = {
            let mut cache = self.cache.lock().await;
            self.warm(ids, &mut cache);
            wanted(ids, &cache)
        };

        for chunk in missing.chunks(BATCH) {
            let fetched = self.fetch(chunk).await;
            let answered = fetched.is_ok();
            let fetched = fetched.unwrap_or_default();

            let mut cache = self.cache.lock().await;
            if answered {
                for id in chunk {
                    cache.entry(*id).or_insert_with(|| Artwork {
                        mal_id: *id,
                        cover: None,
                        banner: None,
                    });
                }
            }
            for art in fetched {
                cache.insert(art.mal_id, art);
            }

            if answered {
                for id in chunk {
                    if let Some(art) = cache.get(id) {
                        if let Ok(value) = serde_json::to_string(art) {
                            let _ = self.db.cache_write(&art_key(*id), &value);
                        }
                    }
                }
            }
        }

        let cache = self.cache.lock().await;
        Ok(ids
            .iter()
            .filter_map(|id| cache.get(id).cloned())
            .filter(|art| art.cover.is_some() || art.banner.is_some())
            .collect())
    }

    fn warm(&self, ids: &[i64], cache: &mut HashMap<i64, Artwork>) {
        for id in ids {
            if *id <= 0 || cache.contains_key(id) {
                continue;
            }
            let Ok(Some(hit)) = self.db.cache_read(&art_key(*id)) else {
                continue;
            };
            let Ok(art) = serde_json::from_str::<Artwork>(&hit.value) else {
                continue;
            };
            let ttl = if art.cover.is_some() || art.banner.is_some() {
                TTL_ART
            } else {
                TTL_ART_EMPTY
            };
            if hit.age <= ttl {
                cache.insert(*id, art);
            }
        }
    }

    async fn fetch(&self, ids: &[i64]) -> Result<Vec<Artwork>> {
        self.pace().await;

        let response = self
            .http
            .post(ARTWORK_API)
            .header(reqwest::header::USER_AGENT, "anilume")
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&serde_json::json!({ "query": QUERY, "variables": { "ids": ids } }))
            .send()
            .await?;

        let status = response.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(CoreError::Network(
                "AniList ограничил частоту запросов за обложками".into(),
            ));
        }
        if !status.is_success() {
            return Err(CoreError::Network(format!("AniList ответил {status}")));
        }

        let parsed: RawResponse = response.json().await?;
        Ok(parsed
            .data
            .and_then(|data| data.page)
            .map(|page| page.media)
            .unwrap_or_default()
            .into_iter()
            .filter_map(artwork_from_raw)
            .collect())
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

    fn art(id: i64) -> Artwork {
        Artwork {
            mal_id: id,
            cover: Some("https://cdn/c.jpg".into()),
            banner: None,
        }
    }

    #[test]
    fn only_unknown_positive_ids_are_requested() {
        let mut known = HashMap::new();
        known.insert(21, art(21));

        assert_eq!(wanted(&[21, 16498, 0, -3, 20], &known), vec![16498, 20]);
    }

    #[test]
    fn duplicates_are_asked_for_once() {
        let known = HashMap::new();
        assert_eq!(wanted(&[5, 5, 7, 5], &known), vec![5, 7]);
    }

    #[test]
    fn the_request_size_is_bounded() {
        let known = HashMap::new();
        let ids: Vec<i64> = (1..=400).collect();
        assert_eq!(wanted(&ids, &known).len(), MAX_IDS);
    }

    #[test]
    fn a_media_entry_without_a_mal_id_is_dropped() {
        let raw: RawMedia = serde_json::from_str(
            r#"{"idMal":null,"bannerImage":"https://cdn/b.jpg","coverImage":{"extraLarge":"https://cdn/c.jpg"}}"#,
        )
        .unwrap();
        assert_eq!(artwork_from_raw(raw), None);
    }

    #[test]
    fn relative_or_missing_urls_are_treated_as_absent() {
        let raw: RawMedia = serde_json::from_str(
            r#"{"idMal":21,"bannerImage":null,"coverImage":{"extraLarge":"/local.jpg"}}"#,
        )
        .unwrap();

        let found = artwork_from_raw(raw).unwrap();
        assert_eq!(found.mal_id, 21);
        assert_eq!(found.cover, None);
        assert_eq!(found.banner, None);
    }

    #[test]
    fn a_full_entry_keeps_both_images() {
        let raw: RawMedia = serde_json::from_str(
            r#"{"idMal":16498,"bannerImage":"https://cdn/b.jpg","coverImage":{"extraLarge":"https://cdn/c.jpg"}}"#,
        )
        .unwrap();

        let found = artwork_from_raw(raw).unwrap();
        assert_eq!(found.banner.as_deref(), Some("https://cdn/b.jpg"));
        assert_eq!(found.cover.as_deref(), Some("https://cdn/c.jpg"));
    }

    #[test]
    fn an_empty_page_parses_into_nothing() {
        let parsed: RawResponse =
            serde_json::from_str(r#"{"data":{"Page":{"media":[]}}}"#).unwrap();
        assert!(parsed
            .data
            .and_then(|d| d.page)
            .map(|p| p.media.is_empty())
            .unwrap_or(false));
    }

    #[test]
    fn an_error_shaped_response_does_not_explode() {
        let parsed: RawResponse =
            serde_json::from_str(r#"{"errors":[{"message":"Too Many Requests"}]}"#).unwrap();
        assert!(parsed.data.is_none());
    }
}

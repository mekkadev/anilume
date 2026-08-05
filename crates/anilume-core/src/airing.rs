use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::discover::Upcoming;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Aired {
    pub shikimori_id: i64,
    pub title: String,
    pub episode: i64,
}

pub fn watched_ids<'a>(entries: impl IntoIterator<Item = (&'a str, Option<i64>)>) -> HashSet<i64> {
    entries
        .into_iter()
        .filter(|(status, _)| matches!(*status, "watching" | "planned" | "on_hold"))
        .filter_map(|(_, id)| id)
        .filter(|id| *id > 0)
        .collect()
}

pub fn newly_aired(
    calendar: &[Upcoming],
    followed: &HashSet<i64>,
    seen: &HashMap<i64, i64>,
) -> (Vec<Aired>, HashMap<i64, i64>) {
    let mut found = Vec::new();
    let mut next = seen.clone();

    for entry in calendar {
        let id = entry.card.id;
        if !followed.contains(&id) || entry.episode <= 0 {
            continue;
        }

        match seen.get(&id) {
            Some(previous) if entry.episode > *previous => {
                found.push(Aired {
                    shikimori_id: id,
                    title: entry.card.title.clone(),
                    episode: entry.episode - 1,
                });
            }
            _ => {}
        }

        next.insert(id, entry.episode);
    }

    found.sort_by_key(|entry| entry.shikimori_id);
    (found, next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discover::DiscoverCard;

    fn upcoming(id: i64, title: &str, episode: i64) -> Upcoming {
        Upcoming {
            card: DiscoverCard {
                id,
                title: title.to_owned(),
                original_title: title.to_owned(),
                poster: None,
                score: None,
                kind: None,
                status: None,
                year: None,
                episodes: None,
            },
            episode,
            airs_at: "2026-08-09T17:00:00+03:00".to_owned(),
            duration: None,
        }
    }

    #[test]
    fn only_active_statuses_are_followed() {
        let ids = watched_ids(vec![
            ("watching", Some(1)),
            ("planned", Some(2)),
            ("on_hold", Some(3)),
            ("completed", Some(4)),
            ("dropped", Some(5)),
            ("watching", None),
            ("watching", Some(0)),
        ]);

        assert_eq!(ids, HashSet::from([1, 2, 3]));
    }

    #[test]
    fn the_first_pass_only_remembers_and_never_notifies() {
        let followed = HashSet::from([1, 2]);
        let calendar = vec![upcoming(1, "Ван-Пис", 10), upcoming(2, "Наруто", 4)];

        let (found, seen) = newly_aired(&calendar, &followed, &HashMap::new());

        assert!(found.is_empty());
        assert_eq!(seen, HashMap::from([(1, 10), (2, 4)]));
    }

    #[test]
    fn a_grown_counter_means_the_previous_episode_aired() {
        let followed = HashSet::from([1, 2]);
        let seen = HashMap::from([(1, 10), (2, 4)]);
        let calendar = vec![upcoming(1, "Ван-Пис", 11), upcoming(2, "Наруто", 4)];

        let (found, next) = newly_aired(&calendar, &followed, &seen);

        assert_eq!(
            found,
            vec![Aired {
                shikimori_id: 1,
                title: "Ван-Пис".to_owned(),
                episode: 10,
            }]
        );
        assert_eq!(next, HashMap::from([(1, 11), (2, 4)]));
    }

    #[test]
    fn titles_outside_the_library_are_ignored() {
        let followed = HashSet::from([1]);
        let seen = HashMap::from([(1, 10), (9, 2)]);
        let calendar = vec![upcoming(9, "Чужое", 3), upcoming(1, "Ван-Пис", 10)];

        let (found, next) = newly_aired(&calendar, &followed, &seen);

        assert!(found.is_empty());
        assert_eq!(next.get(&9), Some(&2));
    }

    #[test]
    fn a_counter_that_went_backwards_does_not_notify() {
        let followed = HashSet::from([1]);
        let seen = HashMap::from([(1, 12)]);
        let calendar = vec![upcoming(1, "Ван-Пис", 11)];

        let (found, next) = newly_aired(&calendar, &followed, &seen);

        assert!(found.is_empty());
        assert_eq!(next, HashMap::from([(1, 11)]));
    }
}

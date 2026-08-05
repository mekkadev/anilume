pub mod artwork;
pub mod db;
pub mod discover;
pub mod downloads;
pub mod error;
pub mod proxy;
pub mod shikimori;
pub mod sidecar;

pub use artwork::{Artwork, Artworks};
pub use db::{CacheStats, Cached, ContinueItem, Db, LibraryEntry, WatchProgress};
pub use discover::{Discover, DiscoverCard, DiscoverOptions, DiscoverQuery};
pub use downloads::{DownloadEvent, DownloadItem, DownloadManager, DownloadRequest};
pub use error::{CoreError, ErrorPayload, Result};
pub use proxy::ProxyHandle;
pub use shikimori::{Account, Shikimori, ShikimoriConfig, UserRate};
pub use sidecar::{SidecarClient, SidecarSpec};

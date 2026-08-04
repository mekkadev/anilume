pub mod db;
pub mod downloads;
pub mod error;
pub mod proxy;
pub mod shikimori;
pub mod sidecar;

pub use db::{ContinueItem, Db, LibraryEntry, WatchProgress};
pub use downloads::{DownloadEvent, DownloadItem, DownloadManager, DownloadRequest};
pub use error::{CoreError, ErrorPayload, Result};
pub use proxy::ProxyHandle;
pub use shikimori::{Account, Shikimori, ShikimoriConfig, UserRate};
pub use sidecar::{SidecarClient, SidecarSpec};

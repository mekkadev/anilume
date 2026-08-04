use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("Сайдкар не запущен")]
    SidecarDown,

    #[error("Сайдкар не ответил вовремя")]
    SidecarTimeout,

    #[error("{message}")]
    Upstream {
        code: i32,
        message: String,
        data: Option<serde_json::Value>,
    },

    #[error("Сессия просмотра устарела — откройте тайтл заново")]
    HandleExpired,

    #[error("Ошибка сети: {0}")]
    Network(String),

    #[error("Ошибка локальной базы: {0}")]
    Database(String),

    #[error("Требуется вход в Shikimori")]
    ShikimoriUnauthorized,

    #[error("Shikimori не настроен: укажите Client ID приложения в настройках")]
    ShikimoriNotConfigured,

    #[error("{0}")]
    Other(String),
}

pub const SIDECAR_HANDLE_EXPIRED: i32 = -32001;

impl CoreError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::SidecarDown => "sidecarDown",
            Self::SidecarTimeout => "sidecarTimeout",
            Self::Upstream { code, .. } if *code == SIDECAR_HANDLE_EXPIRED => "handleExpired",
            Self::Upstream { .. } => "upstream",
            Self::HandleExpired => "handleExpired",
            Self::Network(_) => "network",
            Self::Database(_) => "database",
            Self::ShikimoriUnauthorized => "shikimoriUnauthorized",
            Self::ShikimoriNotConfigured => "shikimoriNotConfigured",
            Self::Other(_) => "other",
        }
    }

    pub fn hint(&self) -> Option<String> {
        match self {
            Self::Upstream { data: Some(d), .. } => {
                d.get("hint").and_then(|h| h.as_str()).map(String::from)
            }
            _ => None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub kind: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

impl From<&CoreError> for ErrorPayload {
    fn from(err: &CoreError) -> Self {
        Self {
            kind: err.kind(),
            message: err.to_string(),
            hint: err.hint(),
        }
    }
}

impl Serialize for CoreErrorWire {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        ErrorPayload::from(&self.0).serialize(serializer)
    }
}

pub struct CoreErrorWire(pub CoreError);

impl From<CoreError> for CoreErrorWire {
    fn from(err: CoreError) -> Self {
        Self(err)
    }
}

impl From<rusqlite::Error> for CoreError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Database(err.to_string())
    }
}

impl From<reqwest::Error> for CoreError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::Network("превышено время ожидания".into())
        } else {
            Self::Network(err.to_string())
        }
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

use crate::db::Db;
use crate::error::{CoreError, Result};

pub const OAUTH_BASE: &str = "https://shikimori.one";
pub const OOB_REDIRECT: &str = "urn:ietf:wg:oauth:2.0:oob";
pub const SCOPE: &str = "user_rates";

const SETTING_CONFIG: &str = "shikimori.config";
const SETTING_TOKENS: &str = "shikimori.tokens";

const MIN_REQUEST_GAP: Duration = Duration::from_millis(220);
const TOKEN_SKEW_SEC: i64 = 120;
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShikimoriConfig {
    pub client_id: String,
    pub client_secret: String,
    #[serde(default = "default_redirect")]
    pub redirect_uri: String,
    #[serde(default = "default_user_agent")]
    pub user_agent: String,
}

fn default_redirect() -> String {
    OOB_REDIRECT.to_owned()
}

fn default_user_agent() -> String {
    "anilume".to_owned()
}

impl ShikimoriConfig {
    pub fn is_oob(&self) -> bool {
        self.redirect_uri == OOB_REDIRECT
    }

    fn loopback_port(&self) -> Result<u16> {
        url::Url::parse(&self.redirect_uri)
            .ok()
            .and_then(|u| u.port())
            .ok_or_else(|| {
                CoreError::Other(
                    "В redirect_uri нужно указать явный порт, например http://127.0.0.1:53682/"
                        .into(),
                )
            })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
}

impl Tokens {
    fn is_stale(&self) -> bool {
        now() + TOKEN_SKEW_SEC >= self.expires_at
    }
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    pub nickname: String,
    #[serde(default)]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRate {
    #[serde(default)]
    pub id: Option<i64>,
    pub target_id: i64,
    pub status: String,
    #[serde(default)]
    pub episodes: i64,
    #[serde(default)]
    pub score: i64,
}

pub struct Shikimori {
    db: Arc<Db>,
    http: reqwest::Client,
    throttle: Mutex<Option<Instant>>,
}

impl Shikimori {
    pub fn new(db: Arc<Db>) -> Result<Self> {
        Ok(Self {
            db,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()?,
            throttle: Mutex::new(None),
        })
    }

    pub fn save_config(&self, config: &ShikimoriConfig) -> Result<()> {
        let encoded = serde_json::to_string(config).map_err(|e| CoreError::Other(e.to_string()))?;
        self.db.setting_set(SETTING_CONFIG, &encoded)
    }

    pub fn config(&self) -> Result<ShikimoriConfig> {
        let raw = self
            .db
            .setting_get(SETTING_CONFIG)?
            .ok_or(CoreError::ShikimoriNotConfigured)?;
        serde_json::from_str(&raw).map_err(|_| CoreError::ShikimoriNotConfigured)
    }

    pub fn is_configured(&self) -> bool {
        self.config().is_ok()
    }

    pub fn is_logged_in(&self) -> bool {
        self.load_tokens().ok().flatten().is_some()
    }

    pub fn logout(&self) -> Result<()> {
        self.db.setting_delete(SETTING_TOKENS)
    }

    pub fn authorize_url(&self) -> Result<String> {
        let config = self.config()?;
        let mut url = url::Url::parse(&format!("{OAUTH_BASE}/oauth/authorize"))
            .map_err(|e| CoreError::Other(e.to_string()))?;
        url.query_pairs_mut()
            .append_pair("client_id", &config.client_id)
            .append_pair("redirect_uri", &config.redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", SCOPE);
        Ok(url.to_string())
    }

    pub async fn login_with_code(&self, code: &str) -> Result<Account> {
        let config = self.config()?;
        let tokens = self
            .request_tokens(
                &config,
                json!({
                    "grant_type": "authorization_code",
                    "client_id": config.client_id,
                    "client_secret": config.client_secret,
                    "code": code.trim(),
                    "redirect_uri": config.redirect_uri,
                }),
            )
            .await?;
        self.store_tokens(&tokens)?;
        self.whoami().await
    }

    pub async fn login_via_loopback<F>(&self, open_browser: F) -> Result<Account>
    where
        F: FnOnce(&str),
    {
        let config = self.config()?;
        if config.is_oob() {
            return Err(CoreError::Other(
                "Для этого способа входа укажите redirect_uri вида http://127.0.0.1:53682/".into(),
            ));
        }

        let port = config.loopback_port()?;
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
            .await
            .map_err(|e| {
                CoreError::Other(format!("Не удалось занять порт {port} для входа: {e}"))
            })?;

        open_browser(&self.authorize_url()?);

        let code = tokio::time::timeout(LOGIN_TIMEOUT, wait_for_code(listener))
            .await
            .map_err(|_| CoreError::Other("Вход не завершён: истекло время ожидания".into()))??;

        self.login_with_code(&code).await
    }

    pub async fn whoami(&self) -> Result<Account> {
        let response = self
            .authorized(reqwest::Method::GET, "/api/users/whoami", None)
            .await?;
        serde_json::from_value(response)
            .map_err(|e| CoreError::Other(format!("Shikimori вернул неожиданный профиль: {e}")))
    }

    pub async fn get_rate(&self, target_id: i64) -> Result<Option<UserRate>> {
        let account = self.whoami().await?;
        let path = format!(
            "/api/v2/user_rates?user_id={}&target_id={target_id}&target_type=Anime",
            account.id
        );
        let response = self.authorized(reqwest::Method::GET, &path, None).await?;
        let rates: Vec<UserRate> = serde_json::from_value(response).unwrap_or_default();
        Ok(rates.into_iter().next())
    }

    pub async fn set_rate(
        &self,
        target_id: i64,
        status: &str,
        episodes: Option<i64>,
        score: Option<i64>,
    ) -> Result<UserRate> {
        let account = self.whoami().await?;
        let mut rate = json!({
            "user_id": account.id,
            "target_id": target_id,
            "target_type": "Anime",
            "status": status,
        });
        if let Some(episodes) = episodes {
            rate["episodes"] = json!(episodes);
        }
        if let Some(score) = score {
            rate["score"] = json!(score);
        }

        let response = self
            .authorized(
                reqwest::Method::POST,
                "/api/v2/user_rates",
                Some(json!({ "user_rate": rate })),
            )
            .await?;
        serde_json::from_value(response)
            .map_err(|e| CoreError::Other(format!("Shikimori вернул неожиданный ответ: {e}")))
    }

    async fn authorized(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        let config = self.config()?;
        let token = self.access_token(&config).await?;
        self.pace().await;

        let mut request = self
            .http
            .request(method, format!("{OAUTH_BASE}{path}"))
            .bearer_auth(&token)
            .header(reqwest::header::USER_AGENT, &config.user_agent);
        if let Some(body) = body {
            request = request.json(&body);
        }

        let response = request.send().await?;
        let status = response.status();

        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(CoreError::ShikimoriUnauthorized);
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(CoreError::Network(
                "Shikimori ограничил частоту запросов — попробуйте через минуту".into(),
            ));
        }
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(CoreError::Network(format!(
                "Shikimori ответил {status}: {}",
                detail.chars().take(200).collect::<String>()
            )));
        }

        let text = response.text().await?;
        if text.trim().is_empty() {
            return Ok(serde_json::Value::Null);
        }
        serde_json::from_str(&text)
            .map_err(|e| CoreError::Other(format!("Shikimori вернул не JSON: {e}")))
    }

    async fn access_token(&self, config: &ShikimoriConfig) -> Result<String> {
        let tokens = self
            .load_tokens()?
            .ok_or(CoreError::ShikimoriUnauthorized)?;
        if !tokens.is_stale() {
            return Ok(tokens.access_token);
        }

        let refreshed = self
            .request_tokens(
                config,
                json!({
                    "grant_type": "refresh_token",
                    "client_id": config.client_id,
                    "client_secret": config.client_secret,
                    "refresh_token": tokens.refresh_token,
                }),
            )
            .await
            .map_err(|_| CoreError::ShikimoriUnauthorized)?;
        self.store_tokens(&refreshed)?;
        Ok(refreshed.access_token)
    }

    async fn request_tokens(
        &self,
        config: &ShikimoriConfig,
        body: serde_json::Value,
    ) -> Result<Tokens> {
        self.pace().await;
        let response = self
            .http
            .post(format!("{OAUTH_BASE}/oauth/token"))
            .header(reqwest::header::USER_AGENT, &config.user_agent)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let detail = response.text().await.unwrap_or_default();
            return Err(CoreError::Other(format!(
                "Shikimori отклонил вход ({status}): {}",
                detail.chars().take(200).collect::<String>()
            )));
        }

        let parsed: TokenResponse = response.json().await?;
        Ok(Tokens {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
            expires_at: now() + parsed.expires_in,
        })
    }

    fn store_tokens(&self, tokens: &Tokens) -> Result<()> {
        let encoded = serde_json::to_string(tokens).map_err(|e| CoreError::Other(e.to_string()))?;
        self.db.setting_set(SETTING_TOKENS, &encoded)
    }

    fn load_tokens(&self) -> Result<Option<Tokens>> {
        Ok(self
            .db
            .setting_get(SETTING_TOKENS)?
            .and_then(|raw| serde_json::from_str(&raw).ok()))
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

async fn wait_for_code(listener: tokio::net::TcpListener) -> Result<String> {
    loop {
        let (stream, _) = listener
            .accept()
            .await
            .map_err(|e| CoreError::Other(format!("Ошибка ожидания ответа Shikimori: {e}")))?;

        let mut reader = BufReader::new(stream);
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).await.is_err() {
            continue;
        }

        let Some(target) = request_line.split_whitespace().nth(1) else {
            continue;
        };
        let Ok(parsed) = url::Url::parse(&format!("http://127.0.0.1{target}")) else {
            continue;
        };

        let params: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        let mut stream = reader.into_inner();

        if let Some(error) = params.get("error") {
            let _ = stream
                .write_all(html_response("Вход отменён").as_bytes())
                .await;
            let _ = stream.flush().await;
            return Err(CoreError::Other(format!(
                "Shikimori отказал во входе: {error}"
            )));
        }

        if let Some(code) = params.get("code") {
            let _ = stream
                .write_all(html_response("Готово — можно вернуться в anilume").as_bytes())
                .await;
            let _ = stream.flush().await;
            return Ok(code.clone());
        }
    }
}

fn html_response(message: &str) -> String {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>anilume</title>\
         <body style=\"margin:0;display:grid;place-items:center;height:100vh;\
         background:#0b0d14;color:#e8eaf2;font:500 18px/1.5 system-ui,sans-serif\">\
         <p>{message}</p></body>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shikimori() -> Shikimori {
        Shikimori::new(Arc::new(Db::open_in_memory().unwrap())).unwrap()
    }

    fn config(redirect: &str) -> ShikimoriConfig {
        ShikimoriConfig {
            client_id: "id-123".into(),
            client_secret: "secret-456".into(),
            redirect_uri: redirect.into(),
            user_agent: "anilume".into(),
        }
    }

    #[test]
    fn unconfigured_client_reports_it() {
        let client = shikimori();
        assert!(!client.is_configured());
        assert_eq!(
            client.config().unwrap_err().kind(),
            "shikimoriNotConfigured"
        );
    }

    #[test]
    fn config_roundtrips_through_the_database() {
        let client = shikimori();
        client.save_config(&config(OOB_REDIRECT)).unwrap();

        let loaded = client.config().unwrap();
        assert_eq!(loaded.client_id, "id-123");
        assert!(loaded.is_oob());
        assert!(client.is_configured());
    }

    #[test]
    fn authorize_url_carries_every_required_parameter() {
        let client = shikimori();
        client
            .save_config(&config("http://127.0.0.1:53682/"))
            .unwrap();

        let url = url::Url::parse(&client.authorize_url().unwrap()).unwrap();
        let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();

        assert_eq!(url.host_str(), Some("shikimori.one"));
        assert_eq!(url.path(), "/oauth/authorize");
        assert_eq!(params["client_id"], "id-123");
        assert_eq!(params["response_type"], "code");
        assert_eq!(params["scope"], "user_rates");
        assert_eq!(params["redirect_uri"], "http://127.0.0.1:53682/");
    }

    #[test]
    fn authorize_url_never_leaks_the_secret() {
        let client = shikimori();
        client.save_config(&config(OOB_REDIRECT)).unwrap();
        assert!(!client.authorize_url().unwrap().contains("secret-456"));
    }

    #[test]
    fn loopback_port_is_read_from_redirect_uri() {
        assert_eq!(
            config("http://127.0.0.1:53682/").loopback_port().unwrap(),
            53682
        );
        assert!(config(OOB_REDIRECT).loopback_port().is_err());
        assert!(config("http://127.0.0.1/").loopback_port().is_err());
    }

    #[test]
    fn tokens_are_stale_before_they_actually_expire() {
        let fresh = Tokens {
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at: now() + 3600,
        };
        let expiring = Tokens {
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at: now() + 30,
        };
        assert!(!fresh.is_stale());
        assert!(expiring.is_stale());
    }

    #[test]
    fn logout_clears_stored_tokens() {
        let client = shikimori();
        client
            .store_tokens(&Tokens {
                access_token: "a".into(),
                refresh_token: "r".into(),
                expires_at: now() + 3600,
            })
            .unwrap();
        assert!(client.is_logged_in());

        client.logout().unwrap();
        assert!(!client.is_logged_in());
    }

    #[tokio::test]
    async fn calls_without_tokens_ask_for_login() {
        let client = shikimori();
        client.save_config(&config(OOB_REDIRECT)).unwrap();
        assert_eq!(
            client.whoami().await.unwrap_err().kind(),
            "shikimoriUnauthorized"
        );
    }

    #[tokio::test]
    async fn loopback_login_rejects_oob_redirect() {
        let client = shikimori();
        client.save_config(&config(OOB_REDIRECT)).unwrap();
        assert!(client.login_via_loopback(|_| {}).await.is_err());
    }

    #[tokio::test]
    async fn loopback_listener_extracts_code_from_callback() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();

        let waiter = tokio::spawn(wait_for_code(listener));
        let mut client = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        client
            .write_all(b"GET /?code=abc123&state=x HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .unwrap();

        assert_eq!(waiter.await.unwrap().unwrap(), "abc123");
    }

    #[tokio::test]
    async fn loopback_listener_reports_denied_access() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();

        let waiter = tokio::spawn(wait_for_code(listener));
        let mut client = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        client
            .write_all(b"GET /?error=access_denied HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .unwrap();

        assert!(waiter.await.unwrap().is_err());
    }
}

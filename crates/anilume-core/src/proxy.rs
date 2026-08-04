use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use dashmap::DashMap;
use futures_util::TryStreamExt;
use url::Url;

use crate::error::{CoreError, Result};

const SKIPPED_RESPONSE_HEADERS: &[HeaderName] = &[
    header::CONTENT_LENGTH,
    header::CONTENT_ENCODING,
    header::TRANSFER_ENCODING,
    header::CONNECTION,
];

#[derive(Clone)]
pub struct ProxyHandle {
    inner: Arc<ProxyInner>,
}

struct ProxyInner {
    sessions: DashMap<String, Arc<HashMap<String, String>>>,
    client: reqwest::Client,
    addr: SocketAddr,
}

impl ProxyHandle {
    pub async fn start() -> Result<Self> {
        let client = reqwest::Client::builder()

            .connect_timeout(Duration::from_secs(15))
            .pool_idle_timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| CoreError::Network(e.to_string()))?;

        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|e| CoreError::Other(format!("Не удалось открыть локальный порт: {e}")))?;
        let addr = listener
            .local_addr()
            .map_err(|e| CoreError::Other(e.to_string()))?;

        let inner = Arc::new(ProxyInner {
            sessions: DashMap::new(),
            client,
            addr,
        });

        let router = Router::new()
            .route("/s/{session}/{target}", get(handle_stream))
            .with_state(inner.clone());

        tokio::spawn(async move {
            if let Err(err) = axum::serve(listener, router).await {
                tracing::error!("прокси остановлен: {err}");
            }
        });

        tracing::info!("прокси слушает {addr}");
        Ok(Self { inner })
    }

    pub fn addr(&self) -> SocketAddr {
        self.inner.addr
    }

    pub fn open_session(&self, headers: HashMap<String, String>) -> String {
        let session = uuid::Uuid::new_v4().to_string();
        self.inner.sessions.insert(session.clone(), Arc::new(headers));
        session
    }

    pub fn close_session(&self, session: &str) {
        self.inner.sessions.remove(session);
    }

    pub fn session_count(&self) -> usize {
        self.inner.sessions.len()
    }

    pub fn proxied_url(&self, session: &str, target: &str) -> String {
        proxied_url_for(self.inner.addr, session, target)
    }
}

fn proxied_url_for(addr: SocketAddr, session: &str, target: &str) -> String {
    let encoded = URL_SAFE_NO_PAD.encode(target.as_bytes());
    format!("http://{addr}/s/{session}/{encoded}")
}

async fn handle_stream(
    State(state): State<Arc<ProxyInner>>,
    Path((session, encoded)): Path<(String, String)>,
    request_headers: HeaderMap,
) -> Response {
    let Some(upstream_headers) = state.sessions.get(&session).map(|e| e.clone()) else {
        return (StatusCode::GONE, "Сессия воспроизведения закрыта").into_response();
    };

    let Ok(target) = decode_target(&encoded) else {
        return (StatusCode::BAD_REQUEST, "Некорректный адрес").into_response();
    };

    let mut request = state.client.get(target.clone());
    for (name, value) in upstream_headers.iter() {
        request = request.header(name, value);
    }

    if let Some(range) = request_headers.get(header::RANGE) {
        request = request.header(header::RANGE, range);
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(err) => {
            tracing::warn!("прокси не смог получить {target}: {err}");
            return (StatusCode::BAD_GATEWAY, "Источник видео недоступен").into_response();
        }
    };

    let status = StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::OK);
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned();

    if is_playlist(&target, &content_type) {
        return rewrite_playlist_response(&state, &session, target, status, response).await;
    }

    let mut builder = Response::builder().status(status);
    for (name, value) in response.headers() {
        if SKIPPED_RESPONSE_HEADERS.contains(name) {
            continue;
        }
        builder = builder.header(name, value);
    }

    builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));

    let stream = response.bytes_stream().map_err(std::io::Error::other);
    builder
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn rewrite_playlist_response(
    state: &Arc<ProxyInner>,
    session: &str,
    target: Url,
    status: StatusCode,
    response: reqwest::Response,
) -> Response {
    let body = match response.text().await {
        Ok(body) => body,
        Err(err) => {
            tracing::warn!("не удалось прочитать плейлист {target}: {err}");
            return (StatusCode::BAD_GATEWAY, "Плейлист не читается").into_response();
        }
    };

    let addr = state.addr;
    let rewritten = rewrite_playlist(&body, &target, |resolved| {
        proxied_url_for(addr, session, resolved)
    });

    (
        status,
        [
            (header::CONTENT_TYPE, "application/vnd.apple.mpegurl"),
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        rewritten,
    )
        .into_response()
}

fn decode_target(encoded: &str) -> std::result::Result<Url, ()> {
    let bytes = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| ())?;
    let text = String::from_utf8(bytes).map_err(|_| ())?;
    let url = Url::parse(&text).map_err(|_| ())?;

    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err(()),
    }
}

fn is_playlist(target: &Url, content_type: &str) -> bool {
    if content_type.to_ascii_lowercase().contains("mpegurl") {
        return true;
    }
    let path = target.path().to_ascii_lowercase();
    path.ends_with(".m3u8") || path.ends_with(".m3u")
}

pub fn rewrite_playlist<F>(body: &str, base: &Url, make_url: F) -> String
where
    F: Fn(&str) -> String,
{
    let mut out = String::with_capacity(body.len() * 2);

    for line in body.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            out.push('\n');
            continue;
        }

        if let Some(stripped) = trimmed.strip_prefix('#') {
            out.push_str(&rewrite_uri_attributes(stripped, base, &make_url));
            out.push('\n');
            continue;
        }

        match base.join(trimmed) {
            Ok(resolved) => out.push_str(&make_url(resolved.as_str())),

            Err(_) => out.push_str(trimmed),
        }
        out.push('\n');
    }

    out
}

fn rewrite_uri_attributes<F>(tag_body: &str, base: &Url, make_url: &F) -> String
where
    F: Fn(&str) -> String,
{
    const NEEDLE: &str = "URI=\"";

    let mut out = String::with_capacity(tag_body.len() + 1);
    out.push('#');

    let mut rest = tag_body;
    while let Some(start) = rest.find(NEEDLE) {
        let value_start = start + NEEDLE.len();
        let Some(len) = rest[value_start..].find('"') else {
            break;
        };
        let value = &rest[value_start..value_start + len];

        out.push_str(&rest[..value_start]);
        match base.join(value) {
            Ok(resolved) => out.push_str(&make_url(resolved.as_str())),
            Err(_) => out.push_str(value),
        }
        out.push('"');

        rest = &rest[value_start + len + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("https://cdn.example.com/hls/anime/master.m3u8").unwrap()
    }

    fn proxied(url: &str) -> String {
        format!("http://127.0.0.1:9999/s/sess/{}", URL_SAFE_NO_PAD.encode(url))
    }

    fn decode_first_target(rendered: &str) -> String {
        const MARKER: &str = "/s/sess/";
        let start = rendered.find(MARKER).unwrap() + MARKER.len();
        let encoded: String = rendered[start..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        String::from_utf8(URL_SAFE_NO_PAD.decode(&encoded).unwrap()).unwrap()
    }

    #[test]
    fn relative_segment_is_resolved_against_playlist_url() {
        let playlist = "#EXTM3U\n#EXTINF:5.0,\nseg-1.ts\n";
        let out = rewrite_playlist(playlist, &base(), proxied);
        assert_eq!(
            decode_first_target(&out),
            "https://cdn.example.com/hls/anime/seg-1.ts"
        );
    }

    #[test]
    fn parent_relative_path_is_resolved() {
        let playlist = "../other/seg.ts\n";
        let out = rewrite_playlist(playlist, &base(), proxied);
        assert_eq!(
            decode_first_target(&out),
            "https://cdn.example.com/hls/other/seg.ts"
        );
    }

    #[test]
    fn absolute_urls_are_kept_intact() {
        let playlist = "https://other.cdn/x/seg.ts\n";
        let out = rewrite_playlist(playlist, &base(), proxied);
        assert_eq!(decode_first_target(&out), "https://other.cdn/x/seg.ts");
    }

    #[test]
    fn variant_playlists_go_through_proxy() {
        let playlist = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n360/index.m3u8\n";
        let out = rewrite_playlist(playlist, &base(), proxied);
        assert!(out.contains("#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360"));
        assert_eq!(
            decode_first_target(&out),
            "https://cdn.example.com/hls/anime/360/index.m3u8"
        );
    }

    #[test]
    fn encryption_key_uri_is_rewritten() {
        let playlist = "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\",IV=0x1234\n";
        let out = rewrite_playlist(playlist, &base(), proxied);
        assert!(out.starts_with("#EXT-X-KEY:METHOD=AES-128,URI=\"http://127.0.0.1:9999/s/sess/"));

        assert!(out.contains(",IV=0x1234"));
        assert_eq!(
            decode_first_target(&out),
            "https://cdn.example.com/hls/anime/key.bin"
        );
    }

    #[test]
    fn media_tag_with_several_attributes_keeps_shape() {
        let playlist = "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",NAME=\"Русский\",URI=\"ru/audio.m3u8\",DEFAULT=YES\n";
        let out = rewrite_playlist(playlist, &base(), proxied);
        assert!(out.contains("NAME=\"Русский\""));
        assert!(out.contains(",DEFAULT=YES"));
        assert_eq!(
            decode_first_target(&out),
            "https://cdn.example.com/hls/anime/ru/audio.m3u8"
        );
    }

    #[test]
    fn plain_tags_are_untouched() {
        let playlist = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-ENDLIST\n";
        let out = rewrite_playlist(playlist, &base(), proxied);
        assert_eq!(out, playlist);
    }

    #[test]
    fn blank_lines_are_preserved() {
        let out = rewrite_playlist("#EXTM3U\n\nseg.ts\n", &base(), proxied);
        assert_eq!(out.lines().count(), 3);
        assert_eq!(out.lines().nth(1).unwrap(), "");
    }

    #[test]
    fn unclosed_uri_quote_does_not_panic() {
        let playlist = "#EXT-X-KEY:URI=\"broken\n";
        let out = rewrite_playlist(playlist, &base(), proxied);
        assert!(out.starts_with('#'));
    }

    #[test]
    fn non_http_scheme_is_rejected() {
        let encoded = URL_SAFE_NO_PAD.encode("file:///etc/passwd");
        assert!(decode_target(&encoded).is_err());
    }

    #[test]
    fn garbage_target_is_rejected() {
        assert!(decode_target("не-base64!!").is_err());
        assert!(decode_target(&URL_SAFE_NO_PAD.encode("не url")).is_err());
    }

    #[test]
    fn playlist_detected_by_extension_and_content_type() {
        let m3u8 = Url::parse("https://cdn/x/index.m3u8").unwrap();
        let segment = Url::parse("https://cdn/x/seg.ts").unwrap();
        assert!(is_playlist(&m3u8, "application/octet-stream"));
        assert!(is_playlist(&segment, "application/vnd.apple.mpegURL"));
        assert!(!is_playlist(&segment, "video/mp2t"));
    }
}

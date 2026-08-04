use std::net::{Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anilume_core::ProxyHandle;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;

#[derive(Default)]
struct Upstream {
    saw_referer: AtomicBool,
    saw_user_agent: AtomicBool,
}

async fn master(State(state): State<Arc<Upstream>>, headers: HeaderMap) -> impl IntoResponse {
    let referer_ok = headers
        .get("referer")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == "https://kodik.info/")
        .unwrap_or(false);
    state.saw_referer.store(referer_ok, Ordering::SeqCst);

    if !referer_ok {
        return (StatusCode::FORBIDDEN, "referer required").into_response();
    }

    let body = "#EXTM3U\n\
                #EXT-X-KEY:METHOD=AES-128,URI=\"secret.key\"\n\
                #EXTINF:6.0,\n\
                parts/seg-1.ts\n\
                #EXT-X-ENDLIST\n";
    (
        [(axum::http::header::CONTENT_TYPE, "application/vnd.apple.mpegurl")],
        body,
    )
        .into_response()
}

async fn segment(State(state): State<Arc<Upstream>>, headers: HeaderMap) -> impl IntoResponse {
    let ua_ok = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == "anilume/test")
        .unwrap_or(false);
    state.saw_user_agent.store(ua_ok, Ordering::SeqCst);

    (
        [(axum::http::header::CONTENT_TYPE, "video/mp2t")],
        vec![0xAAu8; 512],
    )
}

async fn start_upstream() -> (SocketAddr, Arc<Upstream>) {
    let state = Arc::new(Upstream::default());
    let router = Router::new()
        .route("/hls/master.m3u8", get(master))
        .route("/hls/parts/seg-1.ts", get(segment))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (addr, state)
}

#[tokio::test]
async fn proxy_injects_headers_and_rewrites_nested_links() {
    let (upstream_addr, upstream) = start_upstream().await;
    let proxy = ProxyHandle::start().await.unwrap();

    let session = proxy.open_session(
        [
            ("Referer".to_string(), "https://kodik.info/".to_string()),
            ("User-Agent".to_string(), "anilume/test".to_string()),
        ]
        .into_iter()
        .collect(),
    );

    let master_url = format!("http://{upstream_addr}/hls/master.m3u8");
    let client = reqwest::Client::new();

    let playlist = client
        .get(proxy.proxied_url(&session, &master_url))
        .send()
        .await
        .unwrap();

    assert_eq!(playlist.status(), StatusCode::OK);
    assert_eq!(
        playlist.headers()["access-control-allow-origin"],
        "*",
        "hls.js читает поток обычным fetch и без CORS получит отказ"
    );

    let body = playlist.text().await.unwrap();
    assert!(upstream.saw_referer.load(Ordering::SeqCst));

    let proxy_prefix = format!("http://{}/s/{session}/", proxy.addr());
    assert_eq!(
        body.matches(&proxy_prefix).count(),
        2,
        "и ключ шифрования, и сегмент должны идти через прокси"
    );
    assert!(body.contains("#EXT-X-ENDLIST"));

    let segment_url = body
        .lines()
        .find(|line| line.starts_with(&proxy_prefix))
        .unwrap();
    let segment = client.get(segment_url).send().await.unwrap();

    assert_eq!(segment.status(), StatusCode::OK);
    assert_eq!(segment.headers()["content-type"], "video/mp2t");
    assert_eq!(segment.bytes().await.unwrap().len(), 512);
    assert!(upstream.saw_user_agent.load(Ordering::SeqCst));
}

#[tokio::test]
async fn closed_session_stops_serving() {
    let (upstream_addr, _) = start_upstream().await;
    let proxy = ProxyHandle::start().await.unwrap();
    let session = proxy.open_session(Default::default());
    let url = proxy.proxied_url(&session, &format!("http://{upstream_addr}/hls/master.m3u8"));

    proxy.close_session(&session);
    assert_eq!(proxy.session_count(), 0);

    let response = reqwest::get(url).await.unwrap();
    assert_eq!(response.status(), StatusCode::GONE);
}

#[tokio::test]
async fn upstream_rejection_surfaces_as_bad_gateway_free_status() {
    let (upstream_addr, _) = start_upstream().await;
    let proxy = ProxyHandle::start().await.unwrap();
    let session = proxy.open_session(Default::default());

    let response = reqwest::get(proxy.proxied_url(
        &session,
        &format!("http://{upstream_addr}/hls/master.m3u8"),
    ))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn local_file_urls_are_refused() {
    let proxy = ProxyHandle::start().await.unwrap();
    let session = proxy.open_session(Default::default());

    let response = reqwest::get(proxy.proxied_url(&session, "file:///etc/passwd"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

use std::path::PathBuf;

use anilume_core::sidecar::{SidecarClient, SidecarSpec};
use serde_json::json;

fn sidecar_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../sidecar")
        .canonicalize()
        .expect("каталог sidecar должен существовать")
}

fn python() -> Option<String> {
    for candidate in ["python3", "python"] {
        if std::process::Command::new(candidate)
            .arg("--version")
            .output()
            .is_ok()
        {
            return Some(candidate.to_string());
        }
    }
    None
}

async fn connect() -> Option<std::sync::Arc<SidecarClient>> {
    let interpreter = python()?;
    let spec = SidecarSpec::python_module(&interpreter, &sidecar_root());
    SidecarClient::spawn(&spec).await.ok()
}

#[tokio::test]
async fn rust_talks_to_the_python_sidecar() {
    let Some(client) = connect().await else {
        eprintln!("python3 недоступен — тест пропущен");
        return;
    };

    let pong = client.call("ping", json!({})).await.unwrap();
    assert_eq!(pong["ok"], json!(true));
    assert!(pong["version"].is_string());

    let sources = client.call("sources.list", json!({})).await.unwrap();
    let keys: Vec<&str> = sources["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["key"].as_str().unwrap())
        .collect();
    assert!(keys.contains(&"anilibria"));
    assert!(keys.contains(&"animego"));

    client.shutdown().await;
}

#[tokio::test]
async fn sidecar_errors_arrive_as_typed_failures() {
    let Some(client) = connect().await else {
        eprintln!("python3 недоступен — тест пропущен");
        return;
    };

    let expired = client
        .call("anime.get", json!({ "handle": "search-99999" }))
        .await
        .unwrap_err();
    assert_eq!(expired.kind(), "handleExpired");

    let unknown_source = client
        .call("catalog.ongoing", json!({ "source": "нет-такого" }))
        .await
        .unwrap_err();
    assert_eq!(unknown_source.kind(), "upstream");

    let unknown_method = client.call("нет.метода", json!({})).await.unwrap_err();
    assert_eq!(unknown_method.kind(), "upstream");

    client.shutdown().await;
}

#[tokio::test]
async fn concurrent_calls_are_matched_to_their_own_replies() {
    let Some(client) = connect().await else {
        eprintln!("python3 недоступен — тест пропущен");
        return;
    };

    let calls = (0..8).map(|_| {
        let client = client.clone();
        async move { client.call("sources.list", json!({})).await }
    });
    let results = futures_util::future::join_all(calls).await;

    for result in results {
        assert!(result.unwrap()["sources"].as_array().unwrap().len() >= 9);
    }

    client.shutdown().await;
}

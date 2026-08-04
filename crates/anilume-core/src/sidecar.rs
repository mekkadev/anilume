use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

use crate::error::{CoreError, Result};

const CALL_TIMEOUT: Duration = Duration::from_secs(60);

type Pending = Arc<DashMap<u64, oneshot::Sender<Result<Value>>>>;

#[derive(Debug, Clone)]
pub struct SidecarSpec {
    pub program: std::path::PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

impl SidecarSpec {
    pub fn binary(program: impl Into<std::path::PathBuf>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            env: Vec::new(),
        }
    }

    pub fn python_module(interpreter: &str, package_root: &Path) -> Self {
        Self {
            program: interpreter.into(),
            args: vec!["-m".into(), "anilume_sidecar".into()],
            env: vec![
                (
                    "PYTHONPATH".into(),
                    package_root.to_string_lossy().into_owned(),
                ),
                ("PYTHONUNBUFFERED".into(), "1".into()),
                ("PYTHONIOENCODING".into(), "utf-8".into()),
            ],
        }
    }
}

pub struct SidecarClient {
    stdin: Mutex<ChildStdin>,
    pending: Pending,
    next_id: AtomicU64,
    child: Mutex<Child>,
}

impl SidecarClient {
    pub async fn spawn(spec: &SidecarSpec) -> Result<Arc<Self>> {
        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .envs(spec.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }

        let mut child = command.spawn().map_err(|e| {
            CoreError::Other(format!(
                "Не удалось запустить сайдкар {}: {e}",
                spec.program.display()
            ))
        })?;

        let stdin = child.stdin.take().ok_or(CoreError::SidecarDown)?;
        let stdout = child.stdout.take().ok_or(CoreError::SidecarDown)?;
        let stderr = child.stderr.take().ok_or(CoreError::SidecarDown)?;

        let pending: Pending = Arc::new(DashMap::new());

        {
            let pending = pending.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    dispatch_response(&pending, &line);
                }

                fail_all(&pending, || CoreError::SidecarDown);
            });
        }

        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(target: "sidecar", "{line}");
            }
        });

        Ok(Arc::new(Self {
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
            child: Mutex::new(child),
        }))
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.insert(id, tx);

        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let mut line =
            serde_json::to_string(&request).map_err(|e| CoreError::Other(e.to_string()))?;
        line.push('\n');

        {
            let mut stdin = self.stdin.lock().await;
            if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
                self.pending.remove(&id);
                return Err(CoreError::SidecarDown);
            }
        }

        match tokio::time::timeout(CALL_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(CoreError::SidecarDown),
            Err(_) => {
                self.pending.remove(&id);
                Err(CoreError::SidecarTimeout)
            }
        }
    }

    pub async fn call_as<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T> {
        let value = self.call(method, params).await?;
        serde_json::from_value(value).map_err(|e| {
            CoreError::Other(format!("Сайдкар вернул неожиданный ответ на {method}: {e}"))
        })
    }

    pub async fn shutdown(&self) {
        {
            let mut stdin = self.stdin.lock().await;
            let _ = stdin.shutdown().await;
        }
        let mut child = self.child.lock().await;
        match tokio::time::timeout(Duration::from_secs(5), child.wait()).await {
            Ok(_) => {}
            Err(_) => {
                let _ = child.kill().await;
            }
        }
    }
}

fn dispatch_response(pending: &Pending, line: &str) {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        tracing::warn!(target: "sidecar", "нераспознанная строка: {line}");
        return;
    };

    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        tracing::warn!(target: "sidecar", "ответ без id: {line}");
        return;
    };

    let Some((_, sender)) = pending.remove(&id) else {
        return;
    };

    let outcome = if let Some(error) = message.get("error") {
        Err(CoreError::Upstream {
            code: error.get("code").and_then(Value::as_i64).unwrap_or(0) as i32,
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Неизвестная ошибка источника")
                .to_owned(),
            data: error.get("data").cloned(),
        })
    } else {
        Ok(message.get("result").cloned().unwrap_or(Value::Null))
    };

    let _ = sender.send(outcome);
}

fn fail_all(pending: &Pending, make_error: impl Fn() -> CoreError) {
    let ids: Vec<u64> = pending.iter().map(|e| *e.key()).collect();
    for id in ids {
        if let Some((_, sender)) = pending.remove(&id) {
            let _ = sender.send(Err(make_error()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending_with(id: u64) -> (Pending, oneshot::Receiver<Result<Value>>) {
        let pending: Pending = Arc::new(DashMap::new());
        let (tx, rx) = oneshot::channel();
        pending.insert(id, tx);
        (pending, rx)
    }

    #[tokio::test]
    async fn successful_response_is_delivered_to_waiter() {
        let (pending, rx) = pending_with(4);
        dispatch_response(&pending, r#"{"jsonrpc":"2.0","id":4,"result":{"ok":true}}"#);
        assert_eq!(rx.await.unwrap().unwrap(), json!({"ok": true}));
        assert!(pending.is_empty());
    }

    #[tokio::test]
    async fn error_response_maps_to_upstream() {
        let (pending, rx) = pending_with(1);
        dispatch_response(
            &pending,
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32002,"message":"«AnimeGO» не отдал данные","data":{"hint":"нужен VPN"}}}"#,
        );
        let err = rx.await.unwrap().unwrap_err();
        assert_eq!(err.kind(), "upstream");
        assert_eq!(err.hint().as_deref(), Some("нужен VPN"));
        assert_eq!(err.to_string(), "«AnimeGO» не отдал данные");
    }

    #[tokio::test]
    async fn expired_handle_gets_its_own_kind() {
        let (pending, rx) = pending_with(2);
        dispatch_response(
            &pending,
            r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32001,"message":"устарело"}}"#,
        );
        assert_eq!(rx.await.unwrap().unwrap_err().kind(), "handleExpired");
    }

    #[tokio::test]
    async fn responses_are_matched_by_id_not_by_order() {
        let pending: Pending = Arc::new(DashMap::new());
        let (tx1, rx1) = oneshot::channel();
        let (tx2, rx2) = oneshot::channel();
        pending.insert(1, tx1);
        pending.insert(2, tx2);

        dispatch_response(&pending, r#"{"jsonrpc":"2.0","id":2,"result":"второй"}"#);
        dispatch_response(&pending, r#"{"jsonrpc":"2.0","id":1,"result":"первый"}"#);

        assert_eq!(rx1.await.unwrap().unwrap(), json!("первый"));
        assert_eq!(rx2.await.unwrap().unwrap(), json!("второй"));
    }

    #[tokio::test]
    async fn dead_sidecar_wakes_every_waiter() {
        let (pending, rx) = pending_with(9);
        fail_all(&pending, || CoreError::SidecarDown);
        assert_eq!(rx.await.unwrap().unwrap_err().kind(), "sidecarDown");
        assert!(pending.is_empty());
    }

    #[tokio::test]
    async fn junk_and_unknown_ids_are_ignored() {
        let (pending, _rx) = pending_with(1);
        dispatch_response(&pending, "не json");
        dispatch_response(&pending, r#"{"jsonrpc":"2.0","result":"без id"}"#);
        dispatch_response(&pending, r#"{"jsonrpc":"2.0","id":777,"result":"чужой"}"#);
        assert_eq!(pending.len(), 1);
    }
}

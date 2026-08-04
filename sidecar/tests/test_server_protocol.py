from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SIDECAR_ROOT = Path(__file__).resolve().parents[1]

class Sidecar:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "anilume_sidecar"],
            cwd=SIDECAR_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def send_raw(self, line: str) -> dict:
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()
        return json.loads(self.proc.stdout.readline())

    def call(self, method: str, params: dict | None = None, request_id: int = 1) -> dict:
        return self.send_raw(
            json.dumps(
                {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}},
                ensure_ascii=False,
            )
        )

    def close(self) -> None:
        assert self.proc.stdin
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()

@pytest.fixture
def sidecar():
    child = Sidecar()
    yield child
    child.close()

def test_ping_returns_version(sidecar):
    response = sidecar.call("ping")
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 1
    assert response["result"]["ok"] is True
    assert response["result"]["version"]

def test_sources_list_over_the_wire(sidecar):
    response = sidecar.call("sources.list", request_id=7)
    assert response["id"] == 7
    keys = {s["key"] for s in response["result"]["sources"]}
    assert {"animego", "anilibria", "yummy_anime"} <= keys

def test_unknown_method_returns_error(sidecar):
    response = sidecar.call("нет.такого")
    assert response["error"]["code"] == -32601
    assert "known" in response["error"]["data"]

def test_malformed_json_is_survivable(sidecar):
    broken = sidecar.send_raw("{это не json")
    assert broken["error"]["code"] == -32700

    assert sidecar.call("ping", request_id=2)["result"]["ok"] is True

def test_non_object_params_rejected(sidecar):
    response = sidecar.send_raw(
        json.dumps({"jsonrpc": "2.0", "id": 3, "method": "ping", "params": [1, 2]})
    )
    assert response["error"]["code"] == -32600

def test_shutdown_on_stdin_close(sidecar):
    sidecar.call("ping")
    sidecar.proc.stdin.close()
    assert sidecar.proc.wait(timeout=10) == 0

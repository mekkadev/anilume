from __future__ import annotations

from typing import Any

_store: dict[str, dict[str, Any]] = {}

def set_section(name: str, values: dict[str, Any]) -> None:
    _store[name] = dict(values)

def section(name: str) -> dict[str, Any]:
    return _store.get(name, {})

def get(name: str, key: str, default: Any = None) -> Any:
    return _store.get(name, {}).get(key, default)

def clear() -> None:
    _store.clear()

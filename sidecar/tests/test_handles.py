import pytest

from anilume_sidecar.handles import HandleRegistry
from anilume_sidecar.protocol import HANDLE_EXPIRED, RpcError


def test_put_and_get_roundtrip():
    registry = HandleRegistry()
    obj = object()
    handle = registry.put("anime", "anilibria", obj)
    entry = registry.get(handle, "anime")
    assert entry.obj is obj
    assert entry.source_key == "anilibria"


def test_wrong_kind_is_rejected():
    registry = HandleRegistry()
    handle = registry.put("anime", "anilibria", object())
    with pytest.raises(RpcError) as exc:
        registry.get(handle, "episode")
    assert exc.value.code == HANDLE_EXPIRED


def test_unknown_handle_reports_expired():
    registry = HandleRegistry()
    with pytest.raises(RpcError) as exc:
        registry.get("anime-999")
    assert exc.value.code == HANDLE_EXPIRED


def test_capacity_evicts_oldest_first():
    registry = HandleRegistry(capacity=3)
    handles = [registry.put("search", "anilibria", object()) for _ in range(4)]
    with pytest.raises(RpcError):
        registry.get(handles[0])
    assert registry.get(handles[3]) is not None
    assert len(registry) == 3


def test_access_refreshes_entry():
    """Активный тайтл не должен вытесняться фоновым поиском."""
    registry = HandleRegistry(capacity=3)
    a, b, c = (registry.put("search", "anilibria", object()) for _ in range(3))

    registry.get(a)  # освежаем самый старый
    d = registry.put("search", "anilibria", object())

    assert registry.get(a) is not None
    assert registry.get(d) is not None
    with pytest.raises(RpcError):
        registry.get(b)
    assert registry.get(c) is not None

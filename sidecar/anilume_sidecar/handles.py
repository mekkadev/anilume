from __future__ import annotations

import itertools
from collections import OrderedDict
from typing import Any, NamedTuple

from .protocol import HandleExpired

DEFAULT_CAPACITY = 512

class Entry(NamedTuple):
    kind: str

    source_key: str

    obj: Any

class HandleRegistry:
    def __init__(self, capacity: int = DEFAULT_CAPACITY) -> None:
        self._entries: OrderedDict[str, Entry] = OrderedDict()
        self._capacity = capacity
        self._counter = itertools.count(1)

    def put(self, kind: str, source_key: str, obj: Any) -> str:
        handle = f"{kind}-{next(self._counter)}"
        self._entries[handle] = Entry(kind, source_key, obj)
        self._entries.move_to_end(handle)
        while len(self._entries) > self._capacity:
            self._entries.popitem(last=False)
        return handle

    def get(self, handle: str, expected_kind: str | None = None) -> Entry:
        entry = self._entries.get(handle)
        if entry is None:
            raise HandleExpired(handle)
        if expected_kind is not None and entry.kind != expected_kind:
            raise HandleExpired(handle)

        self._entries.move_to_end(handle)
        return entry

    def __len__(self) -> int:
        return len(self._entries)

    def clear(self) -> None:
        self._entries.clear()

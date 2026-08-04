"""Типы и ошибки JSON-RPC 2.0."""

from __future__ import annotations

from typing import Any

# Стандартные коды JSON-RPC
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

# Коды, специфичные для anilume
HANDLE_EXPIRED = -32001
"""Объект anicli-api вытеснен из LRU-реестра: клиенту нужно повторить путь от поиска."""

SOURCE_UNAVAILABLE = -32002
"""Источник не отвечает, блокирует по гео или сменил вёрстку."""

UPSTREAM_ERROR = -32003
"""Сетевая ошибка или неожиданный ответ внешнего сайта."""


class RpcError(Exception):
    """Ошибка, которую можно безопасно показать пользователю."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def to_json(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            payload["data"] = self.data
        return payload


class HandleExpired(RpcError):
    def __init__(self, handle: str) -> None:
        super().__init__(
            HANDLE_EXPIRED,
            "Сессия просмотра устарела — обновите страницу тайтла",
            {"handle": handle},
        )


def ok(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def err(request_id: Any, error: RpcError) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": error.to_json()}

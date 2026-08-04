"""Цикл JSON-RPC поверх stdio.

Формат: одно JSON-сообщение на строку. Запросы обрабатываются конкурентно —
парсинг источников это в основном ожидание сети, и последовательная очередь
превратила бы открытие тайтла в заметную паузу.

stdin читается отдельным потоком, а не через asyncio-пайпы: на Windows
`connect_read_pipe` для стандартного ввода не поддерживается.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import threading
from typing import Any

from .protocol import (
    INTERNAL_ERROR,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    RpcError,
    err,
    ok,
)
from .service import AnilumeService

log = logging.getLogger("anilume.server")

_SHUTDOWN = object()


class StdioServer:
    def __init__(self, service: AnilumeService | None = None) -> None:
        self.service = service or AnilumeService()
        self.methods = self.service.dispatch_table()
        self._write_lock = asyncio.Lock()
        self._tasks: set[asyncio.Task[Any]] = set()

    # -- ввод/вывод --------------------------------------------------------

    async def _emit(self, message: dict[str, Any]) -> None:
        line = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        async with self._write_lock:
            # stdout буферизован — без flush ответ может застрять в буфере,
            # и хост будет ждать его до таймаута.
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    def _spawn_reader(self, queue: asyncio.Queue[Any], loop: asyncio.AbstractEventLoop) -> None:
        def reader() -> None:
            try:
                for raw in sys.stdin:
                    loop.call_soon_threadsafe(queue.put_nowait, raw)
            except Exception as exc:  # noqa: BLE001
                log.warning("stdin reader stopped: %r", exc)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, _SHUTDOWN)

        threading.Thread(target=reader, name="anilume-stdin", daemon=True).start()

    # -- обработка запросов ------------------------------------------------

    async def _handle(self, request: dict[str, Any]) -> None:
        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params") or {}

        if not isinstance(method, str):
            await self._emit(err(request_id, RpcError(INVALID_REQUEST, "Поле «method» обязательно")))
            return
        if not isinstance(params, dict):
            await self._emit(
                err(request_id, RpcError(INVALID_REQUEST, "Поле «params» должно быть объектом"))
            )
            return

        handler = self.methods.get(method)
        if handler is None:
            await self._emit(
                err(
                    request_id,
                    RpcError(METHOD_NOT_FOUND, f"Неизвестный метод: {method}",
                             {"known": sorted(self.methods)}),
                )
            )
            return

        try:
            result = await handler(params)
        except RpcError as exc:
            await self._emit(err(request_id, exc))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("method=%s crashed", method)
            await self._emit(
                err(request_id, RpcError(INTERNAL_ERROR, "Внутренняя ошибка сайдкара",
                                         {"method": method, "reason": str(exc)}))
            )
        else:
            await self._emit(ok(request_id, result))

    def _track(self, coro: Any) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[Any] = asyncio.Queue()
        self._spawn_reader(queue, loop)

        while True:
            item = await queue.get()
            if item is _SHUTDOWN:
                break

            raw = item.strip()
            if not raw:
                continue

            try:
                request = json.loads(raw)
            except json.JSONDecodeError as exc:
                await self._emit(err(None, RpcError(PARSE_ERROR, "Некорректный JSON", str(exc))))
                continue

            if not isinstance(request, dict):
                await self._emit(err(None, RpcError(INVALID_REQUEST, "Ожидался объект запроса")))
                continue

            self._track(self._handle(request))

        # Хост закрыл stdin. Даём незавершённым запросам короткий шанс ответить.
        if self._tasks:
            await asyncio.wait(set(self._tasks), timeout=5.0)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,  # stdout занят протоколом
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    argv = sys.argv[1:] if argv is None else argv
    if "--version" in argv:
        from . import __version__

        print(__version__)
        return 0

    try:
        asyncio.run(StdioServer().run())
    except KeyboardInterrupt:
        return 0
    return 0

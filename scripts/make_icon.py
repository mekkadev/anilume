#!/usr/bin/env python3
"""Рисует исходную иконку anilume без внешних зависимостей.

    python3 scripts/make_icon.py
    npx tauri icon src-tauri/icons/source.png
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

SIZE = 1024
SUPERSAMPLE = 2
OUTPUT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons" / "source.png"

ACCENT = (0x00, 0x7A, 0xFF)
PAPER = (0xFF, 0xFF, 0xFF)
INK = (0x17, 0x16, 0x0F)


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_rect_alpha(x, y, size, radius, inset=None):
    if inset is None:
        inset = size * 0.055
    left, top = inset, inset
    right, bottom = size - inset, size - inset

    dx = max(left + radius - x, 0, x - (right - radius))
    dy = max(top + radius - y, 0, y - (bottom - radius))
    distance = math.hypot(dx, dy)

    if x < left or x > right or y < top or y > bottom:
        return 0.0
    return 1.0 if distance <= radius else 0.0


def in_triangle(x, y, size):
    cx, cy = size * 0.5, size * 0.5
    height = size * 0.30
    width = size * 0.26

    apex_x = cx + width * 0.62
    back_x = cx - width * 0.38
    top_y = cy - height * 0.5
    bottom_y = cy + height * 0.5

    if x < back_x or x > apex_x:
        return False

    progress = (x - back_x) / (apex_x - back_x)
    half = (1 - progress) * (bottom_y - top_y) / 2
    return abs(y - cy) <= half


def render() -> bytes:
    scale = SUPERSAMPLE
    big = SIZE * scale
    radius = big * 0.235

    rule_outer = big * 0.088
    rule_inner = rule_outer + big * 0.012

    accumulator = [[0] * (SIZE * 4) for _ in range(SIZE)]

    for by in range(big):
        target = accumulator[by // scale]

        for bx in range(big):
            if rounded_rect_alpha(bx, by, big, radius) == 0.0:
                continue

            colour = ACCENT

            on_rule = (
                rounded_rect_alpha(bx, by, big, radius, inset=rule_outer) > 0
                and rounded_rect_alpha(bx, by, big, radius, inset=rule_inner) == 0
            )
            if on_rule:
                colour = PAPER

            if in_triangle(bx, by, big):
                colour = PAPER

            index = (bx // scale) * 4
            target[index] += colour[0]
            target[index + 1] += colour[1]
            target[index + 2] += colour[2]
            target[index + 3] += 255

    samples = scale * scale
    raw = bytearray()
    for row in accumulator:
        raw.append(0)
        raw.extend(min(255, value // samples) for value in row)

    return bytes(raw)

def chunk(tag: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(render(), 9))
        + chunk(b"IEND", b"")
    )

    OUTPUT.write_bytes(png)
    print(f"{OUTPUT} — {len(png) / 1024:.1f} КБ")


if __name__ == "__main__":
    main()

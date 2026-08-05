#!/usr/bin/env python3
"""Готовит иконку приложения из исходного логотипа.

    python3 scripts/make_icon.py --source assets/logo.png --generate

Логотип обрезается по непрозрачному содержимому, вписывается в квадрат
с отступом и, если задан фон, маскируется скруглённым квадратом macOS.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src-tauri" / "icons" / "source.png"

SIZE = 1024
SUPERSAMPLE = 4
CONTENT_SCALE = 0.80
CORNER_RATIO = 0.2237
DARK_LEVEL = 24
FADE_LEVEL = 96


def force_utf8_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")


def drop_flat_background(image: Image.Image) -> Image.Image:
    pixels = image.load()
    width, height = image.size
    corners = [
        pixels[0, 0],
        pixels[width - 1, 0],
        pixels[0, height - 1],
        pixels[width - 1, height - 1],
    ]
    if any(pixel[3] < 250 for pixel in corners):
        return image
    if not all(max(pixel[:3]) <= DARK_LEVEL for pixel in corners):
        return image

    stripped = image.copy()
    target = stripped.load()
    span = FADE_LEVEL - DARK_LEVEL
    for y in range(height):
        for x in range(width):
            r, g, b, a = target[x, y]
            level = max(r, g, b)
            if level <= DARK_LEVEL:
                target[x, y] = (r, g, b, 0)
            elif level < FADE_LEVEL:
                target[x, y] = (r, g, b, int(a * (level - DARK_LEVEL) / span))
    return stripped


def trim(image: Image.Image) -> Image.Image:
    box = image.getbbox()
    return image.crop(box) if box else image


def squircle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * CORNER_RATIO), fill=255
    )
    return mask


def build(source: Path, background: str | None) -> Image.Image:
    logo = trim(drop_flat_background(Image.open(source).convert("RGBA")))

    canvas = SIZE * SUPERSAMPLE
    content = int(canvas * CONTENT_SCALE)
    ratio = min(content / logo.width, content / logo.height)
    scaled = logo.resize(
        (max(1, round(logo.width * ratio)), max(1, round(logo.height * ratio))),
        Image.LANCZOS,
    )

    plate = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    if background:
        fill = background.lstrip("#")
        rgb = tuple(int(fill[i : i + 2], 16) for i in (0, 2, 4))
        plate = Image.new("RGBA", (canvas, canvas), (*rgb, 255))
        plate.putalpha(squircle_mask(canvas))

    plate.alpha_composite(
        scaled, ((canvas - scaled.width) // 2, (canvas - scaled.height) // 2)
    )
    return plate.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> int:
    force_utf8_output()

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="assets/logo.png")
    parser.add_argument("--background", default=None)
    parser.add_argument("--generate", action="store_true")
    args = parser.parse_args()

    source = (ROOT / args.source).resolve()
    if not source.is_file():
        print(f"Не найден исходник: {source}")
        return 1

    icon = build(source, args.background)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUTPUT)
    print(f"{OUTPUT.relative_to(ROOT)} — {icon.width}×{icon.height}")

    if args.generate:
        subprocess.run(["npx", "tauri", "icon", str(OUTPUT)], cwd=ROOT, check=True)
    else:
        print("Дальше: npx tauri icon src-tauri/icons/source.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Собирает сайдкар в один исполняемый файл для бандла Tauri.

Tauri ищет внешние бинарники по имени с суффиксом целевой тройки, например
`anilume-sidecar-aarch64-apple-darwin`. Скрипт определяет тройку через
`rustc -vV` и кладёт результат в `src-tauri/binaries/`.

    python3 sidecar/build_sidecar.py
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SIDECAR_ROOT = REPO_ROOT / "sidecar"
OUTPUT_DIR = REPO_ROOT / "src-tauri" / "binaries"
BASE_NAME = "anilume-sidecar"

# Парсеры anicli-api подтягиваются по строковому пути внутри библиотеки,
# поэтому статический анализ PyInstaller их не видит.
HIDDEN_IMPORTS = (
    "anicli_api.source.animego",
    "anicli_api.source.anilibria",
    "anicli_api.source.anilibme",
    "anicli_api.source.animevost",
    "anicli_api.source.dreamcast",
    "anicli_api.source.hdrezka",
    "anicli_api.source.sameband",
    "anicli_api.source.yummy_anime",
    "anicli_api.source.yummy_anime_org",
    "anicli_api.player.aksor",
    "anicli_api.player.aniboom",
    "anicli_api.player.cdnvideohub",
    "anicli_api.player.csst",
    "anicli_api.player.kodik",
    "anicli_api.player.sibnet",
    "anicli_api.player.sovetromantica",
    "anicli_api.player.sovetromantica_embed",
)


def target_triple() -> str:
    try:
        out = subprocess.run(
            ["rustc", "-vV"], capture_output=True, text=True, check=True
        ).stdout
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(
            "Не удалось получить целевую тройку от rustc — установите Rust toolchain"
        ) from exc

    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise SystemExit("В выводе `rustc -vV` нет строки host")


def build(triple: str, clean: bool) -> Path:
    work_dir = SIDECAR_ROOT / "build"
    dist_dir = SIDECAR_ROOT / "dist"
    if clean:
        for path in (work_dir, dist_dir):
            shutil.rmtree(path, ignore_errors=True)

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--onefile",
        "--noconfirm",
        "--clean",
        "--name",
        BASE_NAME,
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(work_dir),
        # Сайдкар общается по stdio и не должен открывать окно консоли на Windows.
        "--console",
    ]
    for module in HIDDEN_IMPORTS:
        command += ["--hidden-import", module]
    command.append(str(SIDECAR_ROOT / "anilume_sidecar" / "__main__.py"))

    subprocess.run(command, check=True, cwd=SIDECAR_ROOT)

    suffix = ".exe" if sys.platform == "win32" else ""
    produced = dist_dir / f"{BASE_NAME}{suffix}"
    if not produced.exists():
        raise SystemExit(f"PyInstaller не создал {produced}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT_DIR / f"{BASE_NAME}-{triple}{suffix}"
    shutil.copy2(produced, destination)
    destination.chmod(0o755)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--triple", help="переопределить целевую тройку")
    parser.add_argument("--no-clean", action="store_true", help="не чистить build/ и dist/")
    args = parser.parse_args()

    triple = args.triple or target_triple()
    destination = build(triple, clean=not args.no_clean)
    size_mb = destination.stat().st_size / 1024 / 1024
    print(f"Готово: {destination} ({size_mb:.1f} МБ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

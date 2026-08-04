from __future__ import annotations

import argparse
import hashlib
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = REPO_ROOT / "src-tauri" / "binaries"
CACHE_DIR = REPO_ROOT / ".cache" / "ffmpeg"
CHUNK = 1 << 20

@dataclass(frozen=True)
class Build:
    url: str
    sha256: str
    member: str

    license: str

BUILDS: dict[str, Build] = {
    "aarch64-apple-darwin": Build(
        url="https://www.osxexperts.net/ffmpeg71arm.zip",
        sha256="0878f3313311c2c1b2c818e7c955c0bd828c97b357fa86211b42a5c36d01e36f",
        member="ffmpeg",
        license="GPL-3.0",
    ),
    "x86_64-pc-windows-msvc": Build(
        url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip",
        sha256="c5dca7fbf8741a1d2b319f4d003d7370b7f518341990ee048d2d3d18be36d91c",
        member="ffmpeg-master-latest-win64-lgpl/bin/ffmpeg.exe",
        license="LGPL-3.0",
    ),
    "x86_64-unknown-linux-gnu": Build(
        url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-lgpl.tar.xz",
        sha256="576865849c1d34bd475332cb030a0b641df96536945d213ddd1232669b8244b7",
        member="ffmpeg-master-latest-linux64-lgpl/bin/ffmpeg",
        license="LGPL-3.0",
    ),
}

def host_triple() -> str:
    try:
        out = subprocess.run(
            ["rustc", "-vV"], capture_output=True, text=True, check=True
        ).stdout
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit("Не удалось получить целевую тройку от rustc") from exc

    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise SystemExit("В выводе `rustc -vV` нет строки host")

def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Скачиваем {url}")

    request = urllib.request.Request(url, headers={"User-Agent": "anilume-build"})
    with urllib.request.urlopen(request) as response, destination.open("wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while chunk := response.read(CHUNK):
            out.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r  {done * 100 // total}%", end="", flush=True)
    print()

def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK):
            hasher.update(chunk)
    return hasher.hexdigest()

def extract(archive: Path, member: str, destination: Path) -> None:
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as bundle:
            with bundle.open(member) as source, destination.open("wb") as out:
                shutil.copyfileobj(source, out)
        return

    with tarfile.open(archive) as bundle:
        source = bundle.extractfile(member)
        if source is None:
            raise SystemExit(f"В архиве нет {member}")
        with destination.open("wb") as out:
            shutil.copyfileobj(source, out)

def main() -> int:
    parser = argparse.ArgumentParser(description="Кладёт ffmpeg в src-tauri/binaries")
    parser.add_argument("--triple", help="целевая тройка, по умолчанию текущая")
    parser.add_argument(
        "--print-sha256",
        action="store_true",
        help="посчитать сумму скачанного архива и выйти (для обновления закрепления)",
    )
    args = parser.parse_args()

    triple = args.triple or host_triple()
    build = BUILDS.get(triple)
    if build is None:
        raise SystemExit(
            f"Для {triple} сборка ffmpeg не закреплена. Известные: {', '.join(BUILDS)}"
        )

    archive = CACHE_DIR / f"{triple}-{Path(build.url).name}"
    if not archive.exists():
        download(build.url, archive)

    actual = digest(archive)
    if args.print_sha256:
        print(f"{triple}: {actual}")
        return 0

    if build.sha256 and actual != build.sha256:
        archive.unlink(missing_ok=True)
        raise SystemExit(
            "Контрольная сумма не совпала — upstream подменил файл.\n"
            f"  ожидали: {build.sha256}\n"
            f"  получили: {actual}\n"
            "Проверьте источник и обновите закрепление осознанно."
        )
    if not build.sha256:
        print(f"ВНИМАНИЕ: для {triple} сумма не закреплена, получено {actual}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    suffix = ".exe" if triple.endswith("windows-msvc") else ""
    destination = OUTPUT_DIR / f"ffmpeg-{triple}{suffix}"

    if build.member:
        extract(archive, build.member, destination)
    else:
        shutil.copy2(archive, destination)

    destination.chmod(destination.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    size_mb = destination.stat().st_size / 1024 / 1024
    print(f"Готово: {destination} ({size_mb:.1f} МБ, {build.license})")
    return 0

if __name__ == "__main__":
    sys.exit(main())

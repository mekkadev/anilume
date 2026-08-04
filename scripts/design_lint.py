#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
STYLES = REPO_ROOT / "src" / "styles"
SOURCE = REPO_ROOT / "src"

AI_DEFAULT_INDIGO = {
    "#6366f1",
    "#4f46e5",
    "#4338ca",
    "#3730a3",
    "#8b5cf6",
    "#7c3aed",
    "#a855f7",
}

TRUST_GRADIENT_PAIRS = [
    ("purple", "blue"),
    ("blue", "cyan"),
    ("indigo", "pink"),
    ("violet", "blue"),
]

SLOP_EMOJI = "✨🚀🎯⚡🔥💡🌟💪🎉📈🔒"

FILLER = [
    "lorem ipsum",
    "placeholder text",
    "sample content",
    "feature one",
    "your text here",
    "coming soon",
]

INVENTED_METRIC = re.compile(
    r"\b(\d+(?:[.,]\d+)?)\s*(?:×|x|раз)\s*(?:быстрее|faster|productive|производительн)"
    r"|\b99[.,]9+\s*%\s*(?:uptime|аптайм|доступн)",
    re.IGNORECASE,
)

PLACEHOLDER_CDN = re.compile(
    r"(unsplash\.com|placehold\.co|placekitten\.com|picsum\.photos|via\.placeholder)",
    re.IGNORECASE,
)

HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")
GRADIENT = re.compile(r"linear-gradient\s*\(([^)]*)\)", re.IGNORECASE)

SEVERITY_ORDER = {"P0": 0, "P1": 1, "P2": 2}

@dataclass
class Finding:
    severity: str
    rule: str
    where: str
    detail: str

    def render(self) -> str:
        return f"  [{self.severity}] {self.rule}\n        {self.where}\n        {self.detail}"

def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")

def style_files() -> list[Path]:
    return sorted(STYLES.glob("*.css"))

def code_files() -> list[Path]:
    return sorted(p for p in SOURCE.rglob("*.tsx"))

def rel(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT))

def check_indigo(findings: list[Finding]) -> None:
    for path in style_files() + code_files():
        text = read(path).lower()
        for colour in AI_DEFAULT_INDIGO:
            if colour in text:
                findings.append(
                    Finding(
                        "P0",
                        "Дефолтный индиго Tailwind как акцент",
                        rel(path),
                        f"{colour} — самый узнаваемый признак сгенерированного интерфейса",
                    )
                )

def check_trust_gradient(findings: list[Finding]) -> None:
    for path in style_files() + code_files():
        for match in GRADIENT.finditer(read(path)):
            body = match.group(1).lower()
            for left, right in TRUST_GRADIENT_PAIRS:
                if left in body and right in body:
                    findings.append(
                        Finding(
                            "P0",
                            "Градиент доверия из двух стопов",
                            rel(path),
                            f"{left}→{right}: плоская поверхность и типографика работают лучше",
                        )
                    )

def check_emoji_icons(findings: list[Finding]) -> None:
    pattern = re.compile(
        r"<(h[1-6]|button|li)[^>]*>[^<]*[" + SLOP_EMOJI + r"]", re.IGNORECASE
    )
    for path in code_files():
        text = read(path)
        if pattern.search(text):
            findings.append(
                Finding(
                    "P0",
                    "Эмодзи вместо иконки",
                    rel(path),
                    "нужен монолинейный SVG со stroke 1.6–1.8 и currentColor",
                )
            )

def check_display_font(findings: list[Finding]) -> None:
    css = "\n".join(read(path) for path in style_files())
    if "--font-display" not in css:
        findings.append(
            Finding("P0", "Не задан шрифт заголовков", "src/styles", "нет токена --font-display")
        )
        return

    for selector in (".page-title", ".hero__title", ".section__title", ".panel__title"):
        block = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
        if not block:
            continue
        body = block.group(1)
        if "font-family" in body and "--font-display" not in body:
            findings.append(
                Finding(
                    "P0",
                    "Заголовок набран не тем шрифтом",
                    selector,
                    "у крупного текста должен стоять var(--font-display)",
                )
            )

def check_card_with_left_border(findings: list[Finding]) -> None:
    css = "\n".join(read(path) for path in style_files())
    for block in re.finditer(r"([.#][\w-]+)\s*\{([^}]*)\}", css):
        selector, body = block.group(1), block.group(2)
        has_radius = "border-radius" in body and "var(--r-full)" not in body
        left_accent = re.search(r"border-left:[^;]*var\(--accent", body)
        if has_radius and left_accent:
            findings.append(
                Finding(
                    "P0",
                    "Карточка со скруглением и цветной левой границей",
                    selector,
                    "каноничная плитка ИИ-дашборда: убрать скругление либо границу",
                )
            )

def check_invented_metrics(findings: list[Finding]) -> None:
    for path in code_files():
        for number, line in enumerate(read(path).splitlines(), 1):
            if INVENTED_METRIC.search(line):
                findings.append(
                    Finding(
                        "P0",
                        "Выдуманная метрика",
                        f"{rel(path)}:{number}",
                        line.strip()[:90],
                    )
                )

def check_filler(findings: list[Finding]) -> None:
    for path in code_files():
        lowered = read(path).lower()
        for phrase in FILLER:
            if phrase in lowered:
                findings.append(
                    Finding(
                        "P0",
                        "Текст-заглушка",
                        rel(path),
                        f"«{phrase}»: пустой блок решают композицией, а не выдуманными словами",
                    )
                )

def check_placeholder_cdn(findings: list[Finding]) -> None:
    for path in code_files() + style_files():
        match = PLACEHOLDER_CDN.search(read(path))
        if match:
            findings.append(
                Finding(
                    "P1",
                    "Внешний сервис картинок-заглушек",
                    rel(path),
                    f"{match.group(1)}: хрупко и заметно",
                )
            )

def check_raw_hex(findings: list[Finding]) -> None:
    for path in style_files():
        text = read(path)
        root_blocks = re.findall(r":root[^{]*\{[^}]*\}", text)
        outside = text
        for block in root_blocks:
            outside = outside.replace(block, "")
        hexes = [h for h in HEX.findall(outside)]
        if len(hexes) > 12:
            findings.append(
                Finding(
                    "P1",
                    "Слишком много сырых цветов вне токенов",
                    rel(path),
                    f"{len(hexes)} значений: токены не соблюдены",
                )
            )

def check_accent_overuse(findings: list[Finding]) -> None:
    for path in style_files():
        text = read(path)
        root_blocks = re.findall(r":root[^{]*\{[^}]*\}", text)
        outside = text
        for block in root_blocks:
            outside = outside.replace(block, "")
        uses = len(re.findall(r"var\(--accent\)", outside))
        if uses > 18:
            findings.append(
                Finding(
                    "P1",
                    "Акцент используется слишком часто",
                    rel(path),
                    f"{uses} обращений к var(--accent): на экране его должно быть видно 1–2 раза",
                )
            )

CHECKS = (
    check_indigo,
    check_trust_gradient,
    check_emoji_icons,
    check_display_font,
    check_card_with_left_border,
    check_invented_metrics,
    check_filler,
    check_placeholder_cdn,
    check_raw_hex,
    check_accent_overuse,
)

def main() -> int:
    parser = argparse.ArgumentParser(description="Проверка оформления на признаки шаблонности")
    parser.add_argument(
        "--max-severity",
        default="P0",
        choices=["P0", "P1", "P2"],
        help="какой уровень считать ошибкой сборки",
    )
    args = parser.parse_args()

    findings: list[Finding] = []
    for check in CHECKS:
        check(findings)

    findings.sort(key=lambda f: (SEVERITY_ORDER[f.severity], f.rule))
    limit = SEVERITY_ORDER[args.max_severity]
    blocking = [f for f in findings if SEVERITY_ORDER[f.severity] <= limit]

    if not findings:
        print("Замечаний нет.")
        return 0

    current = None
    for finding in findings:
        if finding.severity != current:
            current = finding.severity
            print(f"\n{current}:")
        print(finding.render())

    print(f"\nВсего: {len(findings)}, блокирующих ({args.max_severity} и выше): {len(blocking)}")
    return 1 if blocking else 0

if __name__ == "__main__":
    sys.exit(main())

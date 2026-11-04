#!/usr/bin/env python3
"""projects/ 아래 폴더를 훑어 README의 목차를 자동 갱신한다.

각 프로젝트 폴더의 첫 번째 README.md 제목(# ...)과 다음 한 줄을 설명으로 사용한다.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / "projects"
README = ROOT / "README.md"
START, END = "<!-- INDEX:START -->", "<!-- INDEX:END -->"


def describe(folder: Path) -> tuple[str, str]:
    readme = folder / "README.md"
    title, desc = folder.name, ""
    if readme.exists():
        lines = [l.strip() for l in readme.read_text(encoding="utf-8").splitlines()]
        for i, line in enumerate(lines):
            if line.startswith("# "):
                title = line[2:].strip()
                desc = next((l for l in lines[i + 1:] if l and not l.startswith("#")), "")
                break
    return title, desc


def build() -> str:
    rows = ["| 프로젝트 | 설명 |", "| --- | --- |"]
    for folder in sorted(p for p in PROJECTS.iterdir() if p.is_dir()):
        title, desc = describe(folder)
        rows.append(f"| [{title}](projects/{folder.name}) | {desc} |")
    if len(rows) == 2:
        rows.append("| _아직 없음_ | `projects/` 에 폴더를 추가해 보세요 |")
    return "\n".join(rows)


def main() -> None:
    text = README.read_text(encoding="utf-8")
    block = f"{START}\n{build()}\n{END}"
    new = re.sub(f"{re.escape(START)}.*?{re.escape(END)}", block, text, flags=re.S)
    README.write_text(new, encoding="utf-8")
    print("README 목차 갱신 완료")


if __name__ == "__main__":
    main()

"""Montre tout ce que l'export Inducks contient sur quelques histoires.

Pour chaque code d'histoire (« F AJM  75-1 », « ZD 59-01-04 »… les espaces multiples
sont facultatifs), on retrouve ses versions, puis on affiche, table par table, toutes
les lignes qui citent l'histoire ou l'une de ses versions, avec toutes leurs colonnes.
Utile pour comprendre comment Inducks note une reprise, un remake ou un crédit douteux.

Usage :
  python pipeline/inspect_stories.py --archive isv.tgz "F AJM 75-1" "ZD 59-01-04"
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import tarfile
from collections import defaultdict
from pathlib import Path

MAX_ROWS_PER_TABLE = 60


def squash(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def tables(archive: Path):
    """Parcourt l'archive : (nom de table, en-têtes, itérateur de lignes)."""
    with tarfile.open(archive, "r:gz" if archive.suffix in (".tgz", ".gz") else "r") as tar:
        for member in tar:
            name = member.name.rsplit("/", 1)[-1]
            if not member.isfile() or not name.endswith(".isv"):
                continue
            raw = tar.extractfile(member)
            if raw is None:
                continue
            text = io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="")
            header = text.readline().rstrip("\r\n").split("^")
            yield name[:-4], header, (line.rstrip("\r\n").split("^") for line in text)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--summary", type=Path, help="fichier Markdown où écrire le résultat")
    parser.add_argument("stories", nargs="+")
    args = parser.parse_args(argv)

    wanted = {squash(code) for code in args.stories}

    # Premier passage : les versions de chaque histoire, et la liste des tables.
    codes = set(wanted)
    headers: dict[str, list[str]] = {}
    for table, header, rows in tables(args.archive):
        headers[table] = header
        if table != "inducks_storyversion":
            for _ in rows:
                pass
            continue
        i_story, i_version = header.index("storycode"), header.index("storyversioncode")
        for parts in rows:
            if len(parts) > max(i_story, i_version) and squash(parts[i_story]) in wanted:
                codes.add(squash(parts[i_version]))

    # Second passage : toutes les lignes qui citent ces codes, dans n'importe quelle colonne.
    found: dict[str, list[list[str]]] = defaultdict(list)
    for table, header, rows in tables(args.archive):
        for parts in rows:
            if any(squash(value) in codes for value in parts if value):
                found[table].append(parts)

    out = ["## Tables de l'export", ""]
    out += [f"- `{table}` : {', '.join(header)}" for table, header in sorted(headers.items())]
    out += ["", f"## Lignes qui citent {', '.join(sorted(codes))}", ""]
    for table in sorted(found):
        header = headers[table]
        rows = found[table]
        out += [f"### {table} ({len(rows)} lignes)", "", "| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
        for parts in rows[:MAX_ROWS_PER_TABLE]:
            cells = [cell.replace("|", "\\|") for cell in parts[: len(header)]]
            out.append("| " + " | ".join(cells) + " |")
        out.append("")
    report = "\n".join(out)
    print(report)
    if args.summary:
        with args.summary.open("a", encoding="utf-8") as fh:
            fh.write(report + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Explique pourquoi un dessinateur est, ou n'est pas, dans le jeu.

Pour chaque nom cherché (nom complet ou pseudonyme, sans tenir compte des accents),
on suit les mêmes filtres que build_data.py et on compte ce qui reste à chaque étape.

Usage :
  python pipeline/explain.py --archive isv.tgz "Pierre Nicolas" "Dav" "Mac"
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from collections import defaultdict
from pathlib import Path

import build_data as bd

EXTRA = {
    "inducks_personalias": ("personcode", "surname", "givenname", "official"),
    "inducks_person": (*bd.TABLES["inducks_person"], "official", "birthname"),
}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--summary", type=Path, help="fichier Markdown où écrire le résultat")
    parser.add_argument("names", nargs="+")
    args = parser.parse_args(argv)

    data = bd.load_tables(args.archive, {**bd.TABLES, **EXTRA})
    persons = {row["personcode"]: row for row in data["inducks_person"]}

    # Noms et pseudonymes de chaque personne, pour la recherche.
    names_of: dict[str, set[str]] = defaultdict(set)
    for code, row in persons.items():
        names_of[code].add(bd.fold(row["fullname"]))
        names_of[code].add(bd.fold(code))
    for row in data["inducks_personalias"]:
        full = " ".join(part for part in (row["givenname"], row["surname"]) if part)
        if full:
            names_of[row["personcode"]].add(bd.fold(full))

    sites = {
        row["sitecode"]
        for row in data["inducks_site"]
        if row["images"] == "Y" and row["urlbase"].startswith("http") and not row["sitecode"].startswith(bd.DERIVATIVE_SITES)
    }
    versions = {row["storyversioncode"]: row for row in data["inducks_storyversion"]}
    art_by_version: dict[str, set[str]] = defaultdict(set)
    versions_of: dict[str, set[str]] = defaultdict(set)
    for row in data["inducks_storyjob"]:
        if row["plotwritartink"] == "a":
            art_by_version[row["storyversioncode"]].add("?" if row["doubt"] == "Y" else row["personcode"])
            if row["doubt"] != "Y":
                versions_of[row["personcode"]].add(row["storyversioncode"])
    entries_of_version: dict[str, list[dict]] = defaultdict(list)
    for row in data["inducks_entry"]:
        if row["storyversioncode"]:
            entries_of_version[row["storyversioncode"]].append(row)
    scans: dict[str, list[dict]] = defaultdict(list)
    for row in data["inducks_entryurl"]:
        scans[row["entrycode"]].append(row)

    def page_layout(svc: str) -> bool:
        row = versions[svc]
        rows = bd.to_int(row["rowsperpage"])
        return (bd.to_int(row["entirepages"]) or 0) >= 1 and (rows is None or rows >= 3)

    # Les cases réellement retenues par build_data.py, après tous ses filtres
    # (dont les dessins repris d'un autre : remakes, calques, jeux).
    _, modes, _, _ = bd.build(data, dt.date.today())
    kept = defaultdict(int)
    for artist in bd.ELIGIBLE.values():
        kept[artist] += 1
    ranking = sorted(kept, key=lambda a: -kept[a])
    rank_of = {code: i + 1 for i, code in enumerate(ranking)}
    aliases: dict[str, list[str]] = defaultdict(list)
    for row in data["inducks_personalias"]:
        full = " ".join(part for part in (row["givenname"], row["surname"]) if part)
        if full:
            aliases[row["personcode"]].append(full + (" (officiel)" if row["official"] == "Y" else ""))

    lines = [
        "| Recherche | Fiche Inducks | Nationalité | Histoires dessinées | En planches | Seul dessinateur | Scan public de la page 1 | Retenues (dessin de sa main) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for wanted in args.names:
        key = bd.fold(wanted)
        matches = [code for code, names in names_of.items() if key in names]
        if not matches:
            matches = [code for code, names in names_of.items() if any(key in n.split() or n.startswith(key) for n in names)][:5]
        if not matches:
            lines.append(f"| {wanted} | introuvable | | | | | | |")
            continue
        for code in matches:
            person = persons.get(code, {})
            mine = {svc for svc in versions_of.get(code, set()) if svc in versions and versions[svc]["kind"] == "n"}
            planches = {svc for svc in mine if page_layout(svc)}
            seul = {svc for svc in planches if art_by_version[svc] == {code}}
            scanned = set()
            for svc in seul:
                for entry in entries_of_version.get(svc, []):
                    if entry["is_cover"] in ("1", "Y"):
                        continue
                    if any(s["public"] == "Y" and s["pagenumber"] in ("1", "01") and s["sitecode"] in sites for s in scans.get(entry["entrycode"], [])):
                        scanned.add(versions[svc]["storycode"])
                        break
            lines.append(
                f"| {wanted} | {person.get('fullname', '?')} ({code}) | {person.get('nationalitycountrycode') or 'non renseignée'} "
                f"| {len(mine)} | {len(planches)} | {len(seul)} | {len(scanned)} | {kept.get(code, 0)} |"
            )
    lines += ["", "| Fiche Inducks | Autres noms | Rang (cases retenues) | Modes où il figure (rang) |", "|---|---|---|---|"]
    for wanted in args.names:
        key = bd.fold(wanted)
        for code in [c for c, names in names_of.items() if key in names]:
            in_modes = [f"{m.id} ({m.artists.index(code) + 1}/{len(m.artists)})" for m in modes.values() if code in m.artists]
            lines.append(
                f"| {persons[code]['fullname']} ({code}) | {', '.join(aliases.get(code, [])) or '-'} "
                f"| {rank_of.get(code, '-')} sur {len(ranking)} | {', '.join(in_modes) or 'aucun'} |"
            )
    counts = sorted(kept.values(), reverse=True)
    lines += [
        "",
        f"Dessinateurs avec au moins 6 cases retenues : {sum(n >= 6 for n in counts)} ; au moins 30 : {sum(n >= 30 for n in counts)} ; "
        f"au moins 100 : {sum(n >= 100 for n in counts)}. Le 60e en a {counts[59] if len(counts) >= 60 else '-'}.",
    ]
    report = "\n".join(lines)
    print(report)
    if args.summary:
        with args.summary.open("a", encoding="utf-8") as fh:
            fh.write("## Dessinateurs recherchés\n\n" + report + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

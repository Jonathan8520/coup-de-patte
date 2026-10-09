"""Cherche les cases en jeu dont le dessin pourrait ne pas être du dessinateur crédité.

On reconstruit les cases comme build_data.py, puis on croise chaque histoire avec ce
qu'Inducks sait d'elle : liens vers d'autres histoires (remake, reprise…), crédits de
dessin indirects, commentaires d'entrée ([game]…), sous-séries, commentaires libres.
Le rapport compte les cas par catégorie et donne des exemples à vérifier.

Usage :
  python pipeline/audit_items.py --archive isv.tgz --summary resume.md
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import build_data as bd

EXTRA = {
    **bd.TABLES,
    "inducks_storyjob": ("storyversioncode", "personcode", "plotwritartink", "doubt", "indirect", "storyjobcomment"),
    "inducks_entry": (*bd.TABLES["inducks_entry"], "entrycomment", "changes"),
    "inducks_storyversion": (*bd.TABLES["inducks_storyversion"], "what"),
    "inducks_story": (*bd.TABLES["inducks_story"], "storycomment", "originalstoryversioncode"),
    "inducks_storyreference": ("fromstorycode", "tostorycode", "referencereasonid"),
    "inducks_referencereason": ("referencereasonid", "referencereasontext"),
    "inducks_referencereasonname": ("referencereasonid", "languagecode", "referencereasontranslation"),
    "inducks_storysubseries": ("storycode", "subseriescode"),
}
KEYWORDS = re.compile(r"swipe|cop(y|ied)|trac(e|ed|ing)|redraw|re-?drawn|retouch|re-?used?|remake|remount|collage|composite|based on|puzzle|game|jeu", re.I)
EXAMPLES = 12


def link(code: str) -> str:
    return f"[{code}](https://inducks.org/story.php?c={code.replace(' ', '+')})"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--summary", type=Path)
    args = parser.parse_args(argv)

    data = bd.load_tables(args.archive, EXTRA)
    _, modes, _, _ = bd.build(data, dt.date.today())
    items = {item["id"]: item for mode in modes.values() for item in mode.items}
    stories_in_play = {item["story"] for item in items.values()}
    out = [f"# Audit de {len(items)} cases ({len(stories_in_play)} histoires)", ""]

    reasons = {row["referencereasonid"]: row["referencereasontext"] for row in data["inducks_referencereason"]}
    names = defaultdict(dict)
    for row in data["inducks_referencereasonname"]:
        names[row["referencereasonid"]][row["languagecode"]] = row["referencereasontranslation"]
    out += ["## Raisons de lien entre histoires", "", "| id | texte | en | fr |", "|---|---|---|---|"]
    for rid, text in sorted(reasons.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 999):
        out.append(f"| {rid} | {text} | {names[rid].get('en', '')} | {names[rid].get('fr', '')} |")
    out.append("")

    # Dessinateurs de chaque histoire (toutes versions confondues).
    story_of = {row["storyversioncode"]: row["storycode"] for row in data["inducks_storyversion"]}
    what_of = {row["storyversioncode"]: row["what"] for row in data["inducks_storyversion"]}
    art_of_story: dict[str, set[str]] = defaultdict(set)
    indirect_art: dict[str, list[str]] = defaultdict(list)
    job_comments = Counter()
    for row in data["inducks_storyjob"]:
        if row["plotwritartink"] != "a":
            continue
        art_of_story[story_of.get(row["storyversioncode"], "")].add(row["personcode"])
        if row["storyversioncode"] in items:
            if row["indirect"] == "Y":
                indirect_art[row["storyversioncode"]].append(row["personcode"])
            if row["storyjobcomment"]:
                job_comments[row["storyjobcomment"]] += 1

    # 1. Liens sortants (cette histoire reprend, refait, s'inspire de…).
    by_reason: dict[str, list[tuple]] = defaultdict(list)
    for row in data["inducks_storyreference"]:
        if row["fromstorycode"] in stories_in_play:
            by_reason[row["referencereasonid"]].append((row["fromstorycode"], row["tostorycode"]))
    item_of_story = {item["story"]: item for item in items.values()}
    out += ["## Histoires en jeu qui pointent vers une autre histoire", "",
            "| raison | liens | dont dessinateur différent | exemples (dessinateur différent) |", "|---|---|---|---|"]
    for rid, pairs in sorted(by_reason.items(), key=lambda kv: -len(kv[1])):
        other = [(a, b) for a, b in pairs if art_of_story.get(b) and item_of_story[a]["artist"] not in art_of_story[b]]
        examples = ", ".join(f"{link(a)} ({item_of_story[a]['artist']}) ← {link(b)} ({','.join(sorted(art_of_story[b]))})" for a, b in other[:EXAMPLES])
        out.append(f"| {rid} {reasons.get(rid, '?')} | {len(pairs)} | {len(other)} | {examples} |")
    out.append("")

    # 2. Crédits de dessin indirects sur la version jouée.
    out += [f"## Crédit de dessin indirect sur la version jouée : {len(indirect_art)}", ""]
    out += [f"- {link(svc)} : {', '.join(codes)} (crédité : {items[svc]['artist']})" for svc, codes in list(indirect_art.items())[:EXAMPLES]]
    out += ["", "## Commentaires des crédits de dessin", ""]
    out += [f"- `{text}` : {n}" for text, n in job_comments.most_common(25)]
    out.append("")

    # 3. Commentaires d'entrée entre crochets ([game]…) sur la parution jouée et ailleurs.
    tags_played = Counter()
    tags_any: dict[str, set[str]] = defaultdict(set)
    examples_tag: dict[str, list[str]] = defaultdict(list)
    changes = Counter()
    for row in data["inducks_entry"]:
        svc = row["storyversioncode"]
        if svc not in items:
            continue
        tags = set(re.findall(r"\[([^\]]+)\]", row["entrycomment"].lower()))
        for tag in tags:
            tags_any[tag].add(svc)
            if row["issuecode"] == items[svc]["issue"]:
                tags_played[tag] += 1
                if len(examples_tag[tag]) < 6:
                    examples_tag[tag].append(link(items[svc]["story"]))
        if row["issuecode"] == items[svc]["issue"] and row["changes"]:
            changes[row["changes"]] += 1
    out += ["## Étiquettes de commentaire d'entrée", "", "| étiquette | sur la parution jouée | sur une parution de la version | exemples |", "|---|---|---|---|"]
    for tag, svcs in sorted(tags_any.items(), key=lambda kv: -len(kv[1]))[:40]:
        out.append(f"| {tag} | {tags_played.get(tag, 0)} | {len(svcs)} | {', '.join(examples_tag.get(tag, []))} |")
    out += ["", "## Changements notés sur la parution jouée", ""]
    out += [f"- `{text}` : {n}" for text, n in changes.most_common(20)]
    out.append("")

    # 4. Sous-séries des histoires en jeu.
    subseries = Counter(row["subseriescode"] for row in data["inducks_storysubseries"] if row["storycode"] in stories_in_play)
    out += ["## Sous-séries les plus présentes", ""]
    out += [f"- {code} : {n}" for code, n in subseries.most_common(40)]
    out.append("")

    # 5. Nature de la version (what) et commentaires libres suspects.
    whats = Counter(what_of.get(svc, "") for svc in items)
    out += ["## Champ « what » des versions jouées", ""] + [f"- `{w}` : {n}" for w, n in whats.most_common()] + [""]
    suspicious = [row for row in data["inducks_story"] if row["storycode"] in stories_in_play and KEYWORDS.search(row["storycomment"])]
    out += [f"## Commentaires d'histoire suspects : {len(suspicious)}", ""]
    out += [f"- {link(row['storycode'])} ({item_of_story[row['storycode']]['artist']}) : {row['storycomment'][:160]}" for row in suspicious[:30]]

    report = "\n".join(out)
    print(report)
    if args.summary:
        with args.summary.open("a", encoding="utf-8") as fh:
            fh.write(report + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

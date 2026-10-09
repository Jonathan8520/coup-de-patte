"""Construit les données du jeu à partir de l'export public d'Inducks (isv.tgz).

Étapes :
  1. lit les tables utiles de l'archive (sans tout décompresser) ;
  2. garde les scans publics de premières pages d'histoires (pas de couvertures),
     dessinées par un seul dessinateur ;
  3. répartit ces scans entre les modes de jeu ;
  4. écrit les fichiers JSON lus par le site et prolonge le calendrier
     des défis du jour sans jamais modifier un jour déjà publié.

Usage :
  python pipeline/build_data.py --archive isv.tgz --out site/data
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import logging
import random
import re
import sys
import tarfile
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

log = logging.getLogger("coup-de-patte")

# Tables lues dans l'archive, et colonnes réellement utilisées.
TABLES: dict[str, tuple[str, ...]] = {
    "inducks_site": ("sitecode", "urlbase", "images"),
    "inducks_entryurl": ("entrycode", "sitecode", "pagenumber", "url", "public"),
    "inducks_entry": (
        "entrycode", "issuecode", "storyversioncode", "languagecode", "title",
        "is_cover", "mirrored", "sideways",
    ),
    "inducks_storyversion": ("storyversioncode", "storycode", "kind", "entirepages", "rowsperpage"),
    "inducks_storyjob": ("storyversioncode", "personcode", "plotwritartink", "doubt"),
    "inducks_person": (
        "personcode", "nationalitycountrycode", "fullname", "isfake",
        "borndate", "deceaseddate", "photofilename",
    ),
    "inducks_story": ("storycode", "title", "firstpublicationdate"),
    "inducks_issue": ("issuecode", "publicationcode", "oldestdate"),
    "inducks_publication": ("publicationcode", "countrycode"),
}

# Noms alternatifs déjà vus pour certaines colonnes.
ALIASES = {"is_cover": ("iscover", "isCover")}

# Sites qui ne contiennent que des copies réduites ou renommées d'autres sites.
DERIVATIVE_SITES = ("thumbnails", "renamed")

MIN_ITEMS_PER_ARTIST = 6
MAX_ITEMS_PER_ARTIST = 60
MAX_ARTISTS_PER_MODE = 40
ARTISTS_PER_GAME = 9
ROUNDS_PER_GAME = 8
# Mode débutant : de grands noms aux styles bien distincts, quel que soit le pays de publication.
BEGINNER_NAMES = (
    "Carl Barks", "Don Rosa", "Romano Scarpa", "Giorgio Cavazzano", "Vicar", "Daan Jippes",
    "Floyd Gottfredson", "Giovan Battista Carpi", "Massimo De Vita", "William Van Horn",
    "Daniel Branca", "Silvia Ziche", "Marco Rota", "Paul Murry",
)
RECENT_YEARS = 20
DAILY_DAYS_AHEAD = 35
LAUNCH_DATE = dt.date(2026, 10, 9)

# Rotation des défis du jour, du lundi au dimanche.
# Les jours déjà publiés gardent leur mode : seule la suite du calendrier suit cette rotation.
DAILY_ROTATION = ("francais", "it", "us", "egmont", "tous", "fr", "debutant")
# Nombre de dessinateurs et de cases par dessinateur pour le mode « Tous les dessinateurs ».
ALL_ARTISTS = 60
ALL_ITEMS_PER_ARTIST = 30


@dataclass
class Mode:
    id: str
    name: str
    blurb: str
    items: list[dict] = field(default_factory=list)
    artists: list[str] = field(default_factory=list)
    # Nombre total d'histoires jouables par dessinateur (avant plafonnement) : sert de poids au tirage.
    counts: list[int] = field(default_factory=list)


# --------------------------------------------------------------------------
# Lecture de l'archive


def iter_isv(stream: io.TextIOBase, wanted: tuple[str, ...], table: str) -> Iterator[dict]:
    """Lit un fichier .isv : séparateur ^, première ligne = en-têtes, pas de guillemets."""
    header_line = stream.readline().rstrip("\r\n")
    header = header_line.split("^")
    index: dict[str, int] = {}
    for name in wanted:
        candidates = (name, *ALIASES.get(name, ()))
        for candidate in candidates:
            if candidate in header:
                index[name] = header.index(candidate)
                break
    missing = [name for name in wanted if name not in index]
    if missing:
        log.warning("%s : colonnes absentes %s (en-têtes : %s)", table, missing, header[:20])
    width = len(header)
    skipped = 0
    for line in stream:
        parts = line.rstrip("\r\n").split("^")
        if len(parts) < width:
            skipped += 1
            continue
        yield {name: parts[i].strip() for name, i in index.items()} | {
            name: "" for name in missing
        }
    if skipped:
        log.info("%s : %d lignes incomplètes ignorées", table, skipped)


def load_tables(archive: Path, tables: dict[str, tuple[str, ...]] | None = None) -> dict[str, list[dict]]:
    """Charge les tables utiles en une seule lecture de l'archive compressée."""
    tables = tables or TABLES
    wanted_files = {f"{table}.isv": table for table in tables}
    data: dict[str, list[dict]] = {}
    mode = "r:gz" if archive.suffix in (".tgz", ".gz") else "r"
    with tarfile.open(archive, mode) as tar:
        for member in tar:
            name = member.name.rsplit("/", 1)[-1]
            table = wanted_files.get(name)
            if not table or not member.isfile():
                continue
            raw = tar.extractfile(member)
            if raw is None:
                continue
            text = io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="")
            rows = list(iter_isv(text, tables[table], table))
            data[table] = rows
            log.info("%-22s %9d lignes", table, len(rows))
    absent = sorted(set(tables) - set(data))
    if absent:
        raise SystemExit(f"Tables introuvables dans l'archive : {absent}")
    return data


# --------------------------------------------------------------------------
# Sélection des scans


def year_of(value: str) -> int | None:
    match = re.match(r"(\d{4})", value or "")
    return int(match.group(1)) if match else None


def to_int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def stable_key(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode()).hexdigest()


def fold(text: str) -> str:
    """Comparaison sans accents ni casse."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold().strip()


def clean_name(fullname: str) -> str:
    return re.sub(r"\s+", " ", fullname).strip()


def build(data: dict[str, list[dict]], today: dt.date) -> tuple[dict, dict[str, Mode]]:
    sites = {
        row["sitecode"]: row["urlbase"]
        for row in data["inducks_site"]
        if row["images"] == "Y"
        and row["urlbase"].startswith("http")
        and not row["sitecode"].startswith(DERIVATIVE_SITES)
    }
    log.info("Sites d'images retenus : %d", len(sites))

    # 1. Scans publics de premières pages.
    scans: dict[str, tuple[str, str]] = {}
    for row in data["inducks_entryurl"]:
        if row["public"] != "Y" or row["pagenumber"] not in ("1", "01"):
            continue
        base = sites.get(row["sitecode"])
        if not base or not row["url"].lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        current = scans.get(row["entrycode"])
        candidate = (base + row["url"].lstrip("/"), row["url"])
        if current is None or candidate[1] < current[1]:
            scans[row["entrycode"]] = candidate
    log.info("Entrées avec scan public de page 1 : %d", len(scans))

    versions = {
        row["storyversioncode"]: (row["storycode"], row["kind"])
        for row in data["inducks_storyversion"]
    }
    # Une vraie planche : au moins une page entière et trois bandes ou plus.
    # Écarte les strips de journaux, dont le « premier scan » n'est qu'une bande.
    page_layout = {
        row["storyversioncode"]
        for row in data["inducks_storyversion"]
        if (to_int(row["entirepages"]) or 0) >= 1
        and (to_int(row["rowsperpage"]) is None or to_int(row["rowsperpage"]) >= 3)
    }

    # 2. Publications françaises récentes (pour le mode « magazines français »).
    french_pubs = {
        row["publicationcode"]
        for row in data["inducks_publication"]
        if row["countrycode"] == "fr"
    }
    recent_from = today.year - RECENT_YEARS
    recent_french_issues = {
        row["issuecode"]
        for row in data["inducks_issue"]
        if row["publicationcode"] in french_pubs
        and (year_of(row["oldestdate"]) or 0) >= recent_from
    }
    log.info("Numéros français depuis %d : %d", recent_from, len(recent_french_issues))

    recent_french_stories: Counter[str] = Counter()
    french_titles: dict[str, str] = {}
    scanned_entries: dict[str, dict] = {}
    for row in data["inducks_entry"]:
        svc = row["storyversioncode"]
        if not svc:
            continue
        if row["languagecode"] == "fr" and row["title"]:
            story = versions.get(svc, ("", ""))[0]
            if story and story not in french_titles:
                french_titles[story] = row["title"]
        if row["issuecode"] in recent_french_issues:
            story = versions.get(svc, ("", ""))[0]
            if story:
                recent_french_stories[story] += 1
        if row["entrycode"] in scans:
            scanned_entries[row["entrycode"]] = row
    log.info("Histoires publiées en France récemment : %d", len(recent_french_stories))

    # 3. Un seul dessinateur, sans doute sur l'attribution.
    needed_versions = {row["storyversioncode"] for row in scanned_entries.values()}
    artists_of: dict[str, set[str]] = defaultdict(set)
    for row in data["inducks_storyjob"]:
        if row["storyversioncode"] in needed_versions and row["plotwritartink"] == "a":
            if row["doubt"] == "Y":
                artists_of[row["storyversioncode"]].add("?")
            else:
                artists_of[row["storyversioncode"]].add(row["personcode"])

    persons = {row["personcode"]: row for row in data["inducks_person"]}
    stories = {row["storycode"]: row for row in data["inducks_story"]}

    def usable_artist(code: str) -> bool:
        person = persons.get(code)
        if not person or person["isfake"] == "Y" or code.startswith("?"):
            return False
        name = person["fullname"]
        return bool(name) and "?" not in name and "studio" not in name.lower()

    # 4. Un item par version d'histoire, en privilégiant un scan d'édition française.
    best: dict[str, tuple[tuple, dict]] = {}
    for entrycode, entry in scanned_entries.items():
        if entry["is_cover"] in ("1", "Y") or entry["mirrored"] == "Y" or entry["sideways"] == "Y":
            continue
        svc = entry["storyversioncode"]
        storycode, kind = versions.get(svc, ("", ""))
        if kind != "n" or not storycode or svc not in page_layout:
            continue
        artists = artists_of.get(svc, set())
        if len(artists) != 1:
            continue
        (artist,) = artists
        if not usable_artist(artist):
            continue
        image, url = scans[entrycode]
        french = entry["languagecode"] == "fr" or url.rsplit("/", 1)[-1].startswith("fr_")
        rank = (0 if french else 1, 0 if svc.startswith(storycode) else 1, url)
        if storycode in best and best[storycode][0] <= rank:
            continue
        story = stories.get(storycode, {})
        best[storycode] = (
            rank,
            {
                "id": svc,
                "story": storycode,
                "artist": artist,
                "image": image,
                "title": french_titles.get(storycode) or story.get("title", "") or entry["title"],
                "originalTitle": story.get("title", ""),
                "year": year_of(story.get("firstpublicationdate", "")),
                "issue": entry["issuecode"],
                "lang": entry["languagecode"],
            },
        )
    items = [item for _, item in best.values()]
    log.info("Items jouables (dessinateur unique, scan public) : %d", len(items))

    by_artist: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        by_artist[item["artist"]].append(item)

    # 5. Modes de jeu.
    def nationality(code: str) -> str:
        return persons[code]["nationalitycountrycode"]

    modes = {
        "us": Mode("us", "Les Américains", "Barks, Gottfredson, Murry et les autres dessinateurs des États-Unis."),
        "it": Mode("it", "Les Italiens", "Scarpa, Cavazzano, De Vita : l'école de Topolino."),
        "francais": Mode(
            "francais",
            "Les Français",
            "Claude Marin, Pierre Nicolas, Thomas Cabellic : les dessinateurs du Journal de Mickey et de Picsou Magazine.",
        ),
        "egmont": Mode(
            "egmont",
            "L'école Egmont",
            "Vicar, Branca, Ferioli, Midthun : les histoires produites pour l'Europe du Nord.",
        ),
        "fr": Mode(
            "fr",
            "Lu en France",
            f"Tout ce que la presse française a publié depuis {recent_from}, d'où qu'il vienne.",
        ),
        "tous": Mode(
            "tous",
            "Tous les dessinateurs",
            "Les soixante dessinateurs les plus publiés, tous pays et toutes époques confondus.",
        ),
        "debutant": Mode(
            "debutant",
            "Débutant",
            "Les grands noms aux styles bien reconnaissables, pour se faire l'œil.",
        ),
    }

    def fill(mode: Mode, keep, *, max_artists=MAX_ARTISTS_PER_MODE, max_items=MAX_ITEMS_PER_ARTIST, min_items=MIN_ITEMS_PER_ARTIST) -> None:
        pool: dict[str, list[dict]] = {}
        totals: dict[str, int] = {}
        for artist, artist_items in by_artist.items():
            selected = [item for item in artist_items if keep(item)]
            if len(selected) >= min_items:
                selected.sort(key=lambda item: stable_key(mode.id, item["id"]))
                totals[artist] = len({item["story"] for item in selected})
                pool[artist] = selected[:max_items]
        # Les plus publiés d'abord, et non l'ordre alphabétique.
        ranked = sorted(pool, key=lambda a: (-totals[a], a))[:max_artists]
        mode.artists = ranked
        mode.counts = [totals[a] for a in ranked]
        mode.items = [item for artist in ranked for item in pool[artist]]

    fill(modes["us"], lambda item: nationality(item["artist"]) == "us")
    fill(modes["it"], lambda item: nationality(item["artist"]) == "it")
    # Les Français : nationalité française, ou nationalité non renseignée mais des histoires
    # surtout produites en France (codes « F »). Moins de planches scannées : quatre cases suffisent.
    french_made: dict[str, float] = {}
    for artist, artist_items in by_artist.items():
        french_made[artist] = sum(item["story"].startswith("F ") for item in artist_items) / len(artist_items)

    def is_french(code: str) -> bool:
        country = nationality(code)
        return country == "fr" or (not country and french_made.get(code, 0) >= 0.6)

    fill(modes["francais"], lambda item: is_french(item["artist"]), min_items=4)
    # Les codes d'histoire « D » sont ceux des productions Egmont (Danemark).
    fill(modes["egmont"], lambda item: item["story"].startswith("D "))
    fill(modes["tous"], lambda item: True, max_artists=ALL_ARTISTS, max_items=ALL_ITEMS_PER_ARTIST)
    fill(modes["fr"], lambda item: recent_french_stories[item["story"]] > 0)

    wanted = {fold(name) for name in BEGINNER_NAMES}
    beginners = {code for code in by_artist if fold(persons[code]["fullname"]) in wanted}
    log.info("Débutant : %d dessinateurs trouvés sur %d", len(beginners), len(wanted))
    fill(modes["debutant"], lambda item: item["artist"] in beginners)

    for mode in list(modes.values()):
        if len(mode.artists) < ARTISTS_PER_GAME:
            log.warning("Mode %s ignoré : %d dessinateurs seulement", mode.id, len(mode.artists))
            del modes[mode.id]
        else:
            log.info("Mode %-9s %3d dessinateurs, %5d cases", mode.id, len(mode.artists), len(mode.items))
            log.info("    %s", ", ".join(f"{clean_name(persons[a]['fullname'])} ({n})" for a, n in zip(mode.artists, mode.counts)))

    used = {a for mode in modes.values() for a in mode.artists}
    artists = {}
    for code in sorted(used):
        person = persons[code]
        artists[code] = {
            "name": clean_name(person["fullname"]),
            "country": person["nationalitycountrycode"],
            "born": year_of(person["borndate"]),
            "died": year_of(person["deceaseddate"]),
            "photo": person["photofilename"] or None,
        }
    return artists, modes


# --------------------------------------------------------------------------
# Défis du jour


def weight(count: int) -> float:
    """Les dessinateurs prolifiques sortent plus souvent, sans écraser les autres."""
    return max(count, 1) ** 0.5


def weighted_sample(rng: random.Random, codes: list[str], counts: list[int], k: int) -> list[str]:
    pool = list(zip(codes, counts or [1] * len(codes)))
    chosen = []
    while len(chosen) < k and pool:
        total = sum(weight(c) for _, c in pool)
        pick = rng.random() * total
        for index, (code, count) in enumerate(pool):
            pick -= weight(count)
            if pick <= 0:
                break
        chosen.append(code)
        pool.pop(index)
    return chosen


def daily_game(mode: Mode, day: dt.date) -> dict:
    rng = random.Random(f"coup-de-patte/{day.isoformat()}/{mode.id}")
    artists = weighted_sample(rng, mode.artists, mode.counts, ARTISTS_PER_GAME)
    answers = rng.sample(artists, ROUNDS_PER_GAME)
    by_artist: dict[str, list[dict]] = defaultdict(list)
    for item in mode.items:
        by_artist[item["artist"]].append(item)
    rounds = [rng.choice(sorted(by_artist[a], key=lambda i: i["id"]))["id"] for a in answers]
    return {"mode": mode.id, "artists": sorted(artists), "rounds": rounds}


def extend_daily(previous: dict, modes: dict[str, Mode], today: dt.date) -> dict:
    """Ajoute les jours manquants sans toucher aux jours déjà publiés."""
    days = dict(previous.get("days", {}))
    first = min(LAUNCH_DATE, today)
    day = first
    while day <= today + dt.timedelta(days=DAILY_DAYS_AHEAD):
        key = day.isoformat()
        if key not in days:
            mode_id = DAILY_ROTATION[day.weekday()]
            mode = modes.get(mode_id) or next(iter(modes.values()))
            days[key] = daily_game(mode, day)
        day += dt.timedelta(days=1)
    return {"launch": LAUNCH_DATE.isoformat(), "days": dict(sorted(days.items()))}


# --------------------------------------------------------------------------
# Écriture


def compact_item(item: dict) -> list:
    """Format compact : [id, histoire, dessinateur, image, titre, titre original, année, numéro]."""
    title = item["title"]
    original = item["originalTitle"] if item["originalTitle"] != title else ""
    return [
        item["id"], item["story"], item["artist"], item["image"],
        title, original, item["year"], item["issue"],
    ]


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    path.write_text(text + "\n", encoding="utf-8")


def write_outputs(out: Path, artists: dict, modes: dict[str, Mode], today: dt.date, source: str) -> None:
    daily_path = out / "daily.json"
    previous = json.loads(daily_path.read_text(encoding="utf-8")) if daily_path.exists() else {}

    # Les défis déjà publiés doivent rester jouables : on garde leurs items.
    kept_ids = {i for game in previous.get("days", {}).values() for i in game["rounds"]}
    daily = extend_daily(previous, modes, today)
    needed = {i for game in daily["days"].values() for i in game["rounds"]}

    all_items = {item["id"]: item for mode in modes.values() for item in mode.items}
    old_items = {}
    old_path = out / "archive.json"
    if old_path.exists():
        old_items = {row[0]: row for row in json.loads(old_path.read_text(encoding="utf-8"))["items"]}
    archive_rows = []
    for item_id in sorted(needed | kept_ids):
        if item_id in all_items:
            archive_rows.append(compact_item(all_items[item_id]))
        elif item_id in old_items:
            archive_rows.append(old_items[item_id])
    # Les neuf dessinateurs de chaque défi, leurre compris, doivent rester connus.
    archived_artists = {row[2] for row in archive_rows} | {
        code for game in daily["days"].values() for code in game["artists"]
    }
    old_artists = {}
    if old_path.exists():
        old_artists = json.loads(old_path.read_text(encoding="utf-8")).get("artists", {})
    archive_artist_info = {
        code: artists.get(code) or old_artists.get(code)
        for code in sorted(archived_artists)
        if artists.get(code) or old_artists.get(code)
    }

    for mode in modes.values():
        write_json(
            out / f"mode-{mode.id}.json",
            {
                "mode": mode.id,
                "artists": mode.artists,
                "counts": mode.counts,
                "items": [compact_item(i) for i in mode.items],
            },
        )
    write_json(out / "artists.json", artists)
    write_json(daily_path, daily)
    write_json(old_path, {"artists": archive_artist_info, "items": archive_rows})
    write_json(
        out / "meta.json",
        {
            "generated": today.isoformat(),
            "source": source,
            "rounds": ROUNDS_PER_GAME,
            "artistsPerGame": ARTISTS_PER_GAME,
            "modes": [
                {
                    "id": m.id,
                    "name": m.name,
                    "blurb": m.blurb,
                    "artists": len(m.artists),
                    "items": len(m.items),
                    "faces": m.artists[:4],
                }
                for m in modes.values()
            ],
        },
    )
    log.info("Fichiers écrits dans %s", out)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--today", type=dt.date.fromisoformat, default=dt.date.today())
    parser.add_argument("--source", default="https://inducks.org/inducks/isv.tgz")
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    data = load_tables(args.archive)
    artists, modes = build(data, args.today)
    if len(modes) < 2:
        log.error("Trop peu de modes jouables, on garde les données précédentes.")
        return 1
    write_outputs(args.out, artists, modes, args.today, args.source)
    return 0


if __name__ == "__main__":
    sys.exit(main())

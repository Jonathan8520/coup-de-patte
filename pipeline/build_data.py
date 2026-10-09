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
        "is_cover", "mirrored", "sideways", "entrycomment", "changes",
    ),
    "inducks_storyversion": ("storyversioncode", "storycode", "kind", "entirepages", "rowsperpage"),
    "inducks_storyjob": ("storyversioncode", "personcode", "plotwritartink", "doubt"),
    "inducks_person": (
        "personcode", "nationalitycountrycode", "fullname", "isfake",
        "borndate", "deceaseddate", "photofilename",
    ),
    "inducks_story": ("storycode", "title", "firstpublicationdate", "storycomment"),
    "inducks_storyreference": ("fromstorycode", "tostorycode", "referencereasonid"),
    "inducks_referencereason": ("referencereasonid", "referencereasontext"),
    "inducks_storysubseries": ("storycode", "subseriescode"),
    "inducks_issue": ("issuecode", "publicationcode", "oldestdate"),
    "inducks_publication": ("publicationcode", "countrycode"),
}

# Noms alternatifs déjà vus pour certaines colonnes.
ALIASES = {"is_cover": ("iscover", "isCover")}

# Sites qui ne contiennent que des copies réduites ou renommées d'autres sites.
DERIVATIVE_SITES = ("thumbnails", "renamed")

COLLECTIVE = re.compile(r"\b(studio|studios|atelier|ateliers|creations|team|staff|equipe|collectif)\b")

# Dessins qui ne sont pas (ou pas seulement) de la main du dessinateur crédité.
# Lien vers une autre histoire dont on a repris le dessin : remake, cases reproduites,
# remontage, encrage repris, flashback… Les reprises d'idée, d'intrigue ou de gag ne
# touchent pas au dessin et restent permises.
BORROWED_ART = re.compile(
    r"remake|remade|re-?used|recycl|remount|re-?ink|inked and completed|redraw|reproduc|excerpt|extract"
    r"|edited art|filling in|recreation|\bpanels?\b|\bframe\b|swipe|cop(?:y|ied)|trac(?:e|ed|ing)\b"
    r"|storyboard|layout|flashback|memor",
    re.I,
)
IDEA_ONLY = re.compile(r"\b(idea|ideas|plot|gag|name|text|theme|mention(ed)?)\b", re.I)
# Parution dont le dessin a été redessiné, décalqué ou retouché par quelqu'un d'autre.
RETOUCHED = re.compile(r"redraw|re-drawn|trac(?:e|ed|ing)\b|retouch|repaint|new art", re.I)
# Parution dont le commentaire donne l'auteur du dessin original ([org.art:TeA]) : c'est un
# redessin ou un calque, le trait n'est plus celui de la fiche.
ORIGINAL_ART_NOTE = re.compile(r"\borg\.(?:art|ink|pencils?)\s*:", re.I)
# Jeux (cases à remettre dans l'ordre, devinettes en images) : souvent montés avec le dessin d'un autre.
GAME_ENTRY = re.compile(r"\[(?:game|puzzle|quiz)\b|^game\b", re.I)
GAME_SUBSERIES = {"Order the panels"}
# Commentaire d'histoire qui annonce un redessin d'une autre histoire.
REDRAWN_STORY = re.compile(r"\bredraw|\bredrawn|re-drawn|\bremake\b|\btraced\b|\bswipe", re.I)

MIN_ITEMS_PER_ARTIST = 6
MAX_ITEMS_PER_ARTIST = 60
MAX_ARTISTS_PER_MODE = 40
ARTISTS_PER_GAME = 9
ROUNDS_PER_GAME = 8
# Mode débutant : de grands noms aux styles bien distincts, quel que soit le pays de publication.
# Kiosques : ce qui a paru récemment dans chaque pays, un par langue de l'interface.
# La France garde l'identifiant « fr » de ses débuts.
KIOSKS = {
    "fr": ("fr",), "lu-it": ("it",), "lu-de": ("de",), "lu-es": ("es",), "lu-br": ("br",),
    "lu-nl": ("nl",), "lu-dk": ("dk",), "lu-no": ("no",), "lu-se": ("se",), "lu-fi": ("fi",),
    "lu-us": ("us", "gb"),
}
# Langues des titres traduits, avec les codes de langue d'Inducks correspondants.
TITLE_LANGS = {
    "en": ("en",), "it": ("it",), "de": ("de",), "es": ("es",), "pt": ("pt-br", "pt"),
    "nl": ("nl",), "da": ("da",), "nb": ("no", "nb"), "sv": ("sv",), "fi": ("fi",),
}
# Identifiants historiques des modes par pays.
COUNTRY_IDS = {"us": "us", "it": "it", "fr": "francais"}
COUNTRY_MIN_ITEMS = 4

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
    # selection, country (nationalité), production (code d'histoire) ou kiosk (pays de publication)
    kind: str = "selection"
    countries: tuple[str, ...] = ()
    items: list[dict] = field(default_factory=list)
    artists: list[str] = field(default_factory=list)
    # Nombre total d'histoires jouables par dessinateur (avant plafonnement) : sert de poids au tirage.
    counts: list[int] = field(default_factory=list)
    # Histoires jouables de tous les dessinateurs retenus avant plafonnement : la taille de
    # l'école, qui sert à ranger les modes par pays.
    stories: int = 0


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


# Ce que la dernière construction a écarté pour cause de dessin d'un autre, par raison,
# et toutes les cases jouables avant le choix des modes (identifiant -> dessinateur).
EXCLUDED: dict[str, set[str]] = defaultdict(set)
ELIGIBLE: dict[str, str] = {}


def build(data: dict[str, list[dict]], today: dt.date) -> tuple[dict, dict[str, Mode]]:
    EXCLUDED.clear()
    ELIGIBLE.clear()
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

    # 2. Publications récentes de chaque pays (pour les kiosques).
    kiosk_countries = {country for countries in KIOSKS.values() for country in countries}
    pub_country = {
        row["publicationcode"]: row["countrycode"]
        for row in data["inducks_publication"]
        if row["countrycode"] in kiosk_countries
    }
    recent_from = today.year - RECENT_YEARS
    recent_issues = {
        row["issuecode"]: pub_country[row["publicationcode"]]
        for row in data["inducks_issue"]
        if row["publicationcode"] in pub_country
        and (year_of(row["oldestdate"]) or 0) >= recent_from
    }
    log.info("Numéros récents (depuis %d) dans les pays des kiosques : %d", recent_from, len(recent_issues))

    recent_stories: dict[str, set[str]] = defaultdict(set)
    french_titles: dict[str, str] = {}
    scanned_entries: dict[str, dict] = {}
    languages: Counter[str] = Counter()
    for row in data["inducks_entry"]:
        svc = row["storyversioncode"]
        if not svc:
            continue
        languages[row["languagecode"]] += 1
        if row["languagecode"] == "fr" and row["title"]:
            story = versions.get(svc, ("", ""))[0]
            if story and story not in french_titles:
                french_titles[story] = row["title"]
        country = recent_issues.get(row["issuecode"])
        if country:
            story = versions.get(svc, ("", ""))[0]
            if story:
                recent_stories[country].add(story)
        if row["entrycode"] in scans:
            # Parution redessinée, décalquée ou présentée comme un jeu : le scan montre
            # le trait de quelqu'un d'autre, ou un montage. Une autre parution peut servir.
            if RETOUCHED.search(row["changes"]) or ORIGINAL_ART_NOTE.search(row["entrycomment"]):
                EXCLUDED["parution redessinée ou décalquée"].add(row["entrycode"])
            elif GAME_ENTRY.search(row["entrycomment"]):
                EXCLUDED["parution présentée comme un jeu"].add(row["entrycode"])
            else:
                scanned_entries[row["entrycode"]] = row
    log.info("Langues d'Inducks les plus présentes : %s", ", ".join(f"{k} ({v})" for k, v in languages.most_common(25)))
    for country in sorted(recent_stories):
        log.info("Histoires parues récemment, %s : %d", country, len(recent_stories[country]))

    # 3. Un seul dessinateur, sans doute sur l'attribution.
    needed_versions = {row["storyversioncode"] for row in scanned_entries.values()}

    # Histoires qui reprennent le dessin d'une autre (remake, cases reproduites, remontage…).
    reasons = {row["referencereasonid"]: row["referencereasontext"] for row in data["inducks_referencereason"]}
    borrows: dict[str, set[str]] = defaultdict(set)
    for row in data["inducks_storyreference"]:
        text = reasons.get(row["referencereasonid"], "")
        if BORROWED_ART.search(text) and not IDEA_ONLY.search(text):
            borrows[row["fromstorycode"]].add(row["tostorycode"])
    sources = set().union(*borrows.values()) if borrows else set()

    artists_of: dict[str, set[str]] = defaultdict(set)
    art_of_source: dict[str, set[str]] = defaultdict(set)
    for row in data["inducks_storyjob"]:
        if row["plotwritartink"] != "a":
            continue
        who = "?" if row["doubt"] == "Y" else row["personcode"]
        if row["storyversioncode"] in needed_versions:
            artists_of[row["storyversioncode"]].add(who)
        story = versions.get(row["storyversioncode"], ("", ""))[0]
        if story in sources:
            art_of_source[story].add(who)

    def borrowed_from_someone_else(storycode: str, artist: str) -> bool:
        # Un remake par le même dessinateur reste de sa main ; un original au dessinateur
        # inconnu compte comme celui d'un autre.
        return any((art_of_source.get(source) or {"?"}) - {artist} for source in borrows.get(storycode, ()))

    game_stories = {row["storycode"] for row in data["inducks_storysubseries"] if row["subseriescode"] in GAME_SUBSERIES}
    redrawn_stories = {row["storycode"] for row in data["inducks_story"] if REDRAWN_STORY.search(row["storycomment"])}

    persons = {row["personcode"]: row for row in data["inducks_person"]}
    stories = {row["storycode"]: row for row in data["inducks_story"]}

    def usable_artist(code: str) -> bool:
        person = persons.get(code)
        if not person or person["isfake"] == "Y" or code.startswith("?"):
            return False
        name = person["fullname"]
        # Les collectifs (studios, ateliers, équipes) n'ont pas un trait unique à reconnaître.
        return bool(name) and "?" not in name and not COLLECTIVE.search(fold(name))

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
        if storycode in game_stories:
            EXCLUDED["jeu (cases à remettre dans l'ordre…)"].add(storycode)
            continue
        if storycode in redrawn_stories:
            EXCLUDED["redessin d'une autre histoire (commentaire)"].add(storycode)
            continue
        if borrowed_from_someone_else(storycode, artist):
            EXCLUDED["dessin repris d'une histoire d'un autre dessinateur"].add(storycode)
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
    ELIGIBLE.update((item["id"], item["artist"]) for item in items)
    log.info("Items jouables (dessinateur unique, scan public) : %d", len(items))
    for reason, codes in EXCLUDED.items():
        log.info("Écartés, %s : %d", reason, len(codes))

    by_artist: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        by_artist[item["artist"]].append(item)

    # Titres dans les autres langues de l'interface : le plus fréquent parmi les parutions.
    playable_stories = {item["story"] for item in items}
    inducks_to_lang = {code: lang for lang, codes in TITLE_LANGS.items() for code in codes}
    title_counts: dict[str, dict[str, Counter]] = defaultdict(lambda: defaultdict(Counter))
    for row in data["inducks_entry"]:
        lang = inducks_to_lang.get(row["languagecode"])
        if not lang or not row["title"]:
            continue
        story = versions.get(row["storyversioncode"], ("", ""))[0]
        if story in playable_stories:
            title_counts[lang][story][re.sub(r"\s+", " ", row["title"]).strip()] += 1
    titles = {
        lang: {story: counts.most_common(1)[0][0] for story, counts in per_story.items()}
        for lang, per_story in title_counts.items()
    }
    for lang in TITLE_LANGS:
        log.info("Titres traduits, %s : %d", lang, len(titles.get(lang, {})))

    # 5. Modes de jeu.
    def nationality(code: str) -> str:
        return persons[code]["nationalitycountrycode"]

    modes = {
        "egmont": Mode(
            "egmont",
            "L'école Egmont",
            "Vicar, Branca, Ferioli, Midthun : les histoires produites pour l'Europe du Nord.",
            kind="production",
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
        mode.stories = sum(totals.values())

    # Les Français : nationalité française, ou nationalité non renseignée mais des histoires
    # surtout produites en France (codes « F »). Moins de planches scannées : quatre cases suffisent.
    french_made: dict[str, float] = {}
    for artist, artist_items in by_artist.items():
        french_made[artist] = sum(item["story"].startswith("F ") for item in artist_items) / len(artist_items)

    def is_french(code: str) -> bool:
        country = nationality(code)
        return country == "fr" or (not country and french_made.get(code, 0) >= 0.6)

    def country_of(code: str) -> str:
        return "fr" if is_french(code) else nationality(code)

    # Un mode par pays de naissance du trait : il en faut neuf dessinateurs pour jouer.
    countries = Counter(country_of(artist) for artist in by_artist if country_of(artist))
    for country in sorted(countries):
        mode_id = COUNTRY_IDS.get(country, f"pays-{country}")
        mode = Mode(mode_id, country.upper(), "", kind="country", countries=(country,))
        fill(mode, lambda item, c=country: country_of(item["artist"]) == c, min_items=COUNTRY_MIN_ITEMS)
        if len(mode.artists) >= ARTISTS_PER_GAME:
            modes[mode_id] = mode

    # Les codes d'histoire « D » sont ceux des productions Egmont (Danemark).
    fill(modes["egmont"], lambda item: item["story"].startswith("D "))
    fill(modes["tous"], lambda item: True, max_artists=ALL_ARTISTS, max_items=ALL_ITEMS_PER_ARTIST)

    for kiosk_id, kiosk_countries_ in KIOSKS.items():
        published = set().union(*(recent_stories.get(c, set()) for c in kiosk_countries_))
        mode = Mode(kiosk_id, "Kiosque", f"Tout ce qui y a paru depuis {recent_from}.", kind="kiosk", countries=kiosk_countries_)
        fill(mode, lambda item, p=published: item["story"] in p)
        modes[kiosk_id] = mode

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
    return artists, modes, titles, recent_from


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


def extend_daily(previous: dict, modes: dict[str, Mode], today: dt.date, eligible: set[str] | None = None) -> dict:
    """Ajoute les jours manquants sans toucher aux jours déjà joués.

    Un jour à venir dont une case n'est plus jouable (écartée depuis, scan retiré) est
    refait : personne ne l'a encore vu. Les jours passés, aujourd'hui et demain (déjà
    commencé pour les fuseaux en avance sur UTC) ne bougent jamais.
    """
    days = dict(previous.get("days", {}))
    if eligible:
        for key, game in list(days.items()):
            day = dt.date.fromisoformat(key)
            if day > today + dt.timedelta(days=1) and not set(game["rounds"]) <= eligible:
                mode = modes.get(game["mode"]) or modes.get(DAILY_ROTATION[day.weekday()]) or next(iter(modes.values()))
                days[key] = daily_game(mode, day)
                log.info("Défi du %s refait : une de ses cases n'est plus jouable", key)
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


def write_outputs(
    out: Path,
    artists: dict,
    modes: dict[str, Mode],
    today: dt.date,
    source: str,
    titles: dict[str, dict[str, str]] | None = None,
    recent_from: int | None = None,
    eligible: set[str] | None = None,
) -> None:
    daily_path = out / "daily.json"
    previous = json.loads(daily_path.read_text(encoding="utf-8")) if daily_path.exists() else {}

    # Les défis déjà publiés doivent rester jouables : leurs cases restent dans l'archive,
    # même si elles ont quitté les modes depuis.
    daily = extend_daily(previous, modes, today, eligible)
    needed = {i for game in daily["days"].values() for i in game["rounds"]}

    all_items = {item["id"]: item for mode in modes.values() for item in mode.items}
    old_items = {}
    old_path = out / "archive.json"
    if old_path.exists():
        old_items = {row[0]: row for row in json.loads(old_path.read_text(encoding="utf-8"))["items"]}
    archive_rows = []
    for item_id in sorted(needed):
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
    # Titres traduits, limités aux histoires réellement jouables (modes et défis du jour).
    in_play = {item["story"] for mode in modes.values() for item in mode.items} | {row[1] for row in archive_rows}
    for lang, by_story in (titles or {}).items():
        write_json(out / "titles" / f"{lang}.json", {story: by_story[story] for story in sorted(in_play) if story in by_story})
    write_json(daily_path, daily)
    write_json(old_path, {"artists": archive_artist_info, "items": archive_rows})
    write_json(
        out / "meta.json",
        {
            "generated": today.isoformat(),
            "source": source,
            "rounds": ROUNDS_PER_GAME,
            "artistsPerGame": ARTISTS_PER_GAME,
            "recentFrom": recent_from,
            "modes": [
                {
                    "id": m.id,
                    "kind": m.kind,
                    "countries": list(m.countries),
                    "name": m.name,
                    "blurb": m.blurb,
                    "artists": len(m.artists),
                    "items": len(m.items),
                    "stories": m.stories,
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
    artists, modes, titles, recent_from = build(data, args.today)
    if len(modes) < 2:
        log.error("Trop peu de modes jouables, on garde les données précédentes.")
        return 1
    write_outputs(args.out, artists, modes, args.today, args.source, titles, recent_from, set(ELIGIBLE))
    return 0


if __name__ == "__main__":
    sys.exit(main())

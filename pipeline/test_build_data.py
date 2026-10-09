"""Tests du pipeline sur une petite archive Inducks fabriquée à la main.

Lancer : python -m unittest discover -s pipeline
"""

from __future__ import annotations

import datetime as dt
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

import build_data as bd

TODAY = dt.date(2026, 10, 9)


def isv(header: list[str], rows: list[list[str]]) -> bytes:
    lines = ["^".join(header)] + ["^".join(map(str, row)) for row in rows]
    return ("\n".join(lines) + "\n").encode("utf-8")


def make_archive(path: Path, traced: frozenset[str] = frozenset()) -> None:
    files: dict[str, bytes] = {}
    files["inducks_site.isv"] = isv(
        ["sitecode", "urlbase", "images", "sitename"],
        [
            ["webusers", "https://outducks.org/webusers/webusers/", "Y", "Web"],
            ["thumbnails3", "https://outducks.org/thumbnails3/", "Y", "Mini"],
            ["link", "https://example.org/", "N", "Liens"],
        ],
    )
    persons, stories, versions, jobs, entries, urls = [], [], [], [], [], []
    issues = [
        ["fr/PM 500", "fr/PM", "2015-03-01"],
        ["fr/PM 100", "fr/PM", "1975-03-01"],
        ["us/WDC 100", "us/WDC", "1950-01-01"],
    ]
    for nat, prefix, count in (("us", "U", 10), ("it", "I", 10), ("fr", "F", 9), ("", "N", 1)):
        for a in range(count):
            code = f"{prefix}{a}"
            persons.append([code, nat, f"Artiste {code}", "N", "1930-01-01", "", f"{code}.jpg"])
            for s in range(8 if nat not in ("fr", "") else 5):
                storycode = f"{'F' if prefix == 'N' else prefix} {prefix}{a}-{s}"
                svc = f"{storycode}A"
                stories.append([storycode, f"Story {storycode}", f"19{50 + s}-01-01", ""])
                versions.append([svc, storycode, "n", "10", "4"])
                jobs.append([svc, code, "a", "N"])
                jobs.append([svc, "W1", "s", "N"])
                issue = "fr/PM 500" if s < 6 else "us/WDC 100"
                for printing in range(2):
                    entrycode = f"e{prefix}{a}{s}{printing}"
                    lang = "fr" if printing == 0 else "en"
                    changes = "traced" if svc in traced else ""
                    entries.append([entrycode, issue, svc, lang, f"Titre {storycode}", "0", "N", "N", "", changes])
                    filename = f"{lang}_{prefix.lower()}{a}{s}_001.jpg"
                    urls.append([entrycode, "webusers", "1", f"2020/01/{filename}", storycode, "Y"])
                    urls.append([entrycode, "thumbnails3", "1", f"webusers/{filename}", storycode, "Y"])
    # Cas à écarter : deux dessinateurs, attribution douteuse, couverture, scan privé,
    # puis les dessins qui ne sont pas de la main du dessinateur crédité : remake d'une
    # histoire d'un autre, parution décalquée, jeu, sous-série de jeux, redessin annoncé.
    # X 9 (simple suite) et X 11 (remake de sa propre histoire) restent jouables.
    persons.append(["?", "", "?", "Y", "", "", ""])
    references = [
        ["X 6", "I I0-0", "9"],
        ["X 9", "I I0-0", "4"],
        ["X 11", "U U1-0", "9"],
        ["X 13", "I I0-1", "77"],
    ]
    subseries = [["X 10", "Order the panels"]]
    for svc, artists, cover, public, comment, changes, storycomment, issue in (
        ("X 1A", ["U1", "U2"], "0", "Y", "", "", "", "fr/PM 500"),
        ("X 2A", ["U1"], "1", "Y", "", "", "", "fr/PM 500"),
        ("X 3A", ["U1"], "0", "N", "", "", "", "fr/PM 500"),
        ("X 4A", ["?"], "0", "Y", "", "", "", "fr/PM 500"),
        ("X 5A", ["U1"], "0", "Y", "", "", "", "fr/PM 500"),
        ("X 6A", ["U1"], "0", "Y", "", "", "", "fr/PM 500"),
        ("X 7A", ["U1"], "0", "Y", "", "redrawn/traced", "", "fr/PM 500"),
        ("X 8A", ["U1"], "0", "Y", "[game]", "", "", "fr/PM 500"),
        ("X 9A", ["U1"], "0", "Y", "", "", "", "us/WDC 100"),
        ("X 10A", ["U1"], "0", "Y", "", "", "", "fr/PM 500"),
        ("X 11A", ["U1"], "0", "Y", "", "", "", "us/WDC 100"),
        ("X 12A", ["U1"], "0", "Y", "", "", "Redrawn with ducks instead of mice", "fr/PM 500"),
        ("X 13A", ["U1"], "0", "Y", "", "", "", "fr/PM 500"),
        ("X 14A", ["U1"], "0", "Y", "[pg;1] [org.art:TeA]", "", "", "fr/PM 500"),
    ):
        storycode = svc[:-1]
        stories.append([storycode, "Piège", "1960", storycomment])
        versions.append([svc, storycode, "n", "0" if svc == "X 5A" else "10", "1" if svc == "X 5A" else "4"])
        for artist in artists:
            jobs.append([svc, artist, "a", "N"])
        entries.append([f"e{svc}", issue, svc, "fr", "Piège", cover, "N", "N", comment, changes])
        urls.append([f"e{svc}", "webusers", "1", f"2020/01/fr_{svc}.jpg", storycode, public])

    files["inducks_person.isv"] = isv(
        ["personcode", "nationalitycountrycode", "fullname", "isfake", "borndate", "deceaseddate", "photofilename"],
        persons,
    )
    files["inducks_story.isv"] = isv(["storycode", "title", "firstpublicationdate", "storycomment"], stories)
    files["inducks_storyreference.isv"] = isv(["fromstorycode", "tostorycode", "referencereasonid"], references)
    files["inducks_referencereason.isv"] = isv(
        ["referencereasonid", "referencereasontext"], [["4", "sequel"], ["9", "remake"], ["77", "panel 3, page 9"], ["78", "plot reused"]]
    )
    files["inducks_storysubseries.isv"] = isv(["storycode", "subseriescode", "storysubseriescomment"], [[*row, ""] for row in subseries])
    files["inducks_storyversion.isv"] = isv(["storyversioncode", "storycode", "kind", "entirepages", "rowsperpage"], versions)
    files["inducks_storyjob.isv"] = isv(["storyversioncode", "personcode", "plotwritartink", "doubt"], jobs)
    files["inducks_entry.isv"] = isv(
        ["entrycode", "issuecode", "storyversioncode", "languagecode", "title", "is_cover", "mirrored", "sideways", "entrycomment", "changes"],
        entries,
    )
    files["inducks_entryurl.isv"] = isv(["entrycode", "sitecode", "pagenumber", "url", "storycode", "public"], urls)
    files["inducks_issue.isv"] = isv(["issuecode", "publicationcode", "oldestdate"], issues)
    files["inducks_publication.isv"] = isv(
        ["publicationcode", "countrycode"], [["fr/PM", "fr"], ["us/WDC", "us"]]
    )
    files["createtables.sql"] = b"-- inutile ici\n"
    with tarfile.open(path, "w:gz") as tar:
        for name, payload in files.items():
            info = tarfile.TarInfo(f"isv/{name}")
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))


class PipelineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.archive = self.root / "isv.tgz"
        make_archive(self.archive)
        self.out = self.root / "data"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_pipeline(self, today: dt.date = TODAY) -> None:
        code = bd.main(["--archive", str(self.archive), "--out", str(self.out), "--today", today.isoformat()])
        self.assertEqual(code, 0)

    def read(self, name: str):
        return json.loads((self.out / name).read_text(encoding="utf-8"))

    def test_modes_and_filters(self) -> None:
        self.run_pipeline()
        meta = self.read("meta.json")
        self.assertEqual({m["id"] for m in meta["modes"]}, {"us", "it", "fr", "francais", "tous"})
        us = self.read("mode-us.json")
        ids = {row[0] for row in us["items"]}
        self.assertEqual(len(us["artists"]), 10)
        self.assertEqual(len(ids), 82)
        for trap in ("X 1A", "X 2A", "X 3A", "X 4A", "X 5A", "X 6A", "X 7A", "X 8A", "X 10A", "X 12A", "X 13A", "X 14A"):
            self.assertNotIn(trap, ids)
        # Une simple suite, ou le remake de sa propre histoire, restent de la main du dessinateur.
        self.assertIn("X 9A", ids)
        self.assertIn("X 11A", ids)
        self.assertEqual(len(bd.EXCLUDED["dessin repris d'une histoire d'un autre dessinateur"]), 2)
        # Le scan de l'édition française est préféré, jamais le site de vignettes.
        self.assertTrue(all("/fr_" in row[3] and "thumbnails" not in row[3] for row in us["items"]))
        fr = self.read("mode-fr.json")
        self.assertTrue(all(not row[1].endswith(("-6", "-7")) for row in fr["items"]))
        self.assertEqual(len(fr["items"]), 120)
        self.assertNotIn("debutant", {m["id"] for m in self.read("meta.json")["modes"]})
        # Les Français entrent dès quatre cases ici, mais pas dans « Tous » (six cases minimum).
        francais = self.read("mode-francais.json")
        # Le dessinateur sans nationalité mais aux histoires françaises (codes « F ») est inclus.
        self.assertEqual(len(francais["artists"]), 10)
        self.assertIn("N0", francais["artists"])
        self.assertTrue(all(code[0] in "FN" for code in francais["artists"]))
        tous = self.read("mode-tous.json")
        self.assertEqual({code[0] for code in tous["artists"]}, {"U", "I"})

    def test_kinds_and_translated_titles(self) -> None:
        self.run_pipeline()
        meta = {m["id"]: m for m in self.read("meta.json")["modes"]}
        self.assertEqual(meta["us"]["kind"], "country")
        self.assertEqual(meta["us"]["countries"], ["us"])
        self.assertEqual(meta["fr"]["kind"], "kiosk")
        self.assertEqual(meta["tous"]["kind"], "selection")
        self.assertEqual(self.read("meta.json")["recentFrom"], TODAY.year - 20)
        english = self.read("titles/en.json")
        us = self.read("mode-us.json")
        self.assertTrue(english)
        self.assertTrue(set(english) <= {row[1] for m in meta for row in self.read(f"mode-{m}.json")["items"]} | {row[1] for row in self.read("archive.json")["items"]})
        self.assertIn(us["items"][0][1], english)

    def test_daily_is_stable_and_complete(self) -> None:
        self.run_pipeline()
        first = self.read("daily.json")["days"]
        game = first[TODAY.isoformat()]
        self.assertEqual(len(game["artists"]), bd.ARTISTS_PER_GAME)
        self.assertEqual(len(game["rounds"]), bd.ROUNDS_PER_GAME)
        archive = {row[0]: row for row in self.read("archive.json")["items"]}
        for item_id in game["rounds"]:
            self.assertIn(item_id, archive)
            self.assertIn(archive[item_id][2], game["artists"])
        # Le leurre (neuvième dessinateur) est aussi archivé.
        archived_artists = self.read("archive.json")["artists"]
        for code in game["artists"]:
            self.assertIn(code, archived_artists)
        # Une semaine plus tard, les jours déjà publiés ne bougent pas.
        self.run_pipeline(TODAY + dt.timedelta(days=7))
        later = self.read("daily.json")["days"]
        for day, published in first.items():
            self.assertEqual(later[day], published)
        self.assertGreater(len(later), len(first))

    def test_upcoming_daily_is_redone_when_a_panel_is_dropped(self) -> None:
        self.run_pipeline()
        first = self.read("daily.json")["days"]
        today = first[TODAY.isoformat()]
        later_day = (TODAY + dt.timedelta(days=3)).isoformat()
        dropped = next(i for i in first[later_day]["rounds"] if i not in today["rounds"])
        # La semaine suivante, Inducks signale que toutes les parutions de cette case sont décalquées.
        make_archive(self.archive, traced=frozenset({dropped}))
        self.run_pipeline()
        days = self.read("daily.json")["days"]
        self.assertEqual(days[TODAY.isoformat()], today)
        self.assertNotIn(dropped, days[later_day]["rounds"])
        self.assertEqual(len(days[later_day]["rounds"]), bd.ROUNDS_PER_GAME)
        self.assertEqual(days[later_day]["mode"], first[later_day]["mode"])
        archived = {row[0] for row in self.read("archive.json")["items"]}
        self.assertTrue(set(days[later_day]["rounds"]) <= archived)
        if all(dropped not in game["rounds"] for game in days.values()):
            self.assertNotIn(dropped, archived)


if __name__ == "__main__":
    unittest.main()

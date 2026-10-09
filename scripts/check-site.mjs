// Vérifications rapides avant déploiement : fichiers présents, JSON valides,
// cohérence entre les modes, les dessinateurs et les défis du jour.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const site = new URL("../site/", import.meta.url).pathname;
const problems = [];
const read = (path) => JSON.parse(readFileSync(join(site, path), "utf8"));

for (const file of ["index.html", "css/style.css", "js/app.js"]) {
  if (!existsSync(join(site, file))) problems.push(`Fichier manquant : ${file}`);
}

if (!existsSync(join(site, "data/meta.json"))) {
  console.log("Pas encore de données : le site affichera un message d'attente.");
} else {
  const meta = read("data/meta.json");
  const artists = read("data/artists.json");
  for (const mode of meta.modes) {
    const data = read(`data/mode-${mode.id}.json`);
    if (data.artists.length < meta.artistsPerGame) {
      problems.push(`Mode ${mode.id} : ${data.artists.length} dessinateurs seulement`);
    }
    for (const code of data.artists) {
      if (!artists[code]) problems.push(`Mode ${mode.id} : dessinateur inconnu ${code}`);
    }
    for (const row of data.items) {
      if (!data.artists.includes(row[2])) problems.push(`Mode ${mode.id} : case orpheline ${row[0]}`);
      if (!/^https:\/\//.test(row[3])) problems.push(`Mode ${mode.id} : image invalide ${row[3]}`);
    }
    console.log(`Mode ${mode.id} : ${data.artists.length} dessinateurs, ${data.items.length} cases`);
  }
  const hasDaily = existsSync(join(site, "data/daily.json"));
  const daily = hasDaily ? read("data/daily.json") : { days: {} };
  const archive = hasDaily ? read("data/archive.json") : { items: [] };
  const known = new Set(archive.items.map((row) => row[0]));
  for (const [day, game] of Object.entries(daily.days)) {
    for (const id of game.rounds) {
      if (!known.has(id)) problems.push(`Défi du ${day} : case ${id} absente de l'archive`);
    }
  }
  console.log(`Défis du jour : ${Object.keys(daily.days).length} jours`);
}

if (problems.length) {
  console.error(problems.slice(0, 40).join("\n"));
  process.exit(1);
}
console.log("Site prêt.");

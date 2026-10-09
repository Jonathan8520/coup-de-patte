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
    for (const code of game.artists) {
      if (!artists[code] && !archive.artists?.[code]) problems.push(`Défi du ${day} : dessinateur ${code} inconnu`);
    }
  }
  console.log(`Défis du jour : ${Object.keys(daily.days).length} jours`);
}

// Traductions : mêmes clés et mêmes variables que le français, et aucune clé utilisée
// dans le code qui manquerait au dictionnaire source.
const placeholders = (message) => {
  const texts = typeof message === "object" ? Object.values(message) : [message];
  return new Set(texts.flatMap((text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
};
const langs = [...readFileSync(join(site, "js/i18n.js"), "utf8").matchAll(/code: "([a-z]+)"/g)].map((m) => m[1]);
const fr = read("i18n/fr.json");
for (const code of langs) {
  const path = `i18n/${code}.json`;
  if (!existsSync(join(site, path))) {
    problems.push(`Traduction manquante : ${path}`);
    continue;
  }
  const dict = read(path);
  for (const key of Object.keys(fr)) {
    if (!(key in dict)) problems.push(`${code} : clé absente ${key}`);
    else {
      const want = placeholders(fr[key]);
      const got = placeholders(dict[key]);
      for (const name of got) if (!want.has(name)) problems.push(`${code} : {${name}} inconnu dans ${key}`);
      for (const name of want) {
        if (!got.has(name) && name !== "n") problems.push(`${code} : {${name}} oublié dans ${key}`);
      }
      if (typeof fr[key] === "object" && typeof dict[key] !== "object") problems.push(`${code} : ${key} doit avoir des pluriels`);
    }
  }
  for (const key of Object.keys(dict)) if (!(key in fr)) problems.push(`${code} : clé en trop ${key}`);
}
const sources = ["index.html", ...["app", "views", "game", "dialogs", "util", "data", "modes"].map((n) => `js/${n}.js`)];
for (const file of sources) {
  const text = readFileSync(join(site, file), "utf8");
  const used = [
    ...text.matchAll(/\bt[n]?\("([a-z_.]+)"/g),
    ...text.matchAll(/data-i18n(?:-label)?="([a-z_.]+)"/g),
  ].map((m) => m[1]);
  for (const key of used) if (!(key in fr)) problems.push(`${file} : clé ${key} absente de fr.json`);
}
console.log(`Traductions : ${langs.length} langues, ${Object.keys(fr).length} clés`);

if (problems.length) {
  console.error(problems.slice(0, 40).join("\n"));
  process.exit(1);
}
console.log("Site prêt.");

// Chargement des données générées chaque semaine à partir d'Inducks.

import { lang, locale } from "./i18n.js?v=e0943d2";

const cache = new Map();

async function getJSON(name) {
  if (!cache.has(name)) {
    const promise = fetch(`data/${name}`, { cache: "no-cache" }).then((response) => {
      if (!response.ok) throw new Error(`${name} : HTTP ${response.status}`);
      return response.json();
    });
    cache.set(name, promise);
    promise.catch(() => cache.delete(name));
  }
  return cache.get(name);
}

export const loadMeta = () => getJSON("meta.json");
export const loadArtists = () => getJSON("artists.json");
export const loadDaily = () => getJSON("daily.json");
export const loadArchive = () => getJSON("archive.json");

export async function loadMode(id) {
  const data = await getJSON(`mode-${id}.json`);
  if (!data._items) {
    data._items = data.items.map(toItem);
    data._byArtist = new Map();
    data._byId = new Map();
    for (const item of data._items) {
      if (!data._byArtist.has(item.artist)) data._byArtist.set(item.artist, []);
      data._byArtist.get(item.artist).push(item);
      data._byId.set(item.id, item);
    }
  }
  return data;
}

// [id, histoire, dessinateur, image, titre, titre original, année, numéro]
export function toItem(row) {
  const [id, story, artist, image, title, original, year, issue] = row;
  return { id, story, artist, image, title, original, year, issue };
}

export function imageUrl(item) {
  // Les caractères qui casseraient la requête (&, #, ?, +) sont échappés, le reste est laissé tel quel.
  const image = encodeURI(item.image).replace(/[&#?+]/g, (c) => encodeURIComponent(c));
  return `https://inducks.org/hr.php?normalsize=1&image=${image}`;
}

export function photoUrl(artist) {
  return artist && artist.photo
    ? `https://inducks.org/creators/photos/${encodeURIComponent(artist.photo)}`
    : null;
}

export function storyUrl(code) {
  return `https://inducks.org/story.php?c=${encodeURIComponent(code).replace(/%20/g, "+")}`;
}

export function artistUrl(code) {
  return `https://inducks.org/creator.php?c=${encodeURIComponent(code)}`;
}

export function countryName(code) {
  if (!code) return "";
  try {
    const names = new Intl.DisplayNames([locale()], { type: "region" });
    return names.of(code.toUpperCase()) || "";
  } catch {
    return "";
  }
}

export function lifeSpan(artist) {
  if (!artist || !artist.born) return "";
  return artist.died ? `${artist.born}-${artist.died}` : String(artist.born);
}

// Titres d'histoires dans la langue choisie (le titre français est déjà dans les données).
let titles = new Map();
let titlesLang = "fr";

export async function loadTitles() {
  const code = lang();
  if (code === titlesLang) return;
  titlesLang = code;
  if (code === "fr") {
    titles = new Map();
    return;
  }
  try {
    const data = await getJSON(`titles/${code}.json`);
    if (titlesLang === code) titles = new Map(Object.entries(data));
  } catch {
    titles = new Map();
  }
}

export function storyTitle(item) {
  if (!item) return "";
  if (titlesLang === "fr") return item.title || item.original || "";
  return titles.get(item.story) || item.original || item.title || "";
}

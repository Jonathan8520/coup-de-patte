// Chargement des données générées chaque semaine à partir d'Inducks.

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
  return `https://inducks.org/hr.php?normalsize=1&image=${encodeURI(item.image)}`;
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
    const names = new Intl.DisplayNames(["fr"], { type: "region" });
    return names.of(code.toUpperCase()) || "";
  } catch {
    return "";
  }
}

export function lifeSpan(artist) {
  if (!artist || !artist.born) return "";
  return artist.died ? `${artist.born}-${artist.died}` : String(artist.born);
}

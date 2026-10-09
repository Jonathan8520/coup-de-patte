// Noms et rangement des modes, dans la langue de l'interface.
//
// Les modes par pays et les kiosques sont générés par le pipeline : leur nom vient
// du nom du pays (Intl.DisplayNames), donc il est traduit sans rien écrire à la main.

import { t, has, lang, locale } from "./i18n.js";

// Données antérieures aux champs kind et countries.
const LEGACY = {
  us: { kind: "country", countries: ["us"] },
  it: { kind: "country", countries: ["it"] },
  francais: { kind: "country", countries: ["fr"] },
  fr: { kind: "kiosk", countries: ["fr"] },
  egmont: { kind: "production", countries: [] },
  tous: { kind: "selection", countries: [] },
  debutant: { kind: "selection", countries: [] },
};

// Pays « de la maison » pour chaque langue : son mode et son kiosque passent en premier.
const HOME_COUNTRIES = {
  fr: ["fr"], en: ["us", "gb"], it: ["it"], de: ["de"], es: ["es"], pt: ["br", "pt"],
  nl: ["nl"], da: ["dk"], nb: ["no"], sv: ["se"], fi: ["fi"],
};

export function normalize(mode) {
  const legacy = LEGACY[mode.id] || {};
  return { ...mode, kind: mode.kind || legacy.kind || "selection", countries: mode.countries?.length ? mode.countries : legacy.countries || [] };
}

export function countryLabel(codes) {
  let names;
  try {
    const display = new Intl.DisplayNames([locale()], { type: "region" });
    names = codes.map((code) => display.of(code.toUpperCase()) || code.toUpperCase());
  } catch {
    names = codes.map((code) => code.toUpperCase());
  }
  try {
    return new Intl.ListFormat(locale(), { type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}

export function modeName(mode) {
  if (!mode) return "";
  const m = normalize(mode);
  if (m.kind === "country") return countryLabel(m.countries);
  if (m.kind === "kiosk") return t("kiosk.title", { country: countryLabel(m.countries) });
  const key = `mode.${m.id}.name`;
  return has(key) ? t(key) : m.name;
}

export function modeBlurb(mode, meta) {
  const m = normalize(mode);
  if (m.kind === "kiosk") {
    const year = meta?.recentFrom || (meta?.generated ? Number(meta.generated.slice(0, 4)) - 20 : "");
    return t("kiosk.blurb", { year: String(year) });
  }
  if (m.kind === "country") return "";
  const key = `mode.${m.id}.blurb`;
  return has(key) ? t(key) : m.blurb;
}

function homeFirst(modes) {
  const mine = HOME_COUNTRIES[lang()] || [];
  const score = (m) => {
    const index = m.countries.findIndex((c) => mine.includes(c));
    return index === -1 ? 1 : 0;
  };
  // Ensuite les plus grandes écoles (nombre d'histoires jouables), à défaut le nombre de dessinateurs.
  const size = (m) => m.stories || m.artists;
  return [...modes].sort((a, b) => score(a) - score(b) || size(b) - size(a) || modeName(a).localeCompare(modeName(b), locale()));
}

// Les modes répartis par famille, dans l'ordre d'affichage.
export function groupModes(meta) {
  const modes = meta.modes.map(normalize);
  const selectionOrder = ["debutant", "tous"];
  return {
    selection: modes
      .filter((m) => m.kind === "selection")
      .sort((a, b) => (selectionOrder.indexOf(a.id) + 99) % 99 - (selectionOrder.indexOf(b.id) + 99) % 99),
    country: homeFirst(modes.filter((m) => m.kind === "country")),
    kiosk: homeFirst(modes.filter((m) => m.kind === "kiosk")),
    production: modes.filter((m) => m.kind === "production"),
  };
}

export function isHomeCountry(mode) {
  const mine = HOME_COUNTRIES[lang()] || [];
  return normalize(mode).countries.some((c) => mine.includes(c));
}

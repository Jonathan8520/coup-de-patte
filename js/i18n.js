// Traductions de l'interface.
//
// Les textes vivent dans site/i18n/<langue>.json. Le français est la langue source et sert
// de repli pour toute clé absente. Un message peut être une chaîne ou un objet de pluriels
// ({ one, other, few, many… }) choisi avec Intl.PluralRules selon {n}.

export const LANGS = [
  { code: "fr", name: "Français", locale: "fr-FR" },
  { code: "en", name: "English", locale: "en-GB" },
  { code: "it", name: "Italiano", locale: "it-IT" },
  { code: "de", name: "Deutsch", locale: "de-DE" },
  { code: "es", name: "Español", locale: "es-ES" },
  { code: "pt", name: "Português", locale: "pt-BR" },
  { code: "nl", name: "Nederlands", locale: "nl-NL" },
  { code: "da", name: "Dansk", locale: "da-DK" },
  { code: "nb", name: "Norsk", locale: "nb-NO" },
  { code: "sv", name: "Svenska", locale: "sv-SE" },
  { code: "fi", name: "Suomi", locale: "fi-FI" },
];

const STORAGE_KEY = "coup-de-patte:lang";
// Codes de navigateur rattachés à une langue proposée.
const ALIASES = { no: "nb", nn: "nb", "pt-br": "pt", "pt-pt": "pt" };

let current = LANGS[0];
let messages = {};
let source = {};
let rules = new Intl.PluralRules(current.locale);
let numberFormat = new Intl.NumberFormat(current.locale);

function find(code) {
  if (!code) return null;
  const lower = code.toLowerCase();
  const short = ALIASES[lower] || ALIASES[lower.split("-")[0]] || lower.split("-")[0];
  return LANGS.find((l) => l.code === lower) || LANGS.find((l) => l.code === short) || null;
}

function detect() {
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (find(fromUrl)) return find(fromUrl);
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (find(saved)) return find(saved);
  } catch {
    /* stockage indisponible */
  }
  for (const code of navigator.languages || [navigator.language]) {
    const lang = find(code);
    if (lang) return lang;
  }
  return find("en");
}

async function fetchMessages(code) {
  const response = await fetch(`i18n/${code}.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`i18n/${code}.json : HTTP ${response.status}`);
  return response.json();
}

function use(lang, dict) {
  current = lang;
  messages = dict;
  rules = new Intl.PluralRules(lang.locale);
  numberFormat = new Intl.NumberFormat(lang.locale);
  document.documentElement.lang = lang.code;
}

export async function initI18n() {
  source = await fetchMessages("fr");
  const lang = detect();
  let dict = source;
  if (lang.code !== "fr") dict = await fetchMessages(lang.code).catch(() => source);
  use(lang, dict);
  applyStatic();
}

export async function setLang(code) {
  const lang = find(code) || LANGS[0];
  const dict = lang.code === "fr" ? source : await fetchMessages(lang.code);
  use(lang, dict);
  try {
    localStorage.setItem(STORAGE_KEY, lang.code);
  } catch {
    /* le choix ne sera pas retenu */
  }
  applyStatic();
}

export const lang = () => current.code;
export const locale = () => current.locale;
export const formatNumber = (n) => numberFormat.format(n);
export const has = (key) => key in messages || key in source;

function pick(message, n) {
  if (typeof message !== "object" || message === null) return message;
  const category = typeof n === "number" ? rules.select(n) : "other";
  return message[category] ?? message.other ?? Object.values(message)[0];
}

function raw(key, vars) {
  const message = messages[key] ?? source[key];
  if (message === undefined) {
    console.warn(`Traduction manquante : ${key}`);
    return key;
  }
  return pick(message, vars?.n);
}

function show(value) {
  return typeof value === "number" ? numberFormat.format(value) : String(value ?? "");
}

// Texte simple : t("home.record", { n: 1240 })
export function t(key, vars = {}) {
  return raw(key, vars).replace(/\{(\w+)\}/g, (_, name) => show(vars[name]));
}

// Texte mêlé d'éléments (liens, gras) : renvoie un tableau de chaînes et de nœuds.
export function tn(key, vars = {}) {
  const parts = [];
  const text = raw(key, vars);
  let last = 0;
  text.replace(/\{(\w+)\}/g, (match, name, offset) => {
    if (offset > last) parts.push(text.slice(last, offset));
    const value = vars[name];
    parts.push(value instanceof Node ? value : show(value));
    last = offset + match.length;
    return match;
  });
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Titre entre guillemets, à la façon de chaque langue.
// Certains titres d'Inducks portent déjà leurs guillemets : on les retire pour ne pas les doubler.
export function quote(text) {
  const bare = String(text).trim().replace(/^["“”„«»]\s*(.*?)\s*["“”«»]$/, "$1");
  return t("quote", { text: bare });
}

// Textes posés directement dans index.html.
function applyStatic() {
  document.title = t("app.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("app.description"));
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nLabel));
  });
  const badge = document.querySelector("[data-lang-badge]");
  if (badge) badge.textContent = current.code.toUpperCase();
}

// Point d'entrée : routes, construction des parties, service worker.

import { dayKey, daysBetween, reducedMotion, toast } from "./util.js?v=e0943d2";
import { loadMeta, loadArtists, loadMode, loadDaily, loadArchive, loadTitles, toItem } from "./data.js?v=e0943d2";
import { initI18n, t } from "./i18n.js?v=e0943d2";
import { modeName } from "./modes.js?v=e0943d2";
import { rngFrom, randomSeed, shuffle, pick, weightedSample } from "./rng.js?v=e0943d2";
import { seenSet, recordGame, dailyResult, saveDailyProgress } from "./store.js?v=e0943d2";
import { close } from "./dialogs.js?v=e0943d2";
import { Game } from "./game.js?v=e0943d2";
import { homeView, endView, dailyDoneView, challengeIntro, emptyState, openStats, openAbout, openLanguage, decodeChallenge, atelierView, pastDailiesView } from "./views.js?v=e0943d2";

const ARTISTS_PER_GAME = 9;
const ROUNDS = 8;
const root = document.getElementById("app");
let current = null;
let navigation = 0;

// Chaque navigation reçoit un jeton : un chargement lent ne doit pas écraser l'écran suivant.
function begin() {
  const token = ++navigation;
  return () => token === navigation;
}

// ------------------------------------------------------------------ parties

async function modeGame(modeId) {
  const [meta, mode] = await Promise.all([loadMeta(), loadMode(modeId)]);
  const info = meta.modes.find((m) => m.id === modeId);
  const rnd = rngFrom(randomSeed());
  // Poids calculés par le pipeline (notoriété) ; à défaut, la racine du nombre d'histoires.
  const weights = mode.weights?.length
    ? mode.weights
    : mode.counts?.length
      ? mode.counts.map((c) => Math.sqrt(c))
      : mode.artists.map(() => 1);
  const chosen = weightedSample(mode.artists, weights, ARTISTS_PER_GAME, rnd);
  const answers = shuffle(chosen, rnd).slice(0, ROUNDS);
  const seen = seenSet();
  const rounds = answers.map((code) => {
    const list = mode._byArtist.get(code);
    const fresh = list.filter((item) => !seen.has(item.id));
    return pick(fresh.length ? fresh : list, rnd);
  });
  return {
    kind: "mode",
    modeId,
    modeName: info ? modeName(info) : modeId,
    artists: shuffle(chosen, rnd),
    rounds,
    spares: new Map(chosen.map((code) => [code, mode._byArtist.get(code)])),
  };
}

async function archivedItems() {
  const archive = await loadArchive();
  return { byId: new Map(archive.items.map((row) => [row[0], toItem(row)])), artists: archive.artists || {} };
}

async function fixedGame({ kind, modeId, artistCodes, roundIds, seed, day, target }) {
  const meta = await loadMeta();
  const info = meta.modes.find((m) => m.id === modeId);
  const mode = await loadMode(modeId).catch(() => null);
  let archive = null;
  const rounds = [];
  for (const id of roundIds) {
    let item = mode?._byId.get(id);
    if (!item) {
      archive ||= await archivedItems().catch(() => ({ byId: new Map(), artists: {} }));
      item = archive.byId.get(id);
    }
    if (!item) return null;
    rounds.push(item);
  }
  const rnd = rngFrom(seed);
  return {
    kind,
    modeId,
    modeName: info ? modeName(info) : t("challenge.shared_game"),
    day,
    target,
    artists: shuffle(artistCodes, rnd),
    rounds,
    spares: new Map(artistCodes.map((code) => [code, mode?._byArtist.get(code) || []])),
    extraPeople: archive?.artists || {},
  };
}

async function people(setup) {
  const artists = await loadArtists();
  if (!setup.extraPeople || !Object.keys(setup.extraPeople).length) {
    // Les défis du jour peuvent citer un dessinateur sorti des modes depuis.
    const missing = setup.artists.some((code) => !artists[code]);
    if (missing) setup.extraPeople = (await archivedItems().catch(() => ({ artists: {} }))).artists;
  }
  return { ...(setup.extraPeople || {}), ...artists };
}

async function play(setup, { dailyNumber } = {}, alive = () => true) {
  const [dict] = await Promise.all([people(setup), loadTitles()]);
  if (!alive()) return;
  if (setup.artists.some((code) => !dict[code])) {
    root.replaceChildren(emptyState(t("game.unknown_artist")));
    return;
  }
  setup.title = t("game.ready");
  setup.subtitle =
    setup.kind === "daily"
      ? t("game.subtitle.daily", { n: dailyNumber })
      : setup.kind === "archive"
        ? t("game.subtitle.archive", { n: dailyNumber })
        : setup.modeName;
  const replay = setup.kind === "mode" ? () => startMode(setup.modeId) : setup.kind === "archive" ? () => startDaily(setup.day) : null;
  stopCurrent();
  const game = new Game(root, setup, dict, {
    onFinish: ({ score, results }) => {
      if (current === game) current = null;
      if (!alive()) return;
      recordGame({ kind: setup.kind, mode: setup.modeId, day: setup.day, score, results });
      swap(() => endView(root, { setup, score, results, people: dict, modeName: setup.modeName, dailyNumber, onReplay: replay }));
    },
    onQuit: () => {
      if (current === game) current = null;
      if (location.hash === "#/" || location.hash === "") render();
      else location.hash = "#/";
    },
  });
  if (setup.kind === "daily") {
    // Une seule tentative : le défi compte dès la première case, même interrompu.
    const progress = (results) => saveDailyProgress(setup.day, { mode: setup.modeId, results });
    game.onRound = (index) => index === 0 && progress([]);
    game.onRoundEnd = progress;
  }
  current = game;
  swap(() => {
    if (alive() && current === game) game.mount();
  });
}

async function startMode(modeId) {
  stopCurrent();
  const alive = begin();
  try {
    const setup = await modeGame(modeId);
    if (!alive()) return;
    await play(setup, {}, alive);
  } catch (error) {
    console.error(error);
    root.replaceChildren(emptyState(t("game.mode_unavailable")));
  }
}

async function startDaily(dateArg) {
  stopCurrent();
  const alive = begin();
  const daily = await loadDaily().catch(() => null);
  if (!alive()) return;
  const today = dayKey();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateArg || "") ? dateArg : today;
  if (day > today) {
    root.replaceChildren(emptyState(t("daily.not_out")));
    return;
  }
  const game = daily?.days?.[day];
  if (!game) {
    root.replaceChildren(emptyState(day === today ? t("daily.not_ready") : t("daily.missing")));
    return;
  }
  const n = daysBetween(daily.launch, day) + 1;
  const meta = await loadMeta();
  if (!alive()) return;
  const dailyMode = meta.modes.find((m) => m.id === game.mode);
  const modeLabel = dailyMode ? modeName(dailyMode) : "";
  const done = day === today ? dailyResult(today) : null;
  if (done) {
    dailyDoneView(root, { number: n, modeName: modeLabel, result: done });
    return;
  }
  const kind = day === today ? "daily" : "archive";
  const setup = await fixedGame({ kind, modeId: game.mode, artistCodes: game.artists, roundIds: game.rounds, seed: `jour/${day}`, day });
  if (!alive()) return;
  if (!setup) {
    root.replaceChildren(emptyState(t("daily.not_found")));
    return;
  }
  await play(setup, { dailyNumber: n }, alive);
}

async function startChallenge(payload) {
  const alive = begin();
  const data = decodeChallenge(payload);
  if (!data) {
    root.replaceChildren(emptyState(t("challenge.broken")));
    return;
  }
  const setup = await fixedGame({ kind: "challenge", modeId: data.m, artistCodes: data.a, roundIds: data.r, seed: `defi/${payload}`, day: null, target: Number(data.s) });
  if (!alive()) return;
  if (!setup) {
    root.replaceChildren(emptyState(t("challenge.gone")));
    return;
  }
  setup.artists = data.a.slice();
  challengeIntro(root, { target: Number(data.s), modeName: setup.modeName, rounds: setup.rounds.length, onStart: () => play(setup, {}, begin()) });
}

// ------------------------------------------------------------------ routes

function stopCurrent() {
  if (current) {
    current.destroy();
    current = null;
  }
}

function parse(hash) {
  const path = hash.replace(/^#\/?/, "");
  const [section, ...rest] = path.split("/");
  return { section: section || "", arg: rest.join("/") };
}

function swap(update) {
  if (document.startViewTransition && !reducedMotion()) document.startViewTransition(update);
  else update();
}

async function render() {
  stopCurrent();
  document.querySelectorAll("dialog[open]").forEach((d) => close(d));
  document.documentElement.style.overflow = "";
  const { section, arg } = parse(location.hash);
  window.scrollTo({ top: 0 });
  try {
    if (section === "jouer" && arg) return await startMode(decodeURIComponent(arg));
    if (section === "jour") return await startDaily(arg);
    if (section === "atelier") {
      const alive = begin();
      const mount = await atelierView(root, decodeURIComponent(arg || ""));
      if (alive()) swap(mount);
      return;
    }
    if (section === "defis") {
      const alive = begin();
      const mount = await pastDailiesView(root);
      if (alive()) swap(mount);
      return;
    }
    if (section === "defi" && arg) return await startChallenge(arg);
    const alive = begin();
    const mount = await homeView(root);
    if (alive()) swap(mount);
    document.title = t("app.title");
  } catch (error) {
    console.error(error);
    root.replaceChildren(emptyState());
  }
}

window.addEventListener("hashchange", render);

document.addEventListener("click", (event) => {
  const opener = event.target.closest("[data-open]");
  if (!opener) return;
  if (opener.dataset.open === "stats") openStats();
  if (opener.dataset.open === "about") openAbout();
  if (opener.dataset.open === "lang") openLanguage();
});

// Lien d'évitement : aller au contenu sans changer de route.
document.querySelector(".skip")?.addEventListener("click", (event) => {
  event.preventDefault();
  root.focus();
});

initI18n()
  .catch((error) => console.error(error))
  .then(() => {
    loadTitles();
    render();
  });

// Hors ligne : l'appli se recharge depuis le cache, les images restent sur Inducks.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  if (String(event.reason).includes("Failed to fetch")) toast(t("common.connection_lost"));
});

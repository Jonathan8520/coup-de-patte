// Point d'entrée : routes, construction des parties, service worker.

import { dayKey, daysBetween, reducedMotion, toast } from "./util.js";
import { loadMeta, loadArtists, loadMode, loadDaily, loadArchive, toItem } from "./data.js";
import { rngFrom, randomSeed, shuffle, pick, weightedSample } from "./rng.js";
import { seenSet, recordGame, dailyResult } from "./store.js";
import { Game } from "./game.js";
import { homeView, endView, dailyDoneView, challengeIntro, emptyState, openStats, openAbout, decodeChallenge } from "./views.js";

const ARTISTS_PER_GAME = 9;
const ROUNDS = 8;
const root = document.getElementById("app");
let current = null;

// ------------------------------------------------------------------ parties

async function modeGame(modeId) {
  const [meta, mode] = await Promise.all([loadMeta(), loadMode(modeId)]);
  const info = meta.modes.find((m) => m.id === modeId);
  const rnd = rngFrom(randomSeed());
  const weights = mode.counts?.length ? mode.counts.map((c) => Math.sqrt(c)) : mode.artists.map(() => 1);
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
    modeName: info?.name || modeId,
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
    modeName: info?.name || "",
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

async function play(setup, { dailyNumber } = {}) {
  const dict = await people(setup);
  if (setup.artists.some((code) => !dict[code])) {
    root.replaceChildren(emptyState("Cette partie cite un dessinateur inconnu. Essaie un autre mode."));
    return;
  }
  setup.title = "Prêt ?";
  setup.subtitle = setup.kind === "daily" ? `Défi du jour n°${dailyNumber}` : setup.modeName;
  const replay = setup.kind === "mode" ? () => startMode(setup.modeId) : null;
  current = new Game(root, setup, dict, {
    onFinish: ({ score, results }) => {
      current = null;
      recordGame({ kind: setup.kind, mode: setup.modeId, day: setup.day, score, results });
      endView(root, { setup, score, results, people: dict, modeName: setup.modeName, dailyNumber, onReplay: replay });
    },
    onQuit: () => {
      current = null;
      if (location.hash === "#/" || location.hash === "") render();
      else location.hash = "#/";
    },
  });
  current.mount();
}

async function startMode(modeId) {
  stopCurrent();
  try {
    await play(await modeGame(modeId));
  } catch (error) {
    console.error(error);
    root.replaceChildren(emptyState("Ce mode n'est pas disponible pour le moment."));
  }
}

async function startDaily() {
  const daily = await loadDaily().catch(() => null);
  const today = dayKey();
  const game = daily?.days?.[today];
  if (!game) {
    root.replaceChildren(emptyState("Le défi du jour n'est pas encore prêt. Reviens un peu plus tard."));
    return;
  }
  const n = daysBetween(daily.launch, today) + 1;
  const meta = await loadMeta();
  const modeName = meta.modes.find((m) => m.id === game.mode)?.name || "";
  const done = dailyResult(today);
  if (done) {
    dailyDoneView(root, { number: n, modeName, result: done });
    return;
  }
  const setup = await fixedGame({ kind: "daily", modeId: game.mode, artistCodes: game.artists, roundIds: game.rounds, seed: `jour/${today}`, day: today });
  if (!setup) {
    root.replaceChildren(emptyState("Le défi du jour est introuvable. Reviens dans quelques minutes."));
    return;
  }
  await play(setup, { dailyNumber: n });
}

async function startChallenge(payload) {
  const data = decodeChallenge(payload);
  if (!data) {
    root.replaceChildren(emptyState("Ce lien de défi est incomplet. Demande à ton ami de le renvoyer."));
    return;
  }
  const setup = await fixedGame({ kind: "challenge", modeId: data.m, artistCodes: data.a, roundIds: data.r, seed: `defi/${payload}`, day: null, target: Number(data.s) });
  if (!setup) {
    root.replaceChildren(emptyState("Les cases de ce défi ne sont plus disponibles. Lance une nouvelle partie."));
    return;
  }
  setup.artists = data.a.slice();
  challengeIntro(root, { target: Number(data.s), modeName: setup.modeName, rounds: setup.rounds.length, onStart: () => play(setup) });
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
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  document.documentElement.style.overflow = "";
  const { section, arg } = parse(location.hash);
  window.scrollTo({ top: 0 });
  try {
    if (section === "jouer" && arg) return await startMode(decodeURIComponent(arg));
    if (section === "jour") return await startDaily();
    if (section === "defi" && arg) return await startChallenge(arg);
    const mount = await homeView(root);
    swap(mount);
    document.title = "Coup de Patte : qui a dessiné cette case ?";
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
});

render();

// Hors ligne : l'appli se recharge depuis le cache, les images restent sur Inducks.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  if (String(event.reason).includes("Failed to fetch")) toast("Connexion perdue");
});

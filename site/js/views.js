// Écrans : accueil, fin de partie, défis, statistiques et aide.

import { h, icon, number, dayKey, formatDay, formatFullDate, daysBetween, untilMidnight, parseDay, plural, shareOrCopy, toast } from "./util.js";
import { loadMeta, loadArtists, loadDaily, imageUrl } from "./data.js";
import { getState, dailyResult, dailyStreak, medalFor, nextMedal, markOf, resetAll } from "./store.js";
import { openSheet, confirmDialog, close } from "./dialogs.js";
import { viewTransform, SAFE } from "./game.js";

export const SITE_URL = "https://jonathan8520.github.io/coup-de-patte/";
const MARK_EMOJI = { fast: "🟨", ok: "🟦", ko: "🟪", time: "⬜" };

export function previousDay(key) {
  const d = parseDay(key);
  d.setDate(d.getDate() - 1);
  return dayKey(d);
}

function siteBase() {
  return location.origin + location.pathname;
}

// ------------------------------------------------------------------ défis partagés

export function encodeChallenge(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeChallenge(text) {
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64 + "===".slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || !Array.isArray(data.a) || !Array.isArray(data.r)) return null;
    return data;
  } catch {
    return null;
  }
}

export function challengeLink(setup, score) {
  const payload = { v: 1, m: setup.modeId, a: setup.artists, r: setup.rounds.map((item) => item.id), s: score };
  if (setup.day) payload.d = setup.day;
  return `${siteBase()}#/defi/${encodeChallenge(payload)}`;
}

// ------------------------------------------------------------------ accueil

function namesLine(codes, artists, total) {
  const names = codes.map((code) => artists[code]?.name).filter(Boolean);
  const rest = total - names.length;
  return rest > 0 ? `${names.join(", ")} et ${rest} autres` : names.join(", ");
}

function marksRow(marks) {
  return h("div", { class: "marks", "aria-hidden": "true" }, marks.map((mark) => h("i", { class: mark === "time" ? "ko" : mark })));
}

export function shareText({ number: n, modeName, score, marks }) {
  const head = n ? `Coup de Patte, défi du jour n°${n}` : "Coup de Patte";
  return `${head}\n${modeName} : ${number.format(score)} points\n${marks.map((m) => MARK_EMOJI[m] || "⬜").join("")}`;
}

function dailyPanel(meta, daily) {
  const today = dayKey();
  const game = daily?.days?.[today];
  const panel = h("section", { class: "panel panel-daily", "aria-labelledby": "daily-title" });
  if (!game) {
    panel.append(h("h2", { class: "daily-title", id: "daily-title" }, "Défi du jour"), h("p", {}, "Le prochain défi se prépare. Reviens un peu plus tard."));
    return panel;
  }
  const n = daysBetween(daily.launch, today) + 1;
  const modeName = meta.modes.find((m) => m.id === game.mode)?.name || "";
  const done = dailyResult(today);
  panel.append(
    h("div", { class: "daily-head" }, h("h2", { class: "daily-title", id: "daily-title" }, `Défi du jour n°${n}`)),
    h("p", { class: "daily-date" }, `${capitalize(formatDay(today))}. Thème : ${modeName}.`),
  );
  if (done) {
    const streak = dailyStreak(today, previousDay);
    const next = h("span", { class: "daily-next" }, `Prochain défi dans ${untilMidnight()}`);
    const timer = setInterval(() => {
      if (!next.isConnected) return clearInterval(timer);
      next.textContent = `Prochain défi dans ${untilMidnight()}`;
    }, 30000);
    panel.append(
      h("div", { class: "daily-done" }, h("span", { class: "daily-score" }, `${number.format(done.score)} pts`), marksRow(done.marks)),
      h("p", {}, streak > 1 ? `${streak} jours d'affilée. ` : "", next),
      h(
        "div",
        { class: "btn-row" },
        h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: () => shareOrCopy({ title: "Coup de Patte", text: shareText({ number: n, modeName, score: done.score, marks: done.marks }), url: `${siteBase()}#/jour` }),
          },
          icon("i-share"),
          "Partager",
        ),
      ),
    );
  } else {
    panel.append(
      h("p", { class: "daily-mode" }, "Les mêmes huit cases pour tout le monde. Une seule tentative."),
      h("div", { class: "btn-row" }, h("a", { class: "btn btn-balloon", href: "#/jour" }, "Jouer le défi")),
    );
  }
  return panel;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function modePanel(mode, artists, wide) {
  const stats = getState().modes[mode.id];
  const medal = stats ? medalFor(stats.correct) : null;
  const record = stats?.best
    ? h("span", {}, medal ? h("i", { class: `medal-dot medal-${medal.id}`, title: medal.label.charAt(0).toUpperCase() + medal.label.slice(1) }) : null, `Record : ${number.format(stats.best)}`)
    : h("span", { class: "muted" }, `${plural(mode.artists, "dessinateur", "dessinateurs")}`);
  return h(
    "a",
    { class: `panel mode-link ${wide ? "panel-wide" : "panel-mode"}`, href: `#/jouer/${mode.id}` },
    h("h2", { class: "mode-name" }, mode.name),
    h("p", { class: "mode-blurb" }, mode.blurb),
    h("p", { class: "mode-names" }, namesLine(mode.faces, artists, mode.artists)),
    h("div", { class: "mode-foot" }, record, h("span", { class: "mode-play" }, "Jouer")),
  );
}

export async function homeView(root) {
  let meta, artists, daily;
  try {
    [meta, artists] = await Promise.all([loadMeta(), loadArtists()]);
    daily = await loadDaily().catch(() => null);
  } catch {
    return () => root.replaceChildren(emptyState());
  }
  return () => {
    const modes = [...meta.modes];
    const beginner = modes.find((m) => m.id === "debutant");
    const others = modes.filter((m) => m.id !== "debutant");
    root.replaceChildren(
      h(
        "div",
        { class: "home" },
        h(
          "div",
          { class: "page" },
          h(
            "section",
            { class: "panel panel-hero" },
            h("h1", { class: "wordmark" }, h("span", {}, "Coup de"), h("span", {}, "Patte")),
            h(
              "div",
              {},
              h("p", { class: "lede" }, "Une case de BD Disney s'affiche. Tu as quinze secondes pour trouver qui l'a dessinée."),
              h(
                "ul",
                { class: "how" },
                h("li", {}, icon("i-clock"), "8 cases par partie"),
                h("li", {}, icon("i-pencil"), "9 dessinateurs proposés"),
              ),
            ),
          ),
          dailyPanel(meta, daily),
          beginner ? modePanel(beginner, artists, true) : null,
          others.map((mode) => modePanel(mode, artists, false)),
        ),
        h(
          "footer",
          { class: "home-foot" },
          h("p", {}, `Données Inducks du ${formatFullDate(meta.generated)}, mises à jour chaque semaine.`),
          h("p", {}, "Inspiré de Duckguessr, le jeu de l'équipe DucksManager. Personnages et histoires © Disney."),
        ),
      ),
    );
  };
}

export function emptyState(text = "Les cases sont en cours de préparation. Reviens dans quelques minutes.") {
  return h(
    "div",
    { class: "empty" },
    h("svg", { class: "mark", viewBox: "0 0 64 64", "aria-hidden": "true", style: { width: "64px", height: "64px" }, html: '<use href="#patte"/>' }),
    h("p", {}, text),
    h("a", { class: "btn", href: "#/" }, "Retour à l'accueil"),
  );
}

// ------------------------------------------------------------------ fin de partie

function verdictFor(correct, total) {
  if (correct === total) return "Sans faute. Tu as l'œil d'un éditeur.";
  if (correct >= total - 2) return "Du métier : tu reconnais les styles au premier coup d'œil.";
  if (correct >= total / 2) return "Pas mal du tout. Les traits commencent à te parler.";
  if (correct >= 2) return "Les styles se ressemblent au début, ça viendra vite.";
  return "Dur. Le mode Débutant est là pour se faire l'œil.";
}

function thumb(item) {
  const box = h("div", { class: "thumb" });
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => {
    img.style.width = `${img.naturalWidth}px`;
    img.style.height = `${img.naturalHeight}px`;
    img.style.transform = viewTransform(72, 72, img.naturalWidth, img.naturalHeight, SAFE);
    box.append(img);
  };
  img.src = imageUrl(item);
  return box;
}

function countUp(el, target) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || target === 0) {
    el.textContent = number.format(target);
    return;
  }
  const start = performance.now();
  const duration = 1100;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = number.format(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function endView(root, { setup, score, results, people, modeName, dailyNumber, onReplay }) {
  const correct = results.filter((r) => r.correct).length;
  const total = results.length;
  const marks = results.map(markOf);
  const scoreEl = h("span", {}, "0");
  const head = h(
    "header",
    { class: "end-head" },
    h("p", { class: "end-kicker" }, setup.kind === "daily" ? `Défi du jour n°${dailyNumber} (${modeName})` : setup.kind === "challenge" ? `Défi entre amis (${modeName})` : modeName),
    h("p", { class: "end-score", "aria-label": `${score} points` }, scoreEl, h("small", {}, " pts")),
    h("p", { class: "end-verdict" }, `${correct} sur ${total}. ${verdictFor(correct, total)}`),
  );

  let challengeNote = null;
  if (setup.kind === "challenge" && Number.isFinite(setup.target)) {
    const diff = score - setup.target;
    challengeNote = h(
      "p",
      { class: "end-challenge" },
      diff > 0
        ? `Défi relevé : ${number.format(diff)} points de plus que ton ami (${number.format(setup.target)}).`
        : diff === 0
          ? `Égalité parfaite avec ton ami : ${number.format(setup.target)} points chacun.`
          : `Ton ami garde l'avantage avec ${number.format(setup.target)} points, ${number.format(-diff)} de plus que toi.`,
    );
  }

  const actions = h("div", { class: "btn-row" });
  if (setup.kind === "daily") {
    actions.append(
      h(
        "button",
        {
          class: "btn btn-yellow",
          type: "button",
          onclick: () => shareOrCopy({ title: "Coup de Patte", text: shareText({ number: dailyNumber, modeName, score, marks }), url: `${siteBase()}#/jour` }),
        },
        icon("i-share"),
        "Partager mon résultat",
      ),
    );
  }
  actions.append(
    h(
      "button",
      {
        class: setup.kind === "daily" ? "btn" : "btn btn-yellow",
        type: "button",
        onclick: () =>
          shareOrCopy({
            title: "Coup de Patte",
            text: `J'ai fait ${number.format(score)} points à Coup de Patte (${modeName}). Mêmes cases, à toi :`,
            url: challengeLink(setup, score),
          }),
      },
      icon("i-link"),
      "Défier un ami",
    ),
  );
  if (onReplay) actions.append(h("button", { class: "btn", type: "button", onclick: onReplay }, icon("i-replay"), "Rejouer"));
  actions.append(h("a", { class: "btn btn-ghost", href: "#/" }, "Accueil"));

  const recap = h(
    "ol",
    { class: "recap", "aria-label": "Détail des cases" },
    results.map((r, i) => {
      const artist = people[r.answer];
      const guessed = r.guess && r.guess !== r.answer ? people[r.guess]?.name : null;
      const line = r.skipped
        ? "Case indisponible, ignorée"
        : r.correct
          ? `« ${r.item.title || r.item.original} »${r.item.year ? `, ${r.item.year}` : ""}`
          : r.timeout
            ? "Temps écoulé"
            : `Tu as répondu ${guessed}`;
      return h(
        "li",
        { class: r.correct ? "ok" : "ko", style: { "--i": i } },
        thumb(r.item),
        h("div", { class: "who" }, h("strong", {}, `${i + 1}. ${artist?.name || r.answer}`), h("span", {}, line)),
        h("span", { class: "pts" }, r.correct ? `+${r.base + r.bonus}` : "0"),
      );
    }),
  );

  root.replaceChildren(h("div", { class: "end" }, head, challengeNote, actions, recap));
  countUp(scoreEl, score);
  window.scrollTo({ top: 0 });
}

// Défi du jour déjà joué : on rappelle le résultat.
export function dailyDoneView(root, { number: n, modeName, result }) {
  const next = h("p", { class: "daily-next" }, `Prochain défi dans ${untilMidnight()}.`);
  root.replaceChildren(
    h(
      "div",
      { class: "end" },
      h(
        "header",
        { class: "end-head" },
        h("p", { class: "end-kicker" }, `Défi du jour n°${n} (${modeName})`),
        h("p", { class: "end-score" }, number.format(result.score), h("small", {}, " pts")),
        marksRow(result.marks),
        h("p", { class: "end-verdict" }, "Tu as déjà joué le défi d'aujourd'hui."),
        next,
      ),
      h(
        "div",
        { class: "btn-row" },
        h(
          "button",
          { class: "btn btn-yellow", type: "button", onclick: () => shareOrCopy({ title: "Coup de Patte", text: shareText({ number: n, modeName, score: result.score, marks: result.marks }), url: `${siteBase()}#/jour` }) },
          icon("i-share"),
          "Partager mon résultat",
        ),
        h("a", { class: "btn btn-ghost", href: "#/" }, "Accueil"),
      ),
    ),
  );
}

export function challengeIntro(root, { target, modeName, rounds, onStart }) {
  root.replaceChildren(
    h(
      "div",
      { class: "end" },
      h(
        "header",
        { class: "end-head" },
        h("p", { class: "end-kicker" }, `Défi entre amis (${modeName})`),
        h("p", { class: "end-score" }, Number.isFinite(target) ? number.format(target) : "?", h("small", {}, " pts")),
        h("p", { class: "end-verdict" }, `C'est le score à battre, sur les mêmes ${rounds} cases et dans le même ordre.`),
      ),
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn btn-yellow btn-balloon", type: "button", onclick: onStart }, "Relever le défi"),
        h("a", { class: "btn btn-ghost", href: "#/" }, "Plus tard"),
      ),
    ),
  );
}

// ------------------------------------------------------------------ feuilles

export async function openStats() {
  const [meta, artists] = await Promise.all([loadMeta(), loadArtists()]).catch(() => [null, {}]);
  const s = getState();
  const modes = meta?.modes || [];
  const totals = Object.values(s.modes).reduce(
    (acc, m) => ({ played: acc.played + m.played, correct: acc.correct + m.correct, rounds: acc.rounds + m.rounds, best: Math.max(acc.best, m.best) }),
    { played: 0, correct: 0, rounds: 0, best: 0 },
  );
  const streak = dailyStreak(dayKey(), previousDay);

  if (!totals.played) {
    openSheet("Mes statistiques", [
      h("p", {}, "Rien pour l'instant. Joue une partie et tes résultats s'afficheront ici."),
      h("p", { class: "muted" }, "Elles restent dans ce navigateur : rien n'est envoyé nulle part."),
    ]);
    return;
  }

  const body = [];
  body.push(
    h(
      "div",
      { class: "stat-grid" },
      h("div", { class: "stat" }, h("b", {}, number.format(totals.played)), h("span", {}, totals.played > 1 ? "parties" : "partie")),
      h("div", { class: "stat" }, h("b", {}, `${Math.round((100 * totals.correct) / Math.max(1, totals.rounds))} %`), h("span", {}, "de cases trouvées")),
      h("div", { class: "stat" }, h("b", {}, number.format(streak)), h("span", {}, streak > 1 ? "jours de défi d'affilée" : "jour de défi")),
    ),
  );

  const perMode = modes
    .filter((m) => s.modes[m.id])
    .map((m) => {
      const st = s.modes[m.id];
      const medal = medalFor(st.correct);
      const next = nextMedal(st.correct);
      const meter = h("i", { style: { transform: `scaleX(${next ? Math.min(1, st.correct / next.need) : 1})` } });
      return h(
        "div",
        { class: "mode-stat" },
        h("div", { class: "mode-stat-head" }, h("span", {}, medal ? h("i", { class: `medal-dot medal-${medal.id}` }) : null, m.name), h("span", {}, `Record ${number.format(st.best)}`)),
        h("div", { class: "meter", "aria-hidden": "true" }, meter),
        h(
          "small",
          {},
          `${plural(st.correct, "case trouvée", "cases trouvées")} sur ${number.format(st.rounds)}. `,
          next ? `${next.label.charAt(0).toUpperCase() + next.label.slice(1)} à ${next.need} cases trouvées.` : "Toutes les médailles sont à toi.",
        ),
      );
    });
  body.push(h("section", {}, h("h3", {}, "Par mode"), h("div", { class: "mode-stats" }, perMode)));

  const eye = Object.entries(s.artists)
    .filter(([, a]) => a.seen >= 3)
    .map(([code, a]) => ({ code, name: artists[code]?.name || code, rate: a.right / a.seen, seen: a.seen }));
  if (eye.length >= 3) {
    const best = [...eye].sort((a, b) => b.rate - a.rate || b.seen - a.seen).slice(0, 5);
    const worst = [...eye].sort((a, b) => a.rate - b.rate || b.seen - a.seen).filter((e) => e.rate < 1).slice(0, 5);
    const list = (items) => h("ul", { class: "eye-list" }, items.map((e) => h("li", {}, h("span", {}, e.name), h("b", {}, `${Math.round(e.rate * 100)} %`))));
    body.push(h("section", {}, h("h3", {}, "Ceux que tu reconnais le mieux"), list(best)));
    if (worst.length) body.push(h("section", {}, h("h3", {}, "Ceux qui te piègent"), list(worst)));
  } else {
    body.push(h("p", { class: "muted" }, "Après quelques parties, tu verras ici les dessinateurs que tu reconnais le mieux."));
  }

  const sheet = openSheet("Mes statistiques", [
    ...body,
    h(
      "button",
      {
        class: "btn btn-ghost",
        type: "button",
        onclick: async () => {
          const ok = await confirmDialog({ title: "Tout effacer ?", text: "Scores, médailles et défis du jour seront supprimés de ce navigateur.", confirm: "Effacer" });
          if (ok) {
            resetAll();
            close(sheet);
            toast("Statistiques effacées");
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          }
        },
      },
      "Effacer mes statistiques",
    ),
  ]);
}

export async function openAbout() {
  const meta = await loadMeta().catch(() => null);
  openSheet("Comment jouer", [
    h(
      "section",
      {},
      h("h3", {}, "Le principe"),
      h("p", {}, "Chaque partie compte huit cases et propose neuf dessinateurs. Chaque dessinateur n'est la bonne réponse qu'une seule fois : un de ses neuf noms est donc un leurre."),
      h("p", {}, "La case s'ouvre sur un détail puis s'élargit. La bande du haut de la planche, où se trouvent le titre et souvent les crédits, reste cachée jusqu'à ta réponse."),
    ),
    h(
      "section",
      {},
      h("h3", {}, "Les points"),
      h(
        "ul",
        {},
        h("li", {}, "100 points par bonne réponse."),
        h("li", {}, "Jusqu'à 100 points de bonus si tu réponds pendant que la barre est jaune, soit les 7,5 premières secondes."),
        h("li", {}, "Au clavier, les touches 1 à 9 choisissent un dessinateur et Entrée passe à la case suivante."),
      ),
    ),
    h(
      "section",
      {},
      h("h3", {}, "Les modes"),
      h(
        "ul",
        {},
        (meta?.modes || []).map((m) => h("li", {}, h("b", {}, m.name), ` : ${m.blurb}`)),
        h("li", {}, h("b", {}, "Défi du jour"), " : les mêmes cases pour tout le monde, une seule tentative, à partager ensuite."),
      ),
    ),
    h(
      "section",
      {},
      h("h3", {}, "D'où viennent les cases"),
      h(
        "p",
        {},
        "Des scans de premières pages répertoriés par ",
        h("a", { href: "https://inducks.org", target: "_blank", rel: "noopener" }, "Inducks"),
        ", la base collaborative des BD Disney. Seules les histoires attribuées à un seul dessinateur sont retenues. Les images sont affichées depuis Inducks et ne sont pas copiées ici.",
      ),
      meta ? h("p", { class: "muted" }, `Dernière mise à jour des données : ${formatFullDate(meta.generated)}.`) : null,
    ),
    h(
      "section",
      {},
      h("h3", {}, "Crédits"),
      h(
        "p",
        {},
        "Une partie du contenu de ce site provient des données d'Inducks, utilisées selon ",
        h("a", { href: "https://inducks.org/inducks/COPYING", target: "_blank", rel: "noopener" }, "la licence Inducks"),
        ".",
      ),
      h(
        "p",
        {},
        "Le jeu reprend l'idée de Duckguessr, créé par l'équipe de ",
        h("a", { href: "https://github.com/bperel/DucksManager", target: "_blank", rel: "noopener" }, "DucksManager"),
        ".",
      ),
      h("p", {}, "Les personnages et histoires Disney sont © Disney. Ce site est un projet de fan, sans lien avec Disney."),
      h("p", {}, h("a", { href: "https://github.com/Jonathan8520/coup-de-patte", target: "_blank", rel: "noopener" }, "Code source sur GitHub"), "."),
    ),
  ]);
}

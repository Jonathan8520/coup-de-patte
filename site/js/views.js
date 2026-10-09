// Écrans : accueil, fin de partie, défis, statistiques, aide, langue, atelier.

import { h, icon, number, dayKey, formatDay, formatFullDate, daysBetween, untilMidnight, parseDay, capitalize, fold, shareOrCopy, toast } from "./util.js";
import { loadMeta, loadArtists, loadDaily, loadMode, loadTitles, imageUrl, photoUrl, storyUrl, artistUrl, countryName, lifeSpan, storyTitle } from "./data.js";
import { getState, dailyResult, archiveResult, dailyStreak, medalFor, nextMedal, markOf, resetAll } from "./store.js";
import { openSheet, confirmDialog, close, openPicture } from "./dialogs.js";
import { viewTransform, SAFE } from "./game.js";
import { t, tn, quote, LANGS, lang, setLang } from "./i18n.js";
import { normalize, modeName, modeBlurb, groupModes } from "./modes.js";

const MARK_EMOJI = { fast: "🟨", ok: "🟦", ko: "🟪", time: "⬜" };
// Nombre de cartes visibles avant « Afficher les autres ».
// Pays visibles d'emblée : deux rangées pleines quand la grille passe à quatre colonnes
// (même seuil que .tier-countries dans style.css), six sinon.
const visibleCountries = () => (matchMedia("(min-width: 1000px)").matches ? 8 : 6);
const VISIBLE_KIOSKS = 1;

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

// ------------------------------------------------------------------ petits morceaux

function namesLine(codes, artists, total) {
  const names = codes.map((code) => artists[code]?.name).filter(Boolean);
  const rest = total - names.length;
  return rest > 0 ? t("common.and_more", { names: names.join(", "), n: rest }) : names.join(", ");
}

function marksRow(marks) {
  return h("div", { class: "marks", "aria-hidden": "true" }, marks.map((mark) => h("i", { class: mark === "time" ? "ko" : mark })));
}

export function shareText({ number: n, modeName: mode, score, marks }) {
  const head = n ? t("share.daily_head", { n }) : "Coup de Patte";
  return `${head}\n${t("share.line", { mode, points: t("common.points", { n: score }) })}\n${marks.map((m) => MARK_EMOJI[m] || "⬜").join("")}`;
}

function shareDaily(n, mode, result) {
  return shareOrCopy({ title: "Coup de Patte", text: shareText({ number: n, modeName: mode, score: result.score, marks: result.marks }), url: `${siteBase()}#/jour` });
}

function titleOf(item) {
  return quote(storyTitle(item) || t("common.untitled"));
}

// Bloc repliable qui s'ouvre en douceur (même mécanique que les fiches de l'atelier).
function collapsible(children, labelMore) {
  const inner = h("div", { class: "more-inner" }, children);
  const box = h("div", { class: "more-body" }, inner);
  const button = h("button", { class: "more-toggle", type: "button", "aria-expanded": "false" }, h("span", {}, labelMore), h("span", { class: "chevron", "aria-hidden": "true" }));
  const wrap = h("div", { class: "more" }, box, button);
  button.addEventListener("click", () => {
    const open = !wrap.classList.contains("open");
    wrap.classList.toggle("open", open);
    button.setAttribute("aria-expanded", String(open));
    button.firstChild.textContent = open ? t("home.less") : labelMore;
  });
  return wrap;
}

// ------------------------------------------------------------------ accueil

function dailyPanel(meta, daily) {
  const today = dayKey();
  const game = daily?.days?.[today];
  const panel = h("section", { class: "panel panel-daily", "aria-labelledby": "daily-title" });
  if (!game) {
    panel.append(h("h2", { class: "daily-title", id: "daily-title" }, t("daily.title")), h("p", {}, t("daily.preparing")));
    return panel;
  }
  const n = daysBetween(daily.launch, today) + 1;
  const mode = modeName(meta.modes.find((m) => m.id === game.mode) || { id: game.mode, name: "" });
  const done = dailyResult(today);
  panel.append(
    h("div", { class: "daily-head" }, h("h2", { class: "daily-title", id: "daily-title" }, t("daily.title_n", { n }))),
    h("p", { class: "daily-date" }, t("daily.date_theme", { date: capitalize(formatDay(today)), mode })),
  );
  if (done) {
    const streak = dailyStreak(today, previousDay);
    const next = h("span", { class: "daily-next" }, t("daily.next", { time: untilMidnight() }));
    const timer = setInterval(() => {
      if (!next.isConnected) return clearInterval(timer);
      next.textContent = t("daily.next", { time: untilMidnight() });
    }, 30000);
    panel.append(
      h("div", { class: "daily-done" }, h("span", { class: "daily-score" }, `${number.format(done.score)} ${t("common.pts")}`), marksRow(done.marks)),
      h("p", {}, done.partial ? `${t("daily.interrupted")} ` : "", streak > 1 ? `${t("daily.streak", { n: streak })} ` : "", next),
      h("div", { class: "btn-row" }, h("button", { class: "btn", type: "button", onclick: () => shareDaily(n, mode, done) }, icon("i-share"), t("daily.share"))),
    );
  } else {
    panel.append(
      h("p", { class: "daily-mode" }, t("daily.rules")),
      h("div", { class: "btn-row" }, h("a", { class: "btn btn-balloon", href: "#/jour" }, t("daily.play"))),
    );
  }
  return panel;
}

function recordLine(mode) {
  const stats = getState().modes[mode.id];
  const medal = stats ? medalFor(stats.correct) : null;
  return stats?.best
    ? h("span", {}, medal ? h("i", { class: `medal-dot medal-${medal.id}`, title: t(`medal.${medal.id}`) }) : null, t("home.record", { n: stats.best }))
    : h("span", { class: "muted" }, t("common.artists", { n: mode.artists }));
}

function modePanel(mode, artists, meta, { compact = false } = {}) {
  const blurb = modeBlurb(mode, meta);
  return h(
    "a",
    { class: `panel mode-link${compact ? " panel-compact" : ""}`, href: `#/jouer/${mode.id}` },
    h("h3", { class: "mode-name" }, modeName(mode)),
    blurb ? h("p", { class: "mode-blurb" }, blurb) : null,
    h("p", { class: "mode-names" }, namesLine(mode.faces.slice(0, compact ? 3 : 4), artists, mode.artists)),
    h("div", { class: "mode-foot" }, recordLine(mode), h("span", { class: "mode-play" }, t("common.play"))),
  );
}

function linkPanel({ href, title, blurb, foot, action }) {
  return h(
    "a",
    { class: "panel mode-link", href },
    h("h3", { class: "mode-name" }, title),
    h("p", { class: "mode-blurb" }, blurb),
    h("div", { class: "mode-foot" }, h("span", { class: "muted" }, foot), h("span", { class: "mode-play" }, action)),
  );
}

export function pastDays(daily, today = dayKey()) {
  if (!daily?.days) return [];
  return Object.keys(daily.days).filter((day) => day < today && day >= daily.launch).sort().reverse();
}

function tier(title, panels, { columns, more, moreLabel } = {}) {
  const shown = panels.filter(Boolean);
  const grid = (items) => h("div", { class: `tier-grid tier-${columns || Math.min(items.length, 4)}` }, items);
  return h(
    "section",
    { class: "tier", "aria-label": title },
    h("h2", { class: "caption" }, title),
    grid(shown),
    more?.length ? collapsible(grid(more), moreLabel) : null,
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
    const groups = groupModes(meta);
    const past = pastDays(daily);
    const atelier = linkPanel({
      href: "#/atelier",
      title: t("home.atelier.title"),
      blurb: t("home.atelier.blurb"),
      foot: t("common.artists", { n: Object.keys(artists).length }),
      action: t("common.open"),
    });
    const archives = linkPanel({
      href: "#/defis",
      title: t("home.archives.title"),
      blurb: t("home.archives.blurb"),
      foot: past.length ? t("home.archives.count", { n: past.length }) : t("home.archives.first"),
      action: t("common.see"),
    });
    const countries = groups.country.map((mode) => modePanel(mode, artists, meta, { compact: true }));
    const kiosks = groups.kiosk.map((mode, i) => modePanel(mode, artists, meta, { compact: i >= VISIBLE_KIOSKS }));
    const shownCountries = visibleCountries();
    const hiddenCountries = countries.slice(shownCountries);
    const hiddenKiosks = kiosks.slice(VISIBLE_KIOSKS);

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
              h("p", { class: "lede" }, t("home.lede")),
              h("ul", { class: "how" }, h("li", {}, icon("i-clock"), t("home.how_rounds")), h("li", {}, icon("i-pencil"), t("home.how_artists"))),
            ),
          ),
          dailyPanel(meta, daily),
        ),
        tier(t("home.group.start"), [...groups.selection.map((mode) => modePanel(mode, artists, meta)), atelier], { columns: 3 }),
        countries.length
          ? tier(t("home.group.countries"), countries.slice(0, shownCountries), {
              columns: "countries",
              more: hiddenCountries,
              moreLabel: t("home.more_countries", { n: hiddenCountries.length }),
            })
          : null,
        kiosks.length
          ? tier(t("home.group.kiosks"), kiosks.slice(0, VISIBLE_KIOSKS), {
              columns: "kiosk",
              more: hiddenKiosks,
              moreLabel: t("home.more_kiosks", { n: hiddenKiosks.length }),
            })
          : null,
        tier(t("home.group.other"), [...groups.production.map((mode) => modePanel(mode, artists, meta)), archives], { columns: 2 }),
        h(
          "footer",
          { class: "home-foot" },
          h("p", {}, t("home.data_date", { date: formatFullDate(meta.generated) })),
          h("p", {}, t("home.credit")),
        ),
      ),
    );
  };
}

export function emptyState(text = t("home.empty")) {
  return h("div", { class: "empty" }, icon("patte", "empty-mark"), h("p", {}, text), h("a", { class: "btn", href: "#/" }, t("common.back_home")));
}

// ------------------------------------------------------------------ fin de partie

function verdictFor(correct, total) {
  if (correct === total) return t("end.verdict.perfect");
  if (correct >= total - 2) return t("end.verdict.great");
  if (correct >= total / 2) return t("end.verdict.good");
  if (correct >= 2) return t("end.verdict.ok");
  return t("end.verdict.hard");
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
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = number.format(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function endView(root, { setup, score, results, people, modeName: mode, dailyNumber, onReplay }) {
  const correct = results.filter((r) => r.correct).length;
  const total = results.length;
  const marks = results.map(markOf);
  const scoreEl = h("span", {}, "0");
  const kicker =
    setup.kind === "daily"
      ? t("end.kicker.daily", { n: dailyNumber, mode })
      : setup.kind === "archive"
        ? t("end.kicker.archive", { n: dailyNumber, date: formatDay(setup.day), mode })
        : setup.kind === "challenge"
          ? t("end.kicker.challenge", { mode })
          : mode;
  const head = h(
    "header",
    { class: "end-head" },
    h("p", { class: "end-kicker" }, kicker),
    h("p", { class: "end-score", "aria-label": t("common.points", { n: score }) }, scoreEl, h("small", {}, ` ${t("common.pts")}`)),
    h("p", { class: "end-verdict" }, `${t("end.count", { correct, total })} ${verdictFor(correct, total)}`),
  );

  let challengeNote = null;
  if (setup.kind === "challenge" && Number.isFinite(setup.target)) {
    const diff = score - setup.target;
    const target = t("common.points", { n: setup.target });
    challengeNote = h(
      "p",
      { class: "end-challenge" },
      diff > 0
        ? t("end.challenge.won", { diff: t("common.points", { n: diff }), target })
        : diff === 0
          ? t("end.challenge.tie", { target })
          : t("end.challenge.lost", { target, diff: t("common.points", { n: -diff }) }),
    );
  }

  const actions = h("div", { class: "btn-row" });
  if (setup.kind === "daily" || setup.kind === "archive") {
    actions.append(h("button", { class: "btn btn-yellow", type: "button", onclick: () => shareDaily(dailyNumber, mode, { score, marks }) }, icon("i-share"), t("end.share")));
  }
  // Pas de lien de défi pour le défi du jour : il gâcherait la surprise des autres.
  if (setup.kind !== "daily") {
    actions.append(
      h(
        "button",
        {
          class: "btn btn-yellow",
          type: "button",
          onclick: () => shareOrCopy({ title: "Coup de Patte", text: t("share.challenge", { points: t("common.points", { n: score }), mode }), url: challengeLink(setup, score) }),
        },
        icon("i-link"),
        t("end.challenge_friend"),
      ),
    );
  }
  if (onReplay) actions.append(h("button", { class: "btn", type: "button", onclick: onReplay }, icon("i-replay"), t("end.replay")));
  actions.append(h("a", { class: "btn btn-ghost", href: "#/" }, t("common.home")));

  const recap = h(
    "ol",
    { class: "recap", "aria-label": t("end.recap") },
    results.map((r, i) => {
      const artist = people[r.answer];
      const guessed = r.guess && r.guess !== r.answer ? people[r.guess]?.name : null;
      const line = r.skipped
        ? t("end.skipped")
        : r.correct
          ? `${titleOf(r.item)}${r.item.year ? `, ${r.item.year}` : ""}`
          : r.timeout
            ? t("end.timeout")
            : t("end.answered", { name: guessed });
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
export function dailyDoneView(root, { number: n, modeName: mode, result }) {
  root.replaceChildren(
    h(
      "div",
      { class: "end" },
      h(
        "header",
        { class: "end-head" },
        h("p", { class: "end-kicker" }, t("end.kicker.daily", { n, mode })),
        h("p", { class: "end-score" }, number.format(result.score), h("small", {}, ` ${t("common.pts")}`)),
        marksRow(result.marks),
        h("p", { class: "end-verdict" }, result.partial ? t("daily.interrupted_long") : t("daily.already")),
        h("p", { class: "daily-next" }, `${t("daily.next", { time: untilMidnight() })}.`),
      ),
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn btn-yellow", type: "button", onclick: () => shareDaily(n, mode, result) }, icon("i-share"), t("end.share")),
        h("a", { class: "btn btn-ghost", href: "#/" }, t("common.home")),
      ),
    ),
  );
}

export function challengeIntro(root, { target, modeName: mode, rounds, onStart }) {
  root.replaceChildren(
    h(
      "div",
      { class: "end" },
      h(
        "header",
        { class: "end-head" },
        h("p", { class: "end-kicker" }, t("challenge.kicker", { mode })),
        h("p", { class: "end-score" }, Number.isFinite(target) ? number.format(target) : "?", h("small", {}, ` ${t("common.pts")}`)),
        h("p", { class: "end-verdict" }, t("challenge.text", { n: rounds })),
      ),
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn btn-yellow btn-balloon", type: "button", onclick: onStart }, t("challenge.start")),
        h("a", { class: "btn btn-ghost", href: "#/" }, t("challenge.later")),
      ),
    ),
  );
}

// ------------------------------------------------------------------ feuilles

export async function openStats() {
  const [meta, artists] = await Promise.all([loadMeta(), loadArtists()]).catch(() => [null, {}]);
  const s = getState();
  const modes = (meta?.modes || []).map(normalize);
  const totals = Object.values(s.modes).reduce(
    (acc, m) => ({ played: acc.played + m.played, correct: acc.correct + m.correct, rounds: acc.rounds + m.rounds, best: Math.max(acc.best, m.best) }),
    { played: 0, correct: 0, rounds: 0, best: 0 },
  );
  const streak = dailyStreak(dayKey(), previousDay);

  if (!totals.played) {
    openSheet(t("stats.title"), [h("p", {}, t("stats.empty")), h("p", { class: "muted" }, t("stats.private"))]);
    return;
  }

  const body = [];
  body.push(
    h(
      "div",
      { class: "stat-grid" },
      h("div", { class: "stat" }, h("b", {}, number.format(totals.played)), h("span", {}, t("stats.games", { n: totals.played }))),
      h("div", { class: "stat" }, h("b", {}, t("stats.percent", { n: Math.round((100 * totals.correct) / Math.max(1, totals.rounds)) })), h("span", {}, t("stats.found_rate"))),
      h("div", { class: "stat" }, h("b", {}, number.format(streak)), h("span", {}, t("stats.streak", { n: streak }))),
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
        h("div", { class: "mode-stat-head" }, h("span", {}, medal ? h("i", { class: `medal-dot medal-${medal.id}` }) : null, modeName(m)), h("span", {}, t("stats.record", { n: st.best }))),
        h("div", { class: "meter", "aria-hidden": "true" }, meter),
        h(
          "small",
          {},
          `${t("stats.found", { n: st.correct, total: st.rounds })} `,
          next ? t("stats.next_medal", { medal: t(`medal.${next.id}`), n: next.need }) : t("stats.all_medals"),
        ),
      );
    });
  body.push(h("section", {}, h("h3", {}, t("stats.by_mode")), h("div", { class: "mode-stats" }, perMode)));

  const eye = Object.entries(s.artists)
    .filter(([, a]) => a.seen >= 3)
    .map(([code, a]) => ({ code, name: artists[code]?.name || code, rate: a.right / a.seen, seen: a.seen }));
  if (eye.length >= 3) {
    const best = [...eye].sort((a, b) => b.rate - a.rate || b.seen - a.seen).slice(0, 5);
    const worst = [...eye].sort((a, b) => a.rate - b.rate || b.seen - a.seen).filter((e) => e.rate < 1).slice(0, 5);
    const list = (items) => h("ul", { class: "eye-list" }, items.map((e) => h("li", {}, h("span", {}, e.name), h("b", {}, t("stats.percent", { n: Math.round(e.rate * 100) })))));
    body.push(h("section", {}, h("h3", {}, t("stats.best")), list(best)));
    if (worst.length) body.push(h("section", {}, h("h3", {}, t("stats.worst")), list(worst)));
  } else {
    body.push(h("p", { class: "muted" }, t("stats.eye_hint")));
  }

  const sheet = openSheet(t("stats.title"), [
    ...body,
    h(
      "button",
      {
        class: "btn btn-ghost",
        type: "button",
        onclick: async () => {
          const ok = await confirmDialog({ title: t("stats.reset_title"), text: t("stats.reset_text"), confirm: t("stats.reset_confirm"), cancel: t("common.cancel") });
          if (ok) {
            resetAll();
            close(sheet);
            toast(t("stats.reset_done"));
            if (location.hash === "#/" || !location.hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
            else location.hash = "#/";
          }
        },
      },
      t("stats.reset"),
    ),
  ]);
}

const link = (href, text) => h("a", { href, target: "_blank", rel: "noopener" }, text);
const item = (label, text) => h("li", {}, tn("about.item", { label: h("b", {}, label), text }));

export async function openAbout() {
  const meta = await loadMeta().catch(() => null);
  const groups = meta ? groupModes(meta) : { selection: [], production: [], country: [], kiosk: [] };
  openSheet(t("about.title"), [
    h("section", {}, h("h3", {}, t("about.rules")), h("p", {}, t("about.rules_1")), h("p", {}, t("about.rules_2"))),
    h("section", {}, h("h3", {}, t("about.points")), h("ul", {}, h("li", {}, t("about.points_1")), h("li", {}, t("about.points_2")), h("li", {}, t("about.points_3")))),
    h(
      "section",
      {},
      h("h3", {}, t("about.modes")),
      h(
        "ul",
        {},
        [...groups.selection, ...groups.production].map((m) => item(modeName(m), modeBlurb(m, meta))),
        item(t("home.group.countries"), t("about.modes_country")),
        item(t("home.group.kiosks"), t("about.modes_kiosk")),
        item(t("daily.title"), t("about.daily")),
        item(t("home.archives.title"), t("about.archives")),
        item(t("home.atelier.title"), t("about.atelier")),
      ),
    ),
    h(
      "section",
      {},
      h("h3", {}, t("about.source")),
      h("p", {}, tn("about.source_text", { inducks: link("https://inducks.org", "Inducks") })),
      meta ? h("p", { class: "muted" }, t("about.updated", { date: formatFullDate(meta.generated) })) : null,
    ),
    h(
      "section",
      {},
      h("h3", {}, t("about.credits")),
      h("p", {}, tn("about.credits_1", { licence: link("https://inducks.org/inducks/COPYING", t("about.licence_link")) })),
      h("p", {}, tn("about.credits_2", { dm: link("https://github.com/bperel/DucksManager", "DucksManager") })),
      h("p", {}, t("about.credits_3")),
      h("p", {}, link("https://github.com/Jonathan8520/coup-de-patte", t("about.source_code", { author: "Jonathan8520" }))),
    ),
  ]);
}

export function openLanguage() {
  let sheet;
  const choose = async (code) => {
    if (code !== lang()) {
      await setLang(code);
      await loadTitles();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    close(sheet);
  };
  const list = h(
    "ul",
    { class: "lang-list" },
    LANGS.map((l) =>
      h(
        "li",
        {},
        h(
          "button",
          { class: "lang-choice", type: "button", lang: l.code, "aria-pressed": String(l.code === lang()), onclick: () => choose(l.code) },
          h("span", {}, l.name),
          l.code === lang() ? icon("i-check") : null,
        ),
      ),
    ),
  );
  sheet = openSheet(t("lang.title"), [
    list,
    h("p", { class: "muted" }, t("lang.note")),
  ]);
}

// ------------------------------------------------------------------ l'atelier

function sampleThumb(item, artist) {
  const title = titleOf(item);
  const box = h("button", { class: "sample", type: "button", "aria-label": t("atelier.view_page", { title }) });
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => {
    const size = box.clientWidth || 140;
    img.style.width = `${img.naturalWidth}px`;
    img.style.height = `${img.naturalHeight}px`;
    img.style.transform = viewTransform(size, size, img.naturalWidth, img.naturalHeight, SAFE);
    box.append(img);
    box.classList.add("ready");
  };
  img.onerror = () => {
    box.classList.add("broken");
    box.append(h("span", { class: "sample-missing" }, t("common.image_missing")));
  };
  img.src = imageUrl(item);
  box.addEventListener("click", () =>
    openPicture({
      src: imageUrl(item),
      alt: t("atelier.page_of", { name: artist.name }),
      caption: [h("strong", {}, title), item.year ? ` (${item.year}), ` : ", ", link(storyUrl(item.story), t("common.see_story"))],
    }),
  );
  return box;
}

function artistEntry(code, artist, count, items, index) {
  const id = `artiste-${index}`;
  const photo = photoUrl(artist);
  const face = h("span", { class: "face" }, h("b", { "aria-hidden": "true" }, artist.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()));
  if (photo) {
    const img = h("img", { src: photo, alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("load", () => face.querySelector("b")?.remove());
    img.addEventListener("error", () => img.remove());
    face.prepend(img);
  }
  const details = [countryName(artist.country), lifeSpan(artist)].filter(Boolean).join(", ");
  const inner = h("div", { class: "artist-inner" });
  const body = h("div", { class: "artist-body", id }, inner);
  const article = h("article", { class: "artist", "data-search": fold([artist.name, code, ...(artist.aka || [])].join(" ")) });
  const toggle = h(
    "button",
    { class: "artist-head", type: "button", "aria-expanded": "false", "aria-controls": id },
    face,
    h("span", { class: "artist-id" }, h("strong", {}, artist.name), h("small", {}, [details, t("atelier.stories", { n: count })].filter(Boolean).join(", "))),
    h("span", { class: "chevron", "aria-hidden": "true" }),
  );
  let filled = false;
  toggle.addEventListener("click", () => {
    const open = !article.classList.contains("open");
    if (open && !filled) {
      filled = true;
      inner.append(
        h("div", { class: "samples" }, items.slice(0, 4).map((item) => sampleThumb(item, artist))),
        h("p", { class: "artist-more" }, link(artistUrl(code), t("atelier.more", { name: artist.name }))),
      );
    }
    article.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  article.append(toggle, body);
  return article;
}

// Dernière recherche de l'Atelier, gardée d'un onglet à l'autre.
let atelierQuery = "";

function atelierSearch(list, current, everyone) {
  const input = h("input", {
    class: "search-input",
    type: "search",
    value: atelierQuery,
    placeholder: t("atelier.search"),
    "aria-label": t("atelier.search"),
    autocomplete: "off",
    spellcheck: "false",
    enterkeyhint: "search",
  });
  const elsewhere = everyone && everyone.id !== current.id
    ? h("a", { href: `#/atelier/${everyone.id}` }, t("atelier.search_all"))
    : null;
  const empty = h("p", { class: "atelier-empty muted", hidden: true, role: "status" }, t("atelier.no_match"), elsewhere ? " " : null, elsewhere);
  const apply = () => {
    atelierQuery = input.value;
    const words = fold(input.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const article of list.children) {
      const match = words.every((word) => article.dataset.search.includes(word));
      article.hidden = !match;
      if (match) shown += 1;
    }
    empty.hidden = shown > 0;
  };
  input.addEventListener("input", apply);
  return { box: h("div", { class: "search" }, icon("i-search"), input), empty, apply };
}

export async function atelierView(root, modeId) {
  const [meta, artists] = await Promise.all([loadMeta(), loadArtists(), loadTitles()]);
  const groups = groupModes(meta);
  const modes = [...groups.selection, ...groups.country, ...groups.production];
  const current = modes.find((m) => m.id === modeId) || modes[0];
  const mode = await loadMode(current.id);
  return () => {
    const tabs = h(
      "nav",
      { class: "tabs", "aria-label": t("atelier.tabs") },
      modes.map((m) => h("a", { class: "tab", href: `#/atelier/${m.id}`, "aria-current": m.id === current.id ? "page" : null }, modeName(m))),
    );
    const list = h(
      "div",
      { class: "artist-list" },
      mode.artists.map((code, i) => artistEntry(code, artists[code] || { name: code }, mode.counts?.[i] || 0, mode._byArtist.get(code) || [], i)),
    );
    const search = atelierSearch(list, current, modes.find((m) => m.id === "tous"));
    root.replaceChildren(
      h(
        "div",
        { class: "atelier" },
        h("header", { class: "atelier-head" }, h("h1", {}, t("atelier.title")), h("p", { class: "lede" }, t("atelier.lede"))),
        tabs,
        search.box,
        search.empty,
        list,
        h("div", { class: "btn-row atelier-foot" }, h("a", { class: "btn btn-yellow btn-balloon", href: `#/jouer/${current.id}` }, t("atelier.play", { mode: modeName(current) }))),
      ),
    );
    if (atelierQuery) search.apply();
    tabs.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest", inline: "center" });
  };
}

// ------------------------------------------------------------------ défis précédents

export async function pastDailiesView(root) {
  const [meta, daily] = await Promise.all([loadMeta(), loadDaily()]);
  return () => {
    const today = dayKey();
    const days = [today, ...pastDays(daily, today)].filter((day) => daily.days[day]);
    const rows = days.map((day) => {
      const game = daily.days[day];
      const n = daysBetween(daily.launch, day) + 1;
      const mode = modeName(meta.modes.find((m) => m.id === game.mode) || { id: game.mode, name: "" });
      const own = day === today ? dailyResult(day) : archiveResult(day) || dailyResult(day);
      const status = own ? `${number.format(own.score)} ${t("common.pts")}` : day === today ? t("past.today") : t("past.not_played");
      return h(
        "li",
        {},
        h(
          "a",
          { class: "past", href: day === today ? "#/jour" : `#/jour/${day}` },
          h("span", { class: "past-n" }, t("past.n", { n })),
          h("span", { class: "past-what" }, h("strong", {}, capitalize(formatDay(day))), h("small", {}, mode)),
          h("span", { class: own ? "past-score" : "past-score muted" }, status),
        ),
      );
    });
    root.replaceChildren(
      h(
        "div",
        { class: "atelier" },
        h("header", { class: "atelier-head" }, h("h1", {}, t("past.title")), h("p", { class: "lede" }, t("past.lede"))),
        days.length > 1 ? null : h("p", { class: "muted" }, t("past.first")),
        h("ol", { class: "past-list" }, rows),
      ),
    );
  };
}

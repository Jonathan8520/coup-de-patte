// Statistiques gardées dans le navigateur du joueur (rien n'est envoyé ailleurs).

const KEY = "coup-de-patte:v1";
const SEEN_LIMIT = 400;

export const MEDALS = [
  { id: "or", label: "médaille d'or", need: 100 },
  { id: "argent", label: "médaille d'argent", need: 40 },
  { id: "bronze", label: "médaille de bronze", need: 10 },
];

function blank() {
  return { v: 1, modes: {}, artists: {}, daily: {}, seen: [] };
}

let state = null;

function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    state = blank();
  }
  return state;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* navigation privée ou stockage plein : tant pis, la partie reste jouable */
  }
}

export function getState() {
  return load();
}

export function seenSet() {
  return new Set(load().seen);
}

export function recordGame({ kind, mode, day, score, results }) {
  const s = load();
  const m = (s.modes[mode] ||= { played: 0, best: 0, total: 0, correct: 0, rounds: 0, fast: 0 });
  m.played += 1;
  m.best = Math.max(m.best, score);
  m.total += score;
  for (const r of results) {
    m.rounds += 1;
    if (r.correct) m.correct += 1;
    if (r.bonus >= 50) m.fast += 1;
    const a = (s.artists[r.answer] ||= { seen: 0, right: 0 });
    a.seen += 1;
    if (r.correct) a.right += 1;
    s.seen.push(r.itemId);
  }
  if (s.seen.length > SEEN_LIMIT) s.seen = s.seen.slice(-SEEN_LIMIT);
  if (kind === "daily" && day && !s.daily[day]) {
    s.daily[day] = { score, mode, marks: results.map(markOf) };
  }
  save();
}

export function markOf(result) {
  if (!result.correct) return result.timeout ? "time" : "ko";
  return result.bonus >= 50 ? "fast" : "ok";
}

export function dailyResult(day) {
  return load().daily[day] || null;
}

export function dailyStreak(todayKey, previousKey) {
  const s = load();
  let streak = 0;
  let key = s.daily[todayKey] ? todayKey : previousKey(todayKey);
  while (key && s.daily[key]) {
    streak += 1;
    key = previousKey(key);
  }
  return streak;
}

export function medalFor(correct) {
  return MEDALS.find((medal) => correct >= medal.need) || null;
}

export function nextMedal(correct) {
  return [...MEDALS].reverse().find((medal) => correct < medal.need) || null;
}

export function resetAll() {
  state = blank();
  save();
}

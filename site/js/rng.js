// Hasard reproductible : une même graine donne toujours la même partie.

export function hashString(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFrom = (text) => mulberry32(hashString(text));

export function randomSeed() {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return bytes[0].toString(36) + bytes[1].toString(36);
}

export function shuffle(list, rnd) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function pick(list, rnd) {
  return list[Math.floor(rnd() * list.length)];
}

// Tirage sans remise, pondéré (les dessinateurs les plus publiés sortent plus souvent).
export function weightedSample(codes, weights, k, rnd) {
  const pool = codes.map((code, i) => ({ code, w: Math.max(weights[i] ?? 1, 0.0001) }));
  const chosen = [];
  while (chosen.length < k && pool.length) {
    const total = pool.reduce((sum, e) => sum + e.w, 0);
    let target = rnd() * total;
    let index = 0;
    for (; index < pool.length - 1; index++) {
      target -= pool[index].w;
      if (target <= 0) break;
    }
    chosen.push(pool[index].code);
    pool.splice(index, 1);
  }
  return chosen;
}

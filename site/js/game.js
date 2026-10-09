// Une partie : huit cases, neuf dessinateurs, quinze secondes par case.

import { h, icon, number, reducedMotion, initials, sleep } from "./util.js";
import { imageUrl, photoUrl, storyUrl, artistUrl, countryName, lifeSpan } from "./data.js";
import { confirmDialog } from "./dialogs.js";

export const ROUND_MS = 15000;
export const BONUS_MS = 7500;
const ZOOM_MS = 5200;
const ZOOM_DELAY_MS = 900;
const LOAD_TIMEOUT_MS = 15000;

// Zone affichée pendant la manche : la page sans sa bande du haut (titre, crédits).
export const SAFE = { x: 0, y: 0.32, w: 1, h: 0.68 };
const FULL = { x: 0, y: 0, w: 1, h: 1 };

export function viewTransform(fw, fh, iw, ih, rect, fit = "cover") {
  const rw = rect.w * iw;
  const rh = rect.h * ih;
  const s = fit === "cover" ? Math.max(fw / rw, fh / rh) : Math.min(fw / rw, fh / rh);
  const W = iw * s;
  const H = ih * s;
  let tx = fw / 2 - s * (rect.x * iw + rw / 2);
  let ty = fh / 2 - s * (rect.y * ih + rh / 2);
  tx = W >= fw ? Math.min(0, Math.max(fw - W, tx)) : (fw - W) / 2;
  ty = H >= fh ? Math.min(0, Math.max(fh - H, ty)) : (fh - H) / 2;
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(5)})`;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.alt = "";
    const timer = setTimeout(() => reject(new Error("délai dépassé")), LOAD_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      if (img.naturalWidth < 120 || img.naturalHeight < 120) reject(new Error("image trop petite"));
      else resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("image introuvable"));
    };
    img.src = src;
  });
}

function scoreFor(correct, elapsed) {
  if (!correct) return { base: 0, bonus: 0 };
  const bonus = elapsed < BONUS_MS ? Math.round(100 * (1 - elapsed / BONUS_MS)) : 0;
  return { base: 100, bonus };
}

function face(artist, size) {
  const photo = photoUrl(artist);
  const wrap = h("span", { class: "face" }, h("b", { "aria-hidden": "true" }, initials(artist.name)));
  if (photo) {
    const img = h("img", { src: photo, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "strict-origin-when-cross-origin" });
    img.addEventListener("load", () => wrap.querySelector("b")?.remove());
    img.addEventListener("error", () => img.remove());
    wrap.prepend(img);
  }
  if (size) wrap.style.width = wrap.style.height = `${size}px`;
  return wrap;
}

export class Game {
  /**
   * setup : { kind, modeId, title, subtitle, artists: [codes], rounds: [item], spares: Map(artist -> items) }
   * artists : dictionnaire des dessinateurs (artists.json)
   * onFinish(results) : appelé à la fin de la partie
   */
  constructor(root, setup, artists, { onFinish, onQuit }) {
    this.root = root;
    this.setup = setup;
    this.people = artists;
    this.onFinish = onFinish;
    this.onQuit = onQuit;
    this.index = -1;
    this.score = 0;
    this.results = [];
    this.used = new Map();
    this.images = [];
    this.raf = 0;
    this.state = "idle";
    this.pausedAt = 0;
    this.onKey = this.onKey.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    this.onResize = this.onResize.bind(this);
  }

  mount() {
    const s = this.setup;
    this.scoreEl = h("output", { class: "score", "aria-label": "Score" }, "0");
    this.labelEl = h("div", { class: "round-label" }, s.title, h("small", {}, s.subtitle || ""));
    const quit = h("button", { class: "icon-btn", type: "button", "aria-label": "Quitter la partie", onclick: () => this.quit() }, icon("i-close"));
    this.dotsEl = h("div", { class: "dots", "aria-hidden": "true" }, s.rounds.map(() => h("i")));
    this.frameEl = h("div", { class: "frame", role: "img", "aria-label": "Case de bande dessinée à identifier" });
    this.timerEl = h("div", { class: "timer", role: "progressbar", "aria-label": "Temps restant", "aria-valuemin": "0", "aria-valuemax": "15" }, h("div", { class: "left" }));
    this.questionEl = h("div", { class: "question" }, h("span", {}, "Qui a dessiné cette case ?"), h("span", { class: "hint" }, ""));
    this.tilesEl = h("ul", { class: "tiles", "aria-label": "Dessinateurs" });
    this.tileByCode = new Map();
    s.artists.forEach((code, i) => {
      const artist = this.people[code];
      const btn = h(
        "button",
        { class: "tile", type: "button", disabled: true, "data-code": code, onclick: () => this.guess(code) },
        h("span", { class: "key", "aria-hidden": "true" }, String(i + 1)),
        face(artist),
        h("span", { class: "name" }, artist.name),
      );
      this.tileByCode.set(code, btn);
      this.tilesEl.append(h("li", {}, btn));
    });
    this.resultEl = h("section", { class: "result", "aria-live": "polite" });
    this.liveEl = h("p", { class: "sr-only", "aria-live": "assertive" });

    this.root.replaceChildren(
      h(
        "div",
        { class: "game" },
        h("div", { class: "game-top" }, quit, this.labelEl, this.scoreEl),
        this.dotsEl,
        h("div", { class: "stage" }, this.frameEl, this.timerEl),
        h("div", { class: "side" }, this.questionEl, this.tilesEl, this.resultEl, this.liveEl),
      ),
    );
    document.body.classList.add("is-playing");
    document.addEventListener("keydown", this.onKey);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("resize", this.onResize);
    this.start();
  }

  destroy() {
    this.state = "gone";
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timeout);
    document.body.classList.remove("is-playing");
    document.removeEventListener("keydown", this.onKey);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("resize", this.onResize);
  }

  message(...content) {
    this.frameEl.querySelector(".frame-msg")?.remove();
    if (!content.length) return;
    this.frameEl.append(h("div", { class: "frame-msg" }, ...content));
  }

  loader(text) {
    this.message(h("div", { class: "loader" }, icon("i-pencil"), h("span", {}, text)));
  }

  // Charge l'image d'une manche ; si elle ne vient pas, prend une autre case du même dessinateur.
  prepare(i) {
    if (this.images[i]) return this.images[i];
    const round = this.setup.rounds[i];
    const tried = new Set();
    const attempt = async (item) => {
      tried.add(item.id);
      try {
        const img = await loadImage(imageUrl(item));
        return { item, img };
      } catch (error) {
        const spares = (this.setup.spares?.get(item.artist) || []).filter((x) => !tried.has(x.id));
        if (spares.length && tried.size < 4) return attempt(spares[Math.floor(Math.random() * spares.length)]);
        throw error;
      }
    };
    this.images[i] = attempt(round);
    this.images[i].catch(() => {});
    return this.images[i];
  }

  async start() {
    this.state = "loading";
    this.loader("Chargement des cases");
    try {
      await this.prepare(0);
    } catch {
      this.failed();
      return;
    }
    for (let i = 1; i < this.setup.rounds.length; i++) this.prepare(i);
    if (this.state === "gone") return;
    this.state = "ready";
    const go = h("button", { class: "btn btn-yellow btn-balloon", type: "button", onclick: () => this.round(0) }, "C'est parti");
    this.message(
      h(
        "div",
        { class: "loader" },
        h("strong", { style: { fontSize: "1.25rem" } }, `${this.setup.rounds.length} cases, 15 secondes chacune`),
        h("span", {}, "Réponds dans les 7 premières secondes pour un bonus."),
        h("div", { style: { marginTop: "10px" } }, go),
      ),
    );
    go.focus({ preventScroll: true });
  }

  failed() {
    this.state = "failed";
    this.message(
      h(
        "div",
        { class: "loader" },
        h("strong", {}, "Les images ne se chargent pas."),
        h("span", {}, "Les cases viennent d'Inducks : vérifie ta connexion, puis réessaie."),
        h("div", { class: "btn-row", style: { justifyContent: "center", marginTop: "8px" } },
          h("button", { class: "btn", type: "button", onclick: () => location.reload() }, icon("i-replay"), "Réessayer"),
        ),
      ),
    );
  }

  async round(i) {
    this.index = i;
    this.state = "loading";
    this.closeResult();
    const dots = [...this.dotsEl.children];
    dots.forEach((dot, n) => dot.classList.toggle("current", n === i));
    this.labelEl.firstChild.textContent = `Case ${i + 1} sur ${this.setup.rounds.length}`;
    this.questionEl.querySelector(".hint").textContent = "";
    this.setTimer(1, "bonus");

    let prepared;
    const slow = setTimeout(() => this.loader("Chargement de la case"), 250);
    try {
      prepared = await this.prepare(i);
    } catch {
      clearTimeout(slow);
      // Case impossible à charger : on passe, sans pénalité.
      const item = this.setup.rounds[i];
      this.results.push({ itemId: item.id, answer: item.artist, guess: null, correct: false, skipped: true, base: 0, bonus: 0, elapsed: 0, item });
      this.used.set(item.artist, i + 1);
      dots[i].classList.remove("current");
      if (i + 1 < this.setup.rounds.length) return this.round(i + 1);
      return this.finish();
    }
    clearTimeout(slow);
    if (this.state === "gone") return;
    this.message();
    this.current = prepared;

    const old = this.frameEl.querySelector("img");
    const img = prepared.img;
    img.className = "";
    img.style.width = `${img.naturalWidth}px`;
    img.style.height = `${img.naturalHeight}px`;
    if (old && old !== img) old.remove();
    this.frameEl.append(img);

    const rnd = Math.random;
    const zw = 0.42 + rnd() * 0.08;
    const { width: fw, height: fh } = this.frameEl.getBoundingClientRect();
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const zh = Math.min(SAFE.h, (zw * iw * fh) / (fw * ih));
    const zx = 0.08 + rnd() * (0.92 - zw - 0.08);
    const zy = SAFE.y + 0.03 + rnd() * Math.max(0, SAFE.h - zh - 0.05);
    this.zoomRect = { x: zx, y: zy, w: zw, h: zh };

    const motion = !reducedMotion();
    img.style.transform = viewTransform(fw, fh, iw, ih, motion ? this.zoomRect : SAFE);
    void img.offsetWidth;
    img.classList.add("ready");
    if (motion) {
      img.style.setProperty("--zoom-ms", `${ZOOM_MS}ms`);
      img.style.setProperty("--zoom-delay", `${ZOOM_DELAY_MS}ms`);
      requestAnimationFrame(() => {
        img.classList.add("zooming");
        img.style.transform = viewTransform(fw, fh, iw, ih, SAFE);
      });
    }

    for (const [code, tile] of this.tileByCode) {
      tile.classList.remove("is-right", "is-wrong");
      tile.disabled = this.used.has(code);
    }

    this.state = "playing";
    this.startedAt = performance.now();
    this.tick();
  }

  setTimer(fraction, tone) {
    const left = this.timerEl.firstChild;
    left.style.transform = `scaleX(${Math.max(0, fraction)})`;
    this.timerEl.classList.toggle("bonus", tone === "bonus");
    this.timerEl.classList.toggle("late", tone === "late");
  }

  elapsed() {
    return performance.now() - this.startedAt;
  }

  tick() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (this.state !== "playing") return;
      const t = this.elapsed();
      const tone = t < BONUS_MS ? "bonus" : ROUND_MS - t < 3000 ? "late" : "";
      this.setTimer(1 - t / ROUND_MS, tone);
      this.timerEl.setAttribute("aria-valuenow", String(Math.ceil((ROUND_MS - t) / 1000)));
      if (t >= ROUND_MS) {
        this.guess(null);
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  guess(code) {
    if (this.state !== "playing") return;
    this.state = "answered";
    cancelAnimationFrame(this.raf);
    const elapsed = Math.min(this.elapsed(), ROUND_MS);
    const { item } = this.current;
    const answer = item.artist;
    const correct = code === answer;
    const { base, bonus } = scoreFor(correct, elapsed);
    const result = { itemId: item.id, answer, guess: code, correct, timeout: code === null, base, bonus, elapsed, item };
    this.results.push(result);
    this.used.set(answer, this.index + 1);

    for (const [c, tile] of this.tileByCode) {
      tile.disabled = true;
      if (c === answer) {
        tile.classList.add("is-right", "used");
        if (!tile.querySelector(".used-in")) tile.append(h("span", { class: "used-in" }, `n°${this.index + 1}`));
      } else if (c === code) tile.classList.add("is-wrong");
    }

    const dot = this.dotsEl.children[this.index];
    dot.classList.remove("current");
    dot.classList.add(correct ? (bonus >= 50 ? "fast" : "ok") : "ko");

    if (correct) {
      this.score += base + bonus;
      this.scoreEl.textContent = number.format(this.score);
      this.scoreEl.classList.remove("bump");
      void this.scoreEl.offsetWidth;
      this.scoreEl.classList.add("bump");
    }
    this.reveal();
    this.showResult(result);
  }

  // La case recule pour montrer toute la planche, titre compris.
  reveal() {
    const img = this.current.img;
    const { width: fw, height: fh } = this.frameEl.getBoundingClientRect();
    const frozen = getComputedStyle(img).transform;
    img.style.transform = frozen === "none" ? img.style.transform : frozen;
    img.classList.remove("zooming");
    void img.offsetWidth;
    img.classList.add("revealing");
    img.style.transform = viewTransform(fw, fh, img.naturalWidth, img.naturalHeight, FULL, "contain");
    this.frameEl.setAttribute("aria-label", "Planche complète");
  }

  showResult(result) {
    const artist = this.people[result.answer];
    const item = result.item;
    const last = this.index === this.setup.rounds.length - 1;
    const verdict = result.correct ? "Bien vu" : result.timeout ? "Temps écoulé" : "Raté";
    const points = result.correct
      ? `+${result.base}${result.bonus ? ` +${result.bonus} rapidité` : ""}`
      : "0 point";
    const year = item.year ? ` (${item.year})` : "";
    const details = [countryName(artist.country), lifeSpan(artist)].filter(Boolean).join(", ");
    const next = h(
      "button",
      { class: "btn btn-yellow", type: "button", onclick: () => this.next() },
      last ? "Voir mon score" : "Case suivante",
    );
    this.resultEl.className = `result ${result.correct ? "ok" : "ko"}`;
    this.resultEl.replaceChildren(
      h("div", { class: "result-verdict" }, h("strong", {}, verdict), h("span", { class: "result-points" }, points)),
      h(
        "div",
        { class: "result-who" },
        face(artist),
        h(
          "p",
          { class: "result-artist" },
          result.correct ? "C'est bien " : "C'était ",
          h("a", { href: artistUrl(result.answer), target: "_blank", rel: "noopener" }, h("b", {}, artist.name)),
          details ? ` (${details})` : "",
          ".",
        ),
      ),
      h(
        "p",
        { class: "result-story" },
        `« ${item.title || item.original || "Sans titre"} »${year}, `,
        h("a", { href: storyUrl(item.story), target: "_blank", rel: "noopener" }, "voir l'histoire sur Inducks"),
      ),
      next,
    );
    this.liveEl.textContent = `${verdict}. ${result.correct ? "" : `C'était ${artist.name}.`} ${points}.`;
    requestAnimationFrame(() => {
      this.resultEl.classList.add("open");
      next.focus({ preventScroll: true });
    });
  }

  closeResult() {
    this.resultEl?.classList.remove("open");
  }

  async next() {
    if (this.state !== "answered") return;
    this.state = "between";
    this.closeResult();
    const img = this.current?.img;
    if (img && !reducedMotion()) {
      img.classList.remove("ready");
      await sleep(220);
    }
    if (this.index + 1 < this.setup.rounds.length) this.round(this.index + 1);
    else this.finish();
  }

  finish() {
    this.state = "done";
    this.destroy();
    this.onFinish?.({ score: this.score, results: this.results });
  }

  async quit() {
    if (this.state === "done" || this.state === "gone") return;
    const wasPlaying = this.state === "playing";
    if (wasPlaying) this.pause();
    const ok = await confirmDialog({
      title: "Quitter la partie ?",
      text: "Ton score ne sera pas enregistré.",
      confirm: "Quitter",
      cancel: "Continuer",
    });
    if (ok) {
      this.destroy();
      this.onQuit?.();
    } else if (wasPlaying) this.resume();
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.pausedAt = performance.now();
    cancelAnimationFrame(this.raf);
    const img = this.current?.img;
    if (img) {
      const frozen = getComputedStyle(img).transform;
      img.classList.remove("zooming");
      if (frozen !== "none") img.style.transform = frozen;
    }
  }

  resume() {
    if (this.state !== "paused") return;
    const pausedFor = performance.now() - this.pausedAt;
    this.startedAt += pausedFor;
    this.state = "playing";
    const img = this.current?.img;
    if (img && !reducedMotion()) {
      const remaining = Math.max(0, ZOOM_DELAY_MS + ZOOM_MS - this.elapsed());
      const { width: fw, height: fh } = this.frameEl.getBoundingClientRect();
      img.style.setProperty("--zoom-ms", `${Math.min(ZOOM_MS, remaining)}ms`);
      img.style.setProperty("--zoom-delay", `${Math.max(0, remaining - ZOOM_MS)}ms`);
      img.classList.add("zooming");
      img.style.transform = viewTransform(fw, fh, img.naturalWidth, img.naturalHeight, SAFE);
    }
    this.tick();
  }

  onVisibility() {
    if (document.hidden) this.pause();
    else if (!document.querySelector("dialog[open]")) this.resume();
  }

  onResize() {
    const img = this.current?.img;
    if (!img) return;
    const { width: fw, height: fh } = this.frameEl.getBoundingClientRect();
    const rect = this.state === "playing" || this.state === "paused" ? SAFE : FULL;
    img.classList.remove("zooming", "revealing");
    img.style.transform = viewTransform(fw, fh, img.naturalWidth, img.naturalHeight, rect, rect === FULL ? "contain" : "cover");
  }

  onKey(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    if (this.state === "playing" && /^[1-9]$/.test(event.key)) {
      const code = this.setup.artists[Number(event.key) - 1];
      if (code && !this.used.has(code)) {
        event.preventDefault();
        this.guess(code);
      }
    } else if (this.state === "answered" && (event.key === "Enter" || event.key === " ") && document.activeElement?.tagName !== "A") {
      event.preventDefault();
      this.next();
    } else if (event.key === "Escape" && this.state === "playing") {
      event.preventDefault();
      this.quit();
    }
  }
}

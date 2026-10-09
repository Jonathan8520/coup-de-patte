// Une partie : huit cases, neuf dessinateurs, quinze secondes par case.

import { h, icon, number, reducedMotion, initials, sleep } from "./util.js";
import { imageUrl, photoUrl, storyUrl, artistUrl, countryName, lifeSpan, storyTitle } from "./data.js";
import { t, tn, quote } from "./i18n.js";
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
    const img = h("img", { src: photo, alt: "", loading: "lazy", decoding: "async" });
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
    if (this.state === "gone") return;
    const s = this.setup;
    this.scoreEl = h("output", { class: "score", "aria-label": t("game.score") }, "0");
    this.labelEl = h("div", { class: "round-label" }, s.title, h("small", {}, s.subtitle || ""));
    const quit = h("button", { class: "icon-btn", type: "button", "aria-label": t("game.quit"), onclick: () => this.quit() }, icon("i-close"));
    this.dotsEl = h("div", { class: "dots", "aria-hidden": "true" }, s.rounds.map(() => h("i")));
    this.frameEl = h("div", { class: "frame", role: "img", "aria-label": t("game.frame_label") });
    this.timerEl = h("div", { class: "timer", role: "progressbar", "aria-label": t("game.timer"), "aria-valuemin": "0", "aria-valuemax": "15" }, h("div", { class: "left" }));
    this.questionEl = h("div", { class: "question" }, h("span", {}, t("game.question")), h("span", { class: "hint" }, ""));
    this.tilesEl = h("ul", { class: "tiles", "aria-label": t("game.artists") });
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
    this.loader(t("game.loading"));
    try {
      await this.prepare(0);
    } catch {
      this.failed();
      return;
    }
    for (let i = 1; i < this.setup.rounds.length; i++) this.prepare(i);
    if (this.state === "gone") return;
    this.state = "ready";
    const go = h("button", { class: "btn btn-yellow btn-balloon", type: "button", onclick: () => this.round(0) }, t("game.go"));
    this.message(
      h(
        "div",
        { class: "loader" },
        h("strong", { style: { fontSize: "1.25rem" } }, t("game.intro", { rounds: this.setup.rounds.length, seconds: ROUND_MS / 1000 })),
        h("span", {}, t("game.intro_bonus")),
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
        h("strong", {}, t("game.images_fail")),
        h("span", {}, t("game.images_fail_hint")),
        h("div", { class: "btn-row", style: { justifyContent: "center", marginTop: "8px" } },
          h("button", { class: "btn", type: "button", onclick: () => location.reload() }, icon("i-replay"), t("game.retry")),
        ),
      ),
    );
  }

  async round(i) {
    if (this.state === "gone") return;
    this.index = i;
    this.state = "loading";
    this.onRound?.(i);
    this.closeResult();
    const dots = [...this.dotsEl.children];
    dots.forEach((dot, n) => dot.classList.toggle("current", n === i));
    this.labelEl.firstChild.textContent = t("game.round", { i: i + 1, total: this.setup.rounds.length });
    this.questionEl.querySelector(".hint").textContent = "";
    this.setTimer(1, "bonus");

    let prepared;
    const slow = setTimeout(() => this.loader(t("game.loading_one")), 250);
    try {
      prepared = await this.prepare(i);
    } catch {
      clearTimeout(slow);
      if (this.state === "gone") return;
      // Case impossible à charger : on passe, sans pénalité, et son dessinateur est retiré.
      const item = this.setup.rounds[i];
      this.results.push({ itemId: item.id, answer: item.artist, guess: null, correct: false, skipped: true, base: 0, bonus: 0, elapsed: 0, item });
      this.used.set(item.artist, i + 1);
      const tile = this.tileByCode.get(item.artist);
      if (tile) {
        tile.classList.add("used");
        tile.disabled = true;
        if (!tile.querySelector(".used-in")) tile.append(h("span", { class: "used-in" }, t("game.used", { n: i + 1 })));
      }
      dots[i].classList.remove("current");
      dots[i].classList.add("ko");
      this.onRoundEnd?.(this.results);
      if (i + 1 < this.setup.rounds.length) return this.round(i + 1);
      return this.finish();
    }
    clearTimeout(slow);
    if (this.state === "gone") return;
    this.message();
    this.current = prepared;
    this.frameEl.setAttribute("aria-label", t("game.frame_label"));

    const old = this.frameEl.querySelector("img");
    const img = prepared.img;
    img.className = "";
    img.style.width = `${img.naturalWidth}px`;
    img.style.height = `${img.naturalHeight}px`;
    if (old && old !== img) old.remove();
    this.frameEl.append(img);

    const rnd = Math.random;
    const zw = 0.42 + rnd() * 0.08;
    const { fw, fh } = this.frameSize();
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
    // Une fenêtre ouverte ou un onglet caché pendant le chargement : le chrono attend.
    if (document.hidden || document.querySelector("dialog[open]")) this.pause();
  }

  // Taille intérieure du cadre (sans sa bordure), là où l'image est posée.
  frameSize() {
    return { fw: this.frameEl.clientWidth, fh: this.frameEl.clientHeight };
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
      const seconds = String(Math.max(0, Math.ceil((ROUND_MS - t) / 1000)));
      if (this.timerEl.getAttribute("aria-valuenow") !== seconds) this.timerEl.setAttribute("aria-valuenow", seconds);
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
        if (!tile.querySelector(".used-in")) tile.append(h("span", { class: "used-in" }, t("game.used", { n: this.index + 1 })));
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
    this.onRoundEnd?.(this.results);
  }

  // La case recule pour montrer toute la planche, titre compris.
  reveal() {
    const img = this.current.img;
    const { fw, fh } = this.frameSize();
    const frozen = getComputedStyle(img).transform;
    img.style.transform = frozen === "none" ? img.style.transform : frozen;
    img.classList.remove("zooming");
    void img.offsetWidth;
    img.classList.add("revealing");
    img.style.transform = viewTransform(fw, fh, img.naturalWidth, img.naturalHeight, FULL, "contain");
    this.frameEl.setAttribute("aria-label", t("game.frame_full"));
  }

  showResult(result) {
    const artist = this.people[result.answer];
    const item = result.item;
    const last = this.index === this.setup.rounds.length - 1;
    const verdict = result.correct ? t("game.right") : result.timeout ? t("game.timeout") : t("game.wrong");
    const points = result.correct
      ? `${t("game.base", { n: result.base })}${result.bonus ? ` ${t("game.speed", { n: result.bonus })}` : ""}`
      : t("game.zero");
    const year = item.year ? ` (${item.year})` : "";
    const details = [countryName(artist.country), lifeSpan(artist)].filter(Boolean).join(", ");
    const next = h(
      "button",
      { class: "btn btn-yellow", type: "button", onclick: () => this.next() },
      last ? t("game.see_score") : t("game.next"),
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
          tn(result.correct ? "game.it_is" : "game.it_was", {
            name: h("a", { href: artistUrl(result.answer), target: "_blank", rel: "noopener" }, h("b", {}, artist.name)),
          }),
          details ? ` (${details})` : "",
          ".",
        ),
      ),
      h(
        "p",
        { class: "result-story" },
        `${quote(storyTitle(item) || t("common.untitled"))}${year}, `,
        h("a", { href: storyUrl(item.story), target: "_blank", rel: "noopener" }, t("common.see_story")),
      ),
      next,
    );
    this.liveEl.textContent = result.correct
      ? t("game.live_right", { verdict, points })
      : t("game.live_wrong", { verdict, name: artist.name, points });
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
    if (this.state === "gone") return;
    this.state = "done";
    this.destroy();
    this.onFinish?.({ score: this.score, results: this.results });
  }

  async quit() {
    if (this.state === "done" || this.state === "gone") return;
    const wasPlaying = this.state === "playing";
    if (wasPlaying) this.pause();
    const ok = await confirmDialog({
      title: t("game.quit_title"),
      text: t("game.quit_text"),
      confirm: t("game.quit_confirm"),
      cancel: t("game.quit_cancel"),
    });
    if (ok) {
      this.destroy();
      this.onQuit?.();
    } else if (this.state === "paused" && !document.hidden) this.resume();
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
      const { fw, fh } = this.frameSize();
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
    const { fw, fh } = this.frameSize();
    const rect = this.state === "playing" || this.state === "paused" ? SAFE : FULL;
    img.classList.remove("zooming", "revealing");
    img.style.transform = viewTransform(fw, fh, img.naturalWidth, img.naturalHeight, rect, rect === FULL ? "contain" : "cover");
  }

  onKey(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    // event.code : les chiffres marchent aussi en AZERTY, sans Maj.
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || "")?.[1] || (/^[1-9]$/.test(event.key) ? event.key : null);
    const focus = document.activeElement;
    const neutralFocus = !focus || focus === document.body || focus === this.root || this.resultEl.contains(focus);
    if (this.state === "playing" && digit) {
      const code = this.setup.artists[Number(digit) - 1];
      if (code && !this.used.has(code)) {
        event.preventDefault();
        this.guess(code);
      }
    } else if (this.state === "answered" && (event.key === "Enter" || event.key === " ") && neutralFocus && focus?.tagName !== "A") {
      event.preventDefault();
      this.next();
    } else if (event.key === "Escape" && this.state === "playing") {
      event.preventDefault();
      this.quit();
    }
  }
}

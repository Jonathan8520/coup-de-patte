// Feuilles latérales et fenêtres, avec ouverture et fermeture animées.
//
// Les animations passent par l'API Web Animations plutôt que par des transitions CSS :
// un <dialog> qui vient d'apparaître n'a pas encore d'état « avant » calculé, et Safari
// affichait alors la feuille d'un coup. Ici, le point de départ est donné explicitement.

import { h, icon, reducedMotion } from "./util.js";

// Départ en douceur (vitesse nulle), arrivée freinée : pas d'apparition brusque.
const EASE_OPEN = "cubic-bezier(.35, 0, .15, 1)";
const EASE_CLOSE = "cubic-bezier(.4, 0, .9, .4)";

function lockScroll(lock) {
  document.documentElement.style.overflow = lock ? "hidden" : "";
}

function parts(dialog) {
  return {
    scrim: dialog.querySelector(".scrim"),
    panel: dialog.querySelector(".sheet-inner, .modal-inner"),
    isSheet: dialog.classList.contains("sheet"),
  };
}

// Position de la feuille quand elle est cachée : à droite sur grand écran, en bas sur téléphone.
function hiddenTransform() {
  return window.matchMedia("(min-width: 760px)").matches ? "translateX(100%)" : "translateY(100%)";
}

function animateIn(dialog) {
  const { scrim, panel, isSheet } = parts(dialog);
  const reduce = reducedMotion();
  scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? 120 : 340, easing: "ease-out", fill: "both" });
  let frames;
  if (reduce) frames = [{ opacity: 0 }, { opacity: 1 }];
  else if (isSheet) frames = [{ transform: hiddenTransform() }, { transform: "translate(0, 0)" }];
  else frames = [{ opacity: 0, transform: "translateY(18px) scale(.96)" }, { opacity: 1, transform: "translateY(0) scale(1)" }];
  panel.animate(frames, { duration: reduce ? 150 : isSheet ? 480 : 340, easing: EASE_OPEN, fill: "both" });
}

function animateOut(dialog) {
  const { scrim, panel, isSheet } = parts(dialog);
  const reduce = reducedMotion();
  // On repart de l'endroit où se trouve le panneau, même s'il était encore en train d'arriver.
  const from = getComputedStyle(panel);
  const start = { transform: from.transform === "none" ? "translate(0, 0)" : from.transform, opacity: from.opacity };
  const scrimFrom = getComputedStyle(scrim).opacity;
  for (const el of [scrim, panel]) el.getAnimations().forEach((a) => a.cancel());
  let end;
  if (reduce) end = { opacity: 0 };
  else if (isSheet) end = { transform: hiddenTransform() };
  else end = { opacity: 0, transform: "translateY(12px) scale(.97)" };
  const duration = reduce ? 120 : isSheet ? 300 : 220;
  const a = panel.animate([reduce ? { opacity: start.opacity } : start, end], { duration, easing: EASE_CLOSE, fill: "forwards" });
  const b = scrim.animate([{ opacity: scrimFrom }, { opacity: 0 }], { duration, easing: "ease-in", fill: "forwards" });
  return Promise.all([a.finished, b.finished]).catch(() => {});
}

function mount(dialog) {
  document.body.append(dialog);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close(dialog);
  });
  // Un clic sur le voile, en dehors du contenu, ferme la fenêtre.
  dialog.querySelector(".scrim").addEventListener("click", () => close(dialog));
  dialog.showModal();
  lockScroll(true);
  animateIn(dialog);
  return dialog;
}

export function close(dialog, value) {
  if (!dialog || dialog.dataset.closing) return Promise.resolve();
  dialog.dataset.closing = "1";
  return animateOut(dialog).then(() => {
    dialog.close(value);
    dialog.remove();
    if (!document.querySelector("dialog[open]")) lockScroll(false);
    dialog.dispatchEvent(new CustomEvent("closed", { detail: value }));
    return value;
  });
}

// Panneau qui glisse depuis la droite (ou du bas sur téléphone).
export function openSheet(title, body, { onClose } = {}) {
  document.querySelectorAll("dialog.sheet").forEach((d) => close(d));
  const heading = h("h2", { id: `sheet-${Date.now()}` }, title);
  const dialog = h(
    "dialog",
    { class: "sheet", "aria-labelledby": heading.id },
    h("div", { class: "scrim", "aria-hidden": "true" }),
    h(
      "div",
      { class: "sheet-inner" },
      h(
        "div",
        { class: "sheet-head" },
        heading,
        h("button", { class: "icon-btn", type: "button", "aria-label": "Fermer", onclick: () => close(dialog) }, icon("i-close")),
      ),
      h("div", { class: "sheet-body" }, body),
    ),
  );
  if (onClose) dialog.addEventListener("closed", onClose);
  return mount(dialog);
}

// Petite fenêtre de confirmation. Résout avec true si l'action est confirmée.
export function confirmDialog({ title, text, confirm, cancel = "Annuler" }) {
  return new Promise((resolve) => {
    let answer = false;
    const heading = h("h2", { id: `modal-${Date.now()}` }, title);
    const dialog = h(
      "dialog",
      { class: "modal", "aria-labelledby": heading.id },
      h("div", { class: "scrim", "aria-hidden": "true" }),
      h(
        "div",
        { class: "modal-inner" },
        heading,
        text ? h("p", {}, text) : null,
        h(
          "div",
          { class: "btn-row" },
          h("button", { class: "btn", type: "button", onclick: () => { answer = true; close(dialog); } }, confirm),
          h("button", { class: "btn btn-ghost", type: "button", autofocus: true, onclick: () => close(dialog) }, cancel),
        ),
      ),
    );
    dialog.addEventListener("closed", () => resolve(answer));
    mount(dialog);
  });
}

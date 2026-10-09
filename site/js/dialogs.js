// Feuilles latérales et fenêtres, avec ouverture et fermeture animées.

import { h, icon, reducedMotion } from "./util.js";

const CLOSE_MS = 420;

function lockScroll(lock) {
  document.documentElement.style.overflow = lock ? "hidden" : "";
}

function mount(dialog) {
  document.body.append(dialog);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close(dialog);
  });
  // Un clic en dehors du contenu ferme la fenêtre.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close(dialog);
  });
  dialog.showModal();
  lockScroll(true);
  requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add("open")));
  return dialog;
}

export function close(dialog, value) {
  if (!dialog || dialog.dataset.closing) return Promise.resolve();
  dialog.dataset.closing = "1";
  dialog.classList.remove("open");
  return new Promise((resolve) => {
    setTimeout(
      () => {
        dialog.close(value);
        dialog.remove();
        if (!document.querySelector("dialog[open]")) lockScroll(false);
        dialog.dispatchEvent(new CustomEvent("closed", { detail: value }));
        resolve(value);
      },
      reducedMotion() ? 0 : CLOSE_MS,
    );
  });
}

// Panneau qui glisse depuis la droite (ou du bas sur téléphone).
export function openSheet(title, body, { onClose } = {}) {
  document.querySelectorAll("dialog.sheet").forEach((d) => close(d));
  const heading = h("h2", { id: `sheet-${Date.now()}` }, title);
  const dialog = h(
    "dialog",
    { class: "sheet", "aria-labelledby": heading.id },
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

// Réseau d'abord, cache en secours : l'appli reste à jour et s'ouvre même hors ligne.
const CACHE = "coup-de-patte-__VERSION__";
const SHELL = ["./", "index.html", "css/style.css", "js/app.js", "js/game.js", "js/views.js", "js/data.js", "js/util.js", "js/rng.js", "js/store.js", "js/dialogs.js", "js/i18n.js", "js/modes.js", "i18n/fr.json", "icons/favicon.svg", "manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))),
  );
});

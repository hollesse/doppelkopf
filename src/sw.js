// Service worker: makes the whole site available offline.
// This is a template: eleventy.config.js writes it to _site/sw.js after each build
// and fills in the file list and a version hash of all files.

const VERSION = "__VERSION__";
const FILES = __FILES__; // every published file, relative to this script
const CACHE = `doppelkopf-${VERSION}`;

// Install: download everything once.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new URL(file, self.registration.scope))))
      .then(() => self.skipWaiting()),
  );
});

// Activate: remove caches of older versions.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("doppelkopf-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;

  // Pages: network first, so updates show up right away; the cache when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request, { ignoreSearch: true })) ?? caches.match(self.registration.scope)),
    );
    return;
  }

  // Everything else (CSS, JS, fonts, icons): cache first.
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? fetch(request)));
});

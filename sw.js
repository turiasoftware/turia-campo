"use strict";
// El prefijo incluye el ámbito para convivir con otras instalaciones del mismo dominio.
const PREFIX = "turia-campo:" + self.registration.scope + ":";
const CACHE = PREFIX + "1.3.0";
const FILES = [
  "./",
  "./index.html",
  "./campo.css",
  "./campo.js",
  "./municipio.js",
  "./zonas.js",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./vendor/leaflet.js",
  "./vendor/leaflet.css",
  "./vendor/proj4.js",
  "./vendor/jszip.min.js",
];
const urls = new Set(FILES.map((f) => new URL(f, self.registration.scope).href));
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const navigation = request.mode === "navigate" && request.url.startsWith(self.registration.scope);
  if (!navigation && !urls.has(request.url)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE),
        key = navigation ? new URL("index.html", self.registration.scope).href : request;
      return (await cache.match(key)) || fetch(request);
    })(),
  );
});

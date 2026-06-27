/* Service worker: cachea la app para que abra sin conexión.
   Los datos van siempre por red (api.github.com no se cachea).
   Las fuentes e iconos de CDN (Google Fonts, Phosphor) se cachean en runtime,
   así la app funciona offline tras la primera carga online.
   IMPORTANTE: al desplegar cambios en los assets, sube el número de CACHE
   (home-v1 → home-v2…) o el dispositivo seguirá sirviendo la versión vieja. */
const CACHE = "home-v10";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/style.css",
  "./assets/secure-token.css",
  "./assets/app.js",
  "./assets/secure-token.js",
  "./assets/chart.umd.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];
// CDN de fuentes e iconos: se guardan cuando se piden (no en el install).
const RUNTIME_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.hostname === "api.github.com") return; // datos: siempre red
  const cacheable = url.origin === location.origin || RUNTIME_HOSTS.includes(url.hostname);
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && cacheable) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});

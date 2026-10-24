/* Service worker: cachea la app para que abra sin conexión.
   Los datos van por Firebase (su propia caché offline); el SW no los toca.
   Las fuentes e iconos de CDN (Google Fonts, Phosphor) se cachean en runtime,
   así la app funciona offline tras la primera carga online.
   IMPORTANTE: al desplegar cambios en los assets, sube el número de CACHE
   (home-v1 → home-v2…) o el dispositivo seguirá sirviendo la versión vieja. */
const CACHE = "home-v17";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/style.css",
  "./assets/app.js",
  "./assets/cloud.js",
  "./assets/vendor/firebase-app.js",
  "./assets/vendor/firebase-auth.js",
  "./assets/vendor/firebase-firestore.js",
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
  const cacheable = url.origin === location.origin || RUNTIME_HOSTS.includes(url.hostname);
  if (e.request.method !== "GET" || !cacheable) return; // Firebase y demás: directo a la red
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

/* ---------- Notificaciones (Web Push) ---------- */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Home", {
    body: d.body || "",
    tag: d.tag || "home",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: { url: "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    })
  );
});

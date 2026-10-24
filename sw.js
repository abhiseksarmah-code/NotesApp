// Offline support: serve the app from cache, refresh it in the background.
const CACHE = "margin-v1";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "sync.js", "firebase-config.js",
  "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const CACHEABLE_HOSTS = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  // Only the app's own files, the Firebase SDK and fonts. Never Firestore or auth traffic.
  if (!own && !(CACHEABLE_HOSTS.includes(url.hostname) && (url.hostname !== "www.gstatic.com" || url.pathname.startsWith("/firebasejs/")))) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: own });
      const fresh = fetch(req)
        .then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});

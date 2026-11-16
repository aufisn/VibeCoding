// Service worker: offline support.
//
// Bump CACHE_VERSION whenever you change any file in PRECACHE_URLS (code,
// styles, icons, questions). The new worker then installs a fresh cache and
// deletes the old one, so players get the update.
//
// - Static files: cache first (fast, works offline).
// - data/questions.json: network first, falling back to the cache when
//   offline, so corrected questions reach players on their next online load.

const CACHE_VERSION = "v5";
const CACHE_NAME = `quiz-${CACHE_VERSION}`;
const QUESTIONS_PATH = "data/questions.json";

// Paths are relative to this file, so the site works in any folder
// (e.g. GitHub Pages' /<repo>/Study-03/).
const PRECACHE_URLS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/bank-analysis.js",
  "js/config.js",
  "js/data-manager.js",
  "js/keys.js",
  "js/quiz.js",
  "js/score-manager.js",
  "js/scoring.js",
  "js/state.js",
  "js/storage.js",
  "js/theme.js",
  "js/ui.js",
  "js/validate.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  QUESTIONS_PATH,
];

const questionsUrl = new URL(QUESTIONS_PATH, self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // "reload" skips the HTTP cache so a new version never precaches stale files.
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("quiz-") && key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // app.js adds ?t=<timestamp> to defeat HTTP caches; store it under one key.
  if (url.origin + url.pathname === questionsUrl) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) await cache.put(questionsUrl, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(questionsUrl);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch (err) {
    // Offline navigation to an unknown URL: serve the app shell.
    if (request.mode === "navigate") {
      const shell = await caches.match("index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

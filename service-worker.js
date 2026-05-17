const CACHE_NAME = "secret-island-static-v3";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/rp-studio.html",
  "/backend-cockpit.html",
  "/chat-records.html",
  "/gem-chat-record-manager.html",
  "/manifest.json",
  "/shared/pwa.js",
  "/shared/error-reporter.js",
  "/shared/supabase-auth.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg"
];

const STATIC_PATHS = new Set(STATIC_ASSETS);
const SENSITIVE_PREFIXES = [
  "/api/",
  "/chat-records-live/",
  "/rp-studio-live/"
];
const SENSITIVE_PATHS = new Set([
  "/api",
  "/chat-records-live",
  "/rp-studio-live"
]);

function isSensitiveRequest(request, url) {
  if (request.method !== "GET") {
    return true;
  }

  if (request.headers.has("authorization")) {
    return true;
  }

  const path = url.pathname;
  if (SENSITIVE_PATHS.has(path)) {
    return true;
  }

  if (SENSITIVE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return true;
  }

  const lowerPath = path.toLowerCase();
  return lowerPath.includes("token") || lowerPath.includes("env");
}

function isStaticRequest(request, url) {
  if (url.origin !== self.location.origin) {
    return false;
  }

  if (STATIC_PATHS.has(url.pathname)) {
    return true;
  }

  if (url.pathname.startsWith("/icons/")) {
    return true;
  }

  return ["style", "script", "image", "font"].includes(request.destination);
}

function isPageRequest(request, url) {
  return request.mode === "navigate" ||
    request.destination === "document" ||
    url.pathname === "/" ||
    STATIC_PATHS.has(url.pathname) && url.pathname.endsWith(".html");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (isSensitiveRequest(request, url) || !isStaticRequest(request, url)) {
    return;
  }

  if (isPageRequest(request, url)) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

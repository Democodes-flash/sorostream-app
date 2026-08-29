/**
 * SoroStream Service Worker
 *
 * Strategy:
 *   - App shell (HTML, JS, CSS, icons, manifest): Cache-first with network fallback.
 *   - API / RPC calls (soroban RPC, coingecko, stellar.expert): Network-first, no cache.
 *   - Offline fallback: serve the cached fallback "/offline" or "/" when a navigation fails.
 */

const CACHE_NAME = "sorostream-v1";

const PRECACHE_URLS = [
  "/",
  "/offline",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

/** URLs that should always go to the network (never cached). */
const NETWORK_ONLY_PATTERNS = [
  /soroban.*\.stellar\.org/,
  /coingecko\.com/,
  /stellar\.expert/,
  /api\./,
];

function isNetworkOnly(url) {
  return NETWORK_ONLY_PATTERNS.some((re) => re.test(url));
}

// ── Install: pre-cache app shell ────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(PRECACHE_URLS).catch((err) => {
          console.warn("[SW] Precaching some assets failed:", err);
        })
      )
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ───────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for assets, network-first for API ────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = request.url;

  // Only handle GET requests.
  if (request.method !== "GET") return;

  // Never cache RPC/API calls.
  if (isNetworkOnly(url)) return;

  // Navigation requests: try network, fall back to cached "/offline" or "/".
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match("/offline")
          .then((res) => res || caches.match("/"))
          .then((res) => res || caches.match(request))
      )
    );
    return;
  }

  // Static assets: cache-first with network fallback.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          // Cache only successful same-origin responses.
          if (
            response.ok &&
            response.type === "basic" &&
            !isNetworkOnly(url)
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
    )
  );
});

// ── Web Push: receive push events from the browser push service (#523) ──────
self.addEventListener("push", (event) => {
  let data = {
    title: "SoroStream",
    body: "You have a new stream notification.",
    icon: "/icons/icon-192.png",
    url: "/dashboard",
    tag: "sorostream-push",
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      data.body = event.data.text() || data.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

// ── notificationclick: open or focus the relevant app URL ───────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If a window for the target URL is already open, focus it.
        for (const client of clientList) {
          const clientUrl = new URL(client.url);
          const target = new URL(targetUrl, self.location.origin);
          if (clientUrl.pathname === target.pathname && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window.
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});

// ── Message: local notification dispatch from the app ───────────────────────
// The app posts `sorostream-show-notification` messages when it wants to show
// a notification without a real push server (e.g. for stream milestones).
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "sorostream-show-notification") return;
  const { payload } = event.data;
  if (!payload || !payload.title) return;

  self.registration.showNotification(payload.title, {
    body: payload.body ?? "",
    icon: payload.icon ?? "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag ?? "sorostream-local",
    data: { url: payload.url ?? "/dashboard" },
  });
});

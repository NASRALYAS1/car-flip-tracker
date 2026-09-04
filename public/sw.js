const CACHE_NAME = "car-flip-shell-v34";
// Kept separate from the shell cache so bumping the shell version doesn't
// throw away the offline data copy, and so it can be wiped on its own when
// a partner logs out (see the "clear-api-cache" message below).
const API_CACHE = "car-flip-api-v1";
const SHELL_FILES = [
  "/",
  "/index.html",
  "/manifest.json",
  "/css/style.css",
  "/js/api.js",
  "/js/money.js",
  "/js/lock.js",
  "/js/ui.js",
  "/js/app.js",
  "/js/views/setup.js",
  "/js/views/login.js",
  "/js/views/dashboard.js",
  "/js/views/carList.js",
  "/js/views/carDetail.js",
  "/js/views/addCarForm.js",
  "/js/views/saleForm.js",
  "/js/views/tradeForm.js",
  "/js/views/installments.js",
  "/js/views/debts.js",
  "/js/views/debtDetail.js",
  "/js/views/reports.js",
  "/js/views/personalDebts.js",
  "/js/offline.js",
  "/js/views/settings.js",
  "/js/views/partners.js",
  "/js/views/expensePresets.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME && k !== API_CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// The cached API copy is per-device, and a device can be shared between
// partners (that's what the PIN lock is for). Logging out drops it so the
// next person can't read the previous one's data — their private personal
// debts especially — out of the offline copy.
self.addEventListener("message", (event) => {
  if (event.data === "clear-api-cache") {
    event.waitUntil(caches.delete(API_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api/")) {
    // Writes must never be answered from a cache, and a cached write
    // response would be meaningless anyway — let them fail loudly offline
    // so the app can say so.
    if (event.request.method !== "GET") return;

    // Network first: money data must be fresh whenever a connection exists.
    // The cache is strictly a fallback for when there's no connection at all.
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ error: "هذي المعلومات مو محفوظة للاستخدام بدون اتصال", offline: true }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        })
    );
    return;
  }

  // App shell: cache-first for instant installed-app loading.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "تنبيه", body: "" };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "تنبيه", {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      dir: "rtl",
      lang: "ar",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow("/#/installments");
    })
  );
});

const CACHE_NAME = "car-flip-shell-v16";
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls: always go to the network, never cached/queued offline.
  if (url.pathname.startsWith("/api/")) return;

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

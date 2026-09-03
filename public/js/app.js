const appState = {
  user: null,
  users: [],
  settings: {},
  expensePresets: [],
  needsSetup: false,
};

const appEl = document.getElementById("app");
const navEl = document.getElementById("bottom-nav");

function showSpinner() {
  appEl.innerHTML = '<div class="spinner">جاري التحميل...</div>';
}

function showError(err) {
  appEl.innerHTML = `<div class="error-msg">${err.message || err}</div>`;
}

function parseHash() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [route, ...rest] = hash.split("/").filter(Boolean);
  return { route: route || "dashboard", params: rest };
}

async function router() {
  const { route, params } = parseHash();

  if (appState.needsSetup && route !== "setup") {
    window.location.hash = "#/setup";
    return;
  }

  if (!appState.user && route !== "login" && route !== "setup") {
    window.location.hash = "#/login";
    return;
  }

  if (route === "setup") {
    navEl.classList.add("hidden");
    return Views.setup(appEl);
  }

  if (route === "login") {
    navEl.classList.add("hidden");
    return Views.login(appEl);
  }

  navEl.classList.remove("hidden");
  navEl.querySelectorAll("a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });

  showSpinner();
  try {
    switch (route) {
      case "dashboard":
        return await Views.dashboard(appEl);
      case "cars":
        return await Views.carList(appEl, params[0] || "in_stock");
      case "car":
        return await Views.carDetail(appEl, Number(params[0]));
      case "add-car":
        return await Views.addCarForm(appEl);
      case "sale":
        return await Views.saleForm(appEl, Number(params[0]));
      case "trade":
        return await Views.tradeForm(appEl, Number(params[0]));
      case "installments":
        return await Views.installments(appEl);
      case "debts":
        return await Views.debts(appEl);
      case "debt":
        return await Views.debtDetail(appEl, Number(params[0]));
      case "reports":
        return await Views.reports(appEl);
      case "personal-debts":
        return await Views.personalDebts(appEl);
      case "settings":
        return await Views.settings(appEl);
      case "partners":
        return await Views.partners(appEl);
      case "expense-presets":
        return await Views.expensePresets(appEl);
      default:
        window.location.hash = "#/dashboard";
    }
  } catch (err) {
    showError(err);
  }
}

async function loadShellData() {
  const [me, users, settings, expensePresets] = await Promise.all([
    api.get("/auth/me"),
    api.get("/users"),
    api.get("/settings"),
    api.get("/expense-presets"),
  ]);
  appState.user = me;
  appState.users = users;
  appState.settings = settings;
  appState.expensePresets = expensePresets;
  if (settings.last_exchange_rate) money.setLastRate(settings.last_exchange_rate);
}

async function init() {
  try {
    const { needs_setup } = await api.get("/setup/status");
    appState.needsSetup = needs_setup;
  } catch {
    appState.needsSetup = false;
  }

  if (!appState.needsSetup) {
    try {
      await loadShellData();
    } catch {
      appState.user = null;
    }
  }

  if (appState.user && AppLock.isConfigured()) {
    await AppLock.showUnlockScreen();
  }

  await router();

  if (appState.user) setupPush();
}

// Re-lock every time the app is backgrounded and reopened (switching tabs,
// closing and relaunching the installed PWA, screen lock, etc.), not just
// on first load.
let lockCheckInFlight = false;
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") {
    AppLock.unlockedThisSession = false;
    return;
  }
  if (
    document.visibilityState === "visible" &&
    appState.user &&
    AppLock.isConfigured() &&
    !AppLock.unlockedThisSession &&
    !lockCheckInFlight
  ) {
    lockCheckInFlight = true;
    await AppLock.showUnlockScreen();
    lockCheckInFlight = false;
  }
});

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", init);

if ("serviceWorker" in navigator) {
  // Without this, a newly-deployed version sits fully downloaded and ready
  // in the background, but the already-open page keeps running the old
  // cached code until it happens to reload twice — so updates silently
  // don't show up (this bit us repeatedly testing this app). Reloading
  // once, automatically, the moment the new version actually takes
  // control closes that gap for good.
  let refreshingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshingForUpdate) return;
    refreshingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      reg.update();
    } catch {
      // offline on first load, or registration failed — not fatal
    }
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function setupPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission === "denied") return;

  try {
    const { key } = await api.get("/push/vapid-public-key");
    if (!key || key.startsWith("REPLACE_")) return;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }

    await api.post("/push/subscribe", sub.toJSON());
  } catch {
    // push isn't critical to core app function; fail silently
  }
}

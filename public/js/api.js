window.Views = {};

// Every view here renders with template literals into innerHTML, so any
// value that came from a person -- a car's make, a buyer's name, a note, a
// partner's display name -- has to be escaped on the way in. Unescaped, a
// string like `<img src=x onerror=...>` stored in any field becomes script
// that runs inside another partner's logged-in session: it can read the
// whole business, read that partner's private personal debts, or change
// their password. Escape at the point of rendering, never trust the source.
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// For most routes, a 401 means the session died mid-use — bounce to login.
// But these endpoints are themselves the "prove who you are" step, where a
// 401 is an expected, on-page-recoverable outcome (wrong password/recovery
// code), not a dead session — they need their real server error message
// shown inline instead of being swallowed by a redirect.
const AUTH_ATTEMPT_PATHS = ["/auth/login", "/auth/recover"];

const api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: {},
      credentials: "same-origin",
    };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(`/api${path}`, opts);
    } catch (networkErr) {
      // A write with no connection: say so plainly instead of surfacing a
      // raw "Failed to fetch". Reads don't reach here — the service worker
      // answers those from the offline copy.
      const offlineError = new Error(
        "ما في اتصال بالإنترنت — هذي العملية تحتاج اتصال. جرّب مرة ثانية لمن يرجع الاتصال."
      );
      offlineError.isOffline = true;
      throw offlineError;
    }

    if (res.status === 401 && !AUTH_ATTEMPT_PATHS.includes(path)) {
      window.location.hash = "#/login";
      throw new Error("غير مصرح");
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const message = (data && data.error) || "حدث خطأ غير متوقع";
      const err = new Error(message);
      // Carried so the sync queue can tell a server rejection (4xx — retrying
      // forever won't help) apart from a connection problem (retry later).
      err.status = res.status;
      err.isOffline = res.status === 503 && !!(data && data.offline);
      throw err;
    }
    return data;
  },

  get(path) {
    return this.request("GET", path);
  },
  post(path, body) {
    return this.request("POST", path, body);
  },
  patch(path, body) {
    return this.request("PATCH", path, body);
  },
  del(path) {
    return this.request("DELETE", path);
  },
};

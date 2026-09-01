window.Views = {};

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

    const res = await fetch(`/api${path}`, opts);
    if (res.status === 401) {
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
      throw new Error(message);
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

// App-level device lock: a local PIN (and optionally device fingerprint/
// face unlock via WebAuthn) required to view the app after it's been
// backgrounded or reopened. This is separate from the account
// username/password — it's a per-device convenience lock, stored only in
// this browser's localStorage, never sent to the server.
const AppLock = {
  PIN_HASH_KEY: "lock_pin_hash",
  PIN_SALT_KEY: "lock_pin_salt",
  WEBAUTHN_ID_KEY: "lock_webauthn_id",

  unlockedThisSession: false,

  isConfigured() {
    return !!localStorage.getItem(this.PIN_HASH_KEY);
  },

  async hashPin(pin, salt) {
    const data = new TextEncoder().encode(`${salt}:${pin}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  },

  async setPin(pin) {
    const salt = crypto.randomUUID();
    const hash = await this.hashPin(pin, salt);
    localStorage.setItem(this.PIN_SALT_KEY, salt);
    localStorage.setItem(this.PIN_HASH_KEY, hash);
  },

  async verifyPin(pin) {
    const salt = localStorage.getItem(this.PIN_SALT_KEY);
    const stored = localStorage.getItem(this.PIN_HASH_KEY);
    if (!salt || !stored) return false;
    return (await this.hashPin(pin, salt)) === stored;
  },

  disable() {
    localStorage.removeItem(this.PIN_HASH_KEY);
    localStorage.removeItem(this.PIN_SALT_KEY);
    localStorage.removeItem(this.WEBAUTHN_ID_KEY);
  },

  webauthnAvailable() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  },

  hasFingerprint() {
    return !!localStorage.getItem(this.WEBAUTHN_ID_KEY);
  },

  async registerFingerprint() {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "تجارة السيارات" },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: "device-lock",
          displayName: "قفل الجهاز",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000,
      },
    });
    if (!cred) throw new Error("فشل تفعيل البصمة");
    const id = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    localStorage.setItem(this.WEBAUTHN_ID_KEY, id);
  },

  disableFingerprint() {
    localStorage.removeItem(this.WEBAUTHN_ID_KEY);
  },

  async verifyFingerprint() {
    const idB64 = localStorage.getItem(this.WEBAUTHN_ID_KEY);
    if (!idB64) return false;
    const rawId = Uint8Array.from(atob(idB64), (c) => c.charCodeAt(0));
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ id: rawId, type: "public-key" }],
          userVerification: "required",
          timeout: 60000,
        },
      });
      return !!assertion;
    } catch {
      return false;
    }
  },

  // Renders the full-screen unlock overlay and resolves once the user gets
  // in (PIN or fingerprint). Blocks the rest of the app until then.
  showUnlockScreen() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.id = "lock-overlay";
      const hasFingerprint = this.hasFingerprint();
      overlay.innerHTML = `
        <div class="lock-card">
          <div class="lock-logo">🚗</div>
          <div class="lock-title">🔒 التطبيق مقفل</div>
          <div class="lock-dots" id="lock-dots"></div>
          <div id="lock-error" class="lock-error"></div>
          <div class="lock-keypad" id="lock-keypad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-digit="${n}">${n}</button>`).join("")}
            ${hasFingerprint ? `<button type="button" id="lock-fingerprint-btn">👆</button>` : "<span></span>"}
            <button type="button" data-digit="0">0</button>
            <button type="button" id="lock-backspace-btn">⌫</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      let entered = "";
      const dotsEl = overlay.querySelector("#lock-dots");
      const errorEl = overlay.querySelector("#lock-error");

      const renderDots = () => {
        dotsEl.innerHTML = Array.from({ length: Math.max(4, entered.length) })
          .map((_, i) => `<span class="dot ${i < entered.length ? "filled" : ""}"></span>`)
          .join("");
      };
      renderDots();

      const finish = () => {
        this.unlockedThisSession = true;
        overlay.remove();
        resolve();
      };

      const tryVerify = async () => {
        if (entered.length < 4) return;
        const ok = await this.verifyPin(entered);
        if (ok) {
          finish();
          return;
        }
        if (entered.length >= 6) {
          errorEl.textContent = "الرمز غير صحيح";
          overlay.querySelector(".lock-card").classList.add("shake");
          setTimeout(() => overlay.querySelector(".lock-card")?.classList.remove("shake"), 400);
          entered = "";
          renderDots();
        }
      };

      overlay.querySelectorAll("[data-digit]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (entered.length >= 6) return;
          entered += btn.dataset.digit;
          errorEl.textContent = "";
          renderDots();
          tryVerify();
        });
      });
      overlay.querySelector("#lock-backspace-btn").addEventListener("click", () => {
        entered = entered.slice(0, -1);
        renderDots();
      });

      const fpBtn = overlay.querySelector("#lock-fingerprint-btn");
      const tryFingerprint = async () => {
        const ok = await this.verifyFingerprint();
        if (ok) finish();
      };
      if (fpBtn) {
        fpBtn.addEventListener("click", tryFingerprint);
        tryFingerprint();
      }
    });
  },
};

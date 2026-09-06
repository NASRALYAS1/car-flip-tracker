const LOCK_ICONS = {
  padlock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="10.2" width="16" height="10.8" rx="2.6" />
      <path d="M8.1 10.2V7.3a3.9 3.9 0 0 1 7.8 0v2.9" />
      <path d="M12 14.4v2.6" />
    </svg>`,
  fingerprint: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5.6 12a6.4 6.4 0 0 1 12.8 0v1.4" />
      <path d="M8.8 12a3.2 3.2 0 0 1 6.4 0v3.6" />
      <path d="M12 12v5.4" />
      <path d="M15.1 18.6a10 10 0 0 1-.4 2.2" />
      <path d="M6.2 16.6c.3-.9.5-1.8.5-2.8" />
      <path d="M9.4 20a9.4 9.4 0 0 0 .6-3.2" />
    </svg>`,
  backspace: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 4.8H9.3L3.4 12l5.9 7.2H20a1.6 1.6 0 0 0 1.6-1.6V6.4A1.6 1.6 0 0 0 20 4.8Z" />
      <path d="M16.4 9.4 11.9 14M11.9 9.4l4.5 4.6" />
    </svg>`,
};

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
        rp: { name: "تطبيق الشركاء" },
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
      // The shell's data is already loaded by the time this screen appears,
      // so the lock can show whose business it is guarding rather than a
      // generic label — it's the first thing seen on every reopen, and it's
      // the one screen with room to say the app belongs to this dealership.
      const businessName =
        (typeof appState !== "undefined" && appState.settings && appState.settings.business_name) ||
        "التطبيق مقفل";
      overlay.innerHTML = `
        <div class="lock-card">
          <div class="lock-mark">${LOCK_ICONS.padlock}</div>
          <div class="lock-title">${esc(businessName)}</div>
          <div class="lock-sub">أدخل رمز القفل</div>
          <div class="lock-dots" id="lock-dots"></div>
          <div id="lock-error" class="lock-error"></div>
          <div class="lock-keypad" id="lock-keypad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-digit="${n}">${n}</button>`).join("")}
            ${hasFingerprint ? `<button type="button" id="lock-fingerprint-btn" aria-label="فتح بالبصمة">${LOCK_ICONS.fingerprint}</button>` : "<span></span>"}
            <button type="button" data-digit="0">0</button>
            <button type="button" id="lock-backspace-btn" aria-label="مسح">${LOCK_ICONS.backspace}</button>
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

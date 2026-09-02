Views.settings = async function (container) {
  const s = appState.settings;

  container.innerHTML = `
    <div class="topbar"><h1>⚙️ الإعدادات</h1></div>
    <div id="settings-msg"></div>

    <form id="settings-form">
      <div class="field"><label>اسم التجارة / المعرض</label><input name="business_name" value="${s.business_name || ""}" /></div>
      <div class="field"><label>سعر الصرف الحالي (دينار لكل دولار)</label><input type="number" name="last_exchange_rate" value="${s.last_exchange_rate || ""}" /></div>
      <button type="submit" class="btn">حفظ الإعدادات</button>
    </form>

    <a href="#/partners" class="btn secondary" style="margin-top:16px">👥 إدارة الشركاء</a>
    <a href="#/expense-presets" class="btn secondary" style="margin-top:10px">🧾 قوالب المصاريف الجاهزة</a>
    <p style="color:var(--text-dim);font-size:0.8rem;margin:10px 2px 0">
      💾 يتم أخذ نسخة احتياطية تلقائياً كل ليلة، بدون أي إجراء منك.
    </p>

    <h2>🔒 قفل التطبيق</h2>
    <div id="lock-section"></div>
    <div id="lock-msg"></div>

    <button class="btn danger" id="logout-btn" style="margin-top:16px">تسجيل خروج</button>
  `;

  container.querySelector("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api.patch("/settings", payload);
      appState.settings = { ...appState.settings, ...payload };
      money.setLastRate(payload.last_exchange_rate);
      container.querySelector("#settings-msg").innerHTML =
        '<div class="card" style="color:var(--green)">تم الحفظ</div>';
    } catch (err) {
      container.querySelector("#settings-msg").innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });

  container.querySelector("#logout-btn").addEventListener("click", async () => {
    await api.post("/auth/logout");
    appState.user = null;
    window.location.hash = "#/login";
    router();
  });

  renderLockSection(container);
};

function renderLockSection(container) {
  const section = container.querySelector("#lock-section");
  const configured = AppLock.isConfigured();
  const showFingerprintOption = configured && AppLock.webauthnAvailable();
  const hasFingerprint = AppLock.hasFingerprint();

  section.innerHTML = configured
    ? `
      <div class="card">
        <div class="card-row"><span class="label">رمز القفل (PIN)</span><span class="value" style="color:var(--green)">مفعّل ✅</span></div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn secondary" id="change-pin-btn">تغيير الرمز</button>
          <button class="btn danger" id="disable-lock-btn">إلغاء القفل</button>
        </div>
        ${
          showFingerprintOption
            ? `
          <div class="card-row" style="margin-top:14px;border-top:1px solid var(--border-soft);padding-top:14px">
            <span class="label">الفتح بالبصمة</span>
            <span class="value" style="color:${hasFingerprint ? "var(--green)" : "var(--text-dim)"}">${hasFingerprint ? "مفعّلة ✅" : "غير مفعّلة"}</span>
          </div>
          <button class="btn secondary" id="fingerprint-btn" style="margin-top:10px">
            ${hasFingerprint ? "إلغاء الفتح بالبصمة" : "👆 تفعيل الفتح بالبصمة"}
          </button>`
            : ""
        }
      </div>`
    : `
      <div class="card">
        <p style="margin:0 0 12px;color:var(--text-dim)">
          يطلب رمز PIN كل مرة تفتح فيها التطبيق (حتى لو كنت مسجل دخول أصلاً) — مفيد لو الجهاز مشترك أو بايدي أكثر من شخص.
        </p>
        <button class="btn secondary" id="enable-lock-btn">🔒 تفعيل قفل بالرمز</button>
      </div>`;

  let pinSetupHost = container.querySelector("#pin-setup-wrap");
  if (!pinSetupHost) {
    pinSetupHost = document.createElement("div");
    pinSetupHost.id = "pin-setup-wrap";
    section.after(pinSetupHost);
  } else {
    pinSetupHost.innerHTML = "";
  }

  function refresh() {
    renderLockSection(container);
  }

  const enableBtn = section.querySelector("#enable-lock-btn");
  if (enableBtn) {
    enableBtn.addEventListener("click", () => {
      startPinSetupFlow(pinSetupHost, async (pin) => {
        await AppLock.setPin(pin);
        pinSetupHost.innerHTML = "";
        refresh();
      });
    });
  }

  const changeBtn = section.querySelector("#change-pin-btn");
  if (changeBtn) {
    changeBtn.addEventListener("click", () => {
      startPinSetupFlow(pinSetupHost, async (pin) => {
        await AppLock.setPin(pin);
        pinSetupHost.innerHTML = "";
        container.querySelector("#lock-msg").innerHTML =
          '<div class="card" style="color:var(--green)">تم تغيير الرمز</div>';
      });
    });
  }

  const disableBtn = section.querySelector("#disable-lock-btn");
  if (disableBtn) {
    disableBtn.addEventListener("click", async () => {
      if (!(await UI.confirm("إلغاء قفل التطبيق؟", { danger: true }))) return;
      AppLock.disable();
      refresh();
    });
  }

  const fpBtn = section.querySelector("#fingerprint-btn");
  if (fpBtn) {
    fpBtn.addEventListener("click", async () => {
      const msg = container.querySelector("#lock-msg");
      if (AppLock.hasFingerprint()) {
        AppLock.disableFingerprint();
        refresh();
        return;
      }
      try {
        await AppLock.registerFingerprint();
        refresh();
      } catch (err) {
        msg.innerHTML = `<div class="error-msg">تعذّر تفعيل البصمة: ${err.message}</div>`;
      }
    });
  }
}

// Two-step "enter new PIN, then confirm it" flow using the same tappable
// numeric keypad style as the unlock screen, rendered inline (not as a
// full overlay) so it fits naturally in the settings page.
function startPinSetupFlow(host, onConfirmed) {
  let stage = "enter"; // "enter" -> "confirm"
  let firstPin = "";
  let entered = "";

  function render() {
    const title = stage === "enter" ? "أدخل رمز جديد (4 إلى 6 أرقام)" : "أعد إدخال نفس الرمز للتأكيد";
    host.innerHTML = `
      <div class="card">
        <p style="margin:0 0 8px;font-weight:700">${title}</p>
        <div class="pin-setup-pad" id="pin-dots"></div>
        <div id="pin-setup-error" class="lock-error"></div>
        <div class="lock-keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-d="${n}">${n}</button>`).join("")}
          <button type="button" id="pin-cancel-btn" style="border-radius:var(--radius-sm);font-size:0.8rem">إلغاء</button>
          <button type="button" data-d="0">0</button>
          <button type="button" id="pin-back-btn">⌫</button>
        </div>
        <button type="button" class="btn" id="pin-confirm-btn" style="margin-top:14px" disabled>متابعة</button>
      </div>
    `;
    renderDots();

    host.querySelectorAll("[data-d]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (entered.length >= 6) return;
        entered += btn.dataset.d;
        host.querySelector("#pin-setup-error").textContent = "";
        renderDots();
      });
    });
    host.querySelector("#pin-back-btn").addEventListener("click", () => {
      entered = entered.slice(0, -1);
      renderDots();
    });
    host.querySelector("#pin-cancel-btn").addEventListener("click", () => {
      host.innerHTML = "";
    });
    host.querySelector("#pin-confirm-btn").addEventListener("click", () => advance());
  }

  function renderDots() {
    const dotsEl = host.querySelector("#pin-dots");
    dotsEl.innerHTML = Array.from({ length: Math.max(4, entered.length) })
      .map((_, i) => `<span class="dot ${i < entered.length ? "filled" : ""}"></span>`)
      .join("");
    host.querySelector("#pin-confirm-btn").disabled = entered.length < 4;
  }

  async function advance() {
    if (entered.length < 4) return;
    if (stage === "enter") {
      firstPin = entered;
      entered = "";
      stage = "confirm";
      render();
    } else {
      if (entered === firstPin) {
        await onConfirmed(entered);
      } else {
        host.querySelector("#pin-setup-error").textContent = "الرمزين غير متطابقين، حاول من جديد";
        stage = "enter";
        firstPin = "";
        entered = "";
        render();
      }
    }
  }

  host.classList.remove("hidden");
  render();
}

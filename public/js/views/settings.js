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

    <h2>🔑 رمز الاسترجاع</h2>
    <div class="card">
      <p style="margin:0 0 12px;color:var(--text-dim)">
        رمز الاسترجاع يخليك ترجع لحسابك إذا نسيت كلمة المرور، بدون ما تحتاج شريك ثاني يفتحلك.
        إذا ضيّعت رمزك القديم أو تشك إنه صار معروف لأحد، ولّد رمز جديد — الرمز القديم يوقف عن الشغل فوراً.
      </p>
      <button class="btn secondary" id="regen-recovery-btn">🔑 توليد رمز استرجاع جديد</button>
    </div>

    <button class="btn danger" id="logout-btn" style="margin-top:16px">تسجيل خروج</button>

    <p id="toggle-advanced" style="color:var(--text-faint);font-size:0.78rem;margin-top:28px;text-align:center;cursor:pointer">
      ⚙️ خيارات متقدمة
    </p>
    <div id="advanced-section" class="hidden"></div>
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

  container.querySelector("#regen-recovery-btn").addEventListener("click", async () => {
    if (
      !(await UI.confirm("توليد رمز استرجاع جديد؟ أي رمز قديم عندك ما راح يشتغل بعدها.", { okText: "توليد" }))
    )
      return;
    const result = await api.post("/users/recovery-code/regenerate");
    await UI.showRecoveryCode(result.recovery_code);
  });

  container.querySelector("#logout-btn").addEventListener("click", async () => {
    await api.post("/auth/logout");
    appState.user = null;
    window.location.hash = "#/login";
    router();
  });

  renderLockSection(container);

  container.querySelector("#toggle-advanced").addEventListener("click", () => {
    const section = container.querySelector("#advanced-section");
    section.classList.toggle("hidden");
    if (!section.classList.contains("hidden") && !section.dataset.loaded) {
      section.dataset.loaded = "1";
      renderAdvancedSection(section);
    }
  });
};

// Deliberately tucked away and collapsed by default — this is a
// break-glass, once-in-the-app's-lifetime screen (restore from backup),
// not something anyone should stumble into during routine use.
async function renderAdvancedSection(section) {
  section.innerHTML = '<p style="color:var(--text-dim);font-size:0.85rem">جاري التحميل...</p>';
  let backups;
  try {
    backups = await api.get("/admin/backups");
  } catch (err) {
    section.innerHTML = `<div class="error-msg">${err.message}</div>`;
    return;
  }

  const rows = backups.length
    ? backups
        .map((b, i) => {
          const d = new Date(b.uploaded_at);
          const label = d.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
          const time = d.toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" });
          return `
        <div class="card-row" data-backup-key="${b.key}">
          <span class="label">${label} ${i === 0 ? "(الأحدث)" : ""}</span>
          <span class="value" style="color:var(--text-dim);font-size:0.8rem">${time}</span>
        </div>`;
        })
        .join("")
    : '<p style="color:var(--text-dim)">ما فيه نسخ احتياطية بعد</p>';

  section.innerHTML = `
    <div class="card" style="border-color:var(--red-soft)">
      <p style="margin:0 0 12px;color:var(--text-dim);font-size:0.85rem">
        هذا القسم فقط لو صار خلل حقيقي وتحتاج ترجع البيانات لتاريخ سابق. الاستعادة تمسح كل شي انسجل بعد
        التاريخ اللي تختاره (سيارات، مبيعات، مصاريف، دفعات، ديون) وترجعه لهذي النسخة. حسابات الشركاء
        وكلمات المرور ورموز الاسترجاع ما تتأثر أبداً.
      </p>
      <div id="backup-list">${rows}</div>
    </div>
    <div id="restore-confirm-wrap"></div>
  `;

  section.querySelectorAll("[data-backup-key]").forEach((row) => {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      renderRestoreConfirm(section, row.dataset.backupKey, row.querySelector(".label").textContent.trim());
    });
  });
}

function renderRestoreConfirm(section, key, label) {
  const wrap = section.querySelector("#restore-confirm-wrap");
  wrap.innerHTML = `
    <div class="card" style="border-color:var(--red)">
      <p style="margin:0 0 10px;font-weight:700">استعادة نسخة: ${label}</p>
      <p style="margin:0 0 12px;color:var(--text-dim);font-size:0.85rem">
        اكتب كلمة "استعادة" بالمربع تحت للتأكيد — هذا الإجراء ما ينرجع.
      </p>
      <input type="text" id="restore-confirm-input" placeholder="استعادة" style="margin-bottom:12px" />
      <div id="restore-msg"></div>
      <button class="btn danger" id="restore-confirm-btn" disabled>تأكيد الاستعادة</button>
    </div>
  `;

  const input = wrap.querySelector("#restore-confirm-input");
  const btn = wrap.querySelector("#restore-confirm-btn");
  input.addEventListener("input", () => {
    btn.disabled = input.value.trim() !== "استعادة";
  });

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "جاري الاستعادة...";
    try {
      await api.post("/admin/restore", { key });
      wrap.innerHTML = `
        <div class="card" style="color:var(--green)">
          تمت الاستعادة بنجاح. أعد فتح التطبيق الآن لترى البيانات المستعادة.
        </div>`;
    } catch (err) {
      wrap.querySelector("#restore-msg").innerHTML = `<div class="error-msg">${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = "تأكيد الاستعادة";
    }
  });
}

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

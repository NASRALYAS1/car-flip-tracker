// Custom-styled confirm/alert dialogs, replacing the native browser
// confirm()/alert() — those show the raw domain name and can't be styled,
// which looks jarring and out of place in an installed app. Both return
// a Promise so call sites just do `if (!(await UI.confirm(...))) return;`.
const UI = {
  confirm(message, { okText = "تأكيد", cancelText = "إلغاء", danger = false } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "ui-modal-overlay";
      overlay.innerHTML = `
        <div class="ui-modal-card">
          <p class="ui-modal-msg">${message}</p>
          <div class="btn-row">
            <button type="button" class="btn secondary" id="ui-modal-cancel">${cancelText}</button>
            <button type="button" class="btn ${danger ? "danger" : ""}" id="ui-modal-ok">${okText}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };
      overlay.querySelector("#ui-modal-ok").addEventListener("click", () => cleanup(true));
      overlay.querySelector("#ui-modal-cancel").addEventListener("click", () => cleanup(false));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) cleanup(false);
      });
    });
  },

  // Shown once when a recovery code is (re)generated — deliberately has no
  // click-outside-to-dismiss and no auto-resolve, only the explicit
  // "saved it" button, since this is the only moment the app can ever show
  // this code (it's stored as a one-way hash, same as a password).
  showRecoveryCode(code, { title = "🔑 رمز الاسترجاع" } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "ui-modal-overlay";
      overlay.innerHTML = `
        <div class="ui-modal-card">
          <p class="ui-modal-msg" style="font-weight:800">${title}</p>
          <p style="color:var(--text-dim);font-size:0.85rem;margin:-6px 0 12px">
            احتفظ بهذا الرمز بمكان آمن (اكتبه أو صوّره) — تحتاجه إذا نسيت كلمة المرور يوماً.
            ما راح يظهر لك مرة ثانية بعد ما تسكر هذي الشاشة.
          </p>
          <div style="font-family:monospace;font-size:1.3rem;font-weight:800;letter-spacing:1px;
                      text-align:center;background:var(--surface-2);border:1px solid var(--border-soft);
                      border-radius:var(--radius-sm);padding:14px;margin-bottom:14px;direction:ltr">${code}</div>
          <div class="btn-row">
            <button type="button" class="btn secondary" id="ui-copy-code">📋 نسخ الرمز</button>
          </div>
          <button type="button" class="btn" id="ui-modal-ok" style="margin-top:10px">تم، حفظت الرمز</button>
        </div>`;
      document.body.appendChild(overlay);

      overlay.querySelector("#ui-copy-code").addEventListener("click", async () => {
        const btn = overlay.querySelector("#ui-copy-code");
        try {
          await navigator.clipboard.writeText(code);
          btn.textContent = "✅ تم النسخ";
        } catch {
          btn.textContent = "تعذّر النسخ — انسخه يدوياً";
        }
        setTimeout(() => (btn.textContent = "📋 نسخ الرمز"), 1800);
      });
      overlay.querySelector("#ui-modal-ok").addEventListener("click", () => {
        overlay.remove();
        resolve();
      });
    });
  },

  alert(message, { okText = "حسناً" } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "ui-modal-overlay";
      overlay.innerHTML = `
        <div class="ui-modal-card">
          <p class="ui-modal-msg">${message}</p>
          <button type="button" class="btn" id="ui-modal-ok" style="margin-top:4px">${okText}</button>
        </div>`;
      document.body.appendChild(overlay);

      const cleanup = () => {
        overlay.remove();
        resolve();
      };
      overlay.querySelector("#ui-modal-ok").addEventListener("click", cleanup);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) cleanup();
      });
    });
  },
};

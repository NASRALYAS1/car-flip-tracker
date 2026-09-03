Views.login = async function (container) {
  renderLoginForm(container);
};

function renderLoginForm(container, { prefillUsername = "", message = "" } = {}) {
  container.innerHTML = `
    <div class="login-screen">
      <div class="logo">🚗</div>
      <h1>تجارة السيارات</h1>
      ${message ? `<div class="card" style="color:var(--green);text-align:center">${message}</div>` : ""}
      <div id="login-error"></div>
      <form id="login-form">
        <div class="field">
          <label>اسم المستخدم</label>
          <input type="text" name="username" required autocomplete="username" value="${prefillUsername}" />
        </div>
        <div class="field">
          <label>كلمة المرور</label>
          <input type="password" name="password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn">تسجيل الدخول</button>
      </form>
      <a href="#" id="forgot-password-link" style="display:block;text-align:center;margin-top:16px;color:var(--text-dim);font-size:0.85rem">
        نسيت كلمة المرور؟
      </a>
    </div>`;

  const form = container.querySelector("#login-form");
  const errorEl = container.querySelector("#login-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.innerHTML = "";
    const fd = new FormData(form);
    try {
      await api.post("/auth/login", {
        username: fd.get("username"),
        password: fd.get("password"),
      });
      await loadShellData();
      window.location.hash = "#/dashboard";
      await router();
      setupPush();
    } catch (err) {
      errorEl.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#forgot-password-link").addEventListener("click", (e) => {
    e.preventDefault();
    renderRecoveryForm(container);
  });
}

function renderRecoveryForm(container) {
  container.innerHTML = `
    <div class="login-screen">
      <div class="logo">🔑</div>
      <h1>استرجاع الدخول</h1>
      <p style="color:var(--text-dim);text-align:center;margin-top:-8px">
        أدخل اسم المستخدم ورمز الاسترجاع اللي انحفظ لك وقت إنشاء الحساب، وحدد كلمة مرور جديدة.
      </p>
      <div id="recovery-error"></div>
      <form id="recovery-form">
        <div class="field">
          <label>اسم المستخدم</label>
          <input type="text" name="username" required autocomplete="username" />
        </div>
        <div class="field">
          <label>رمز الاسترجاع</label>
          <input type="text" name="recovery_code" required placeholder="مثلاً XJ4K-9QRT-2FHM" style="direction:ltr;text-align:center" />
        </div>
        <div class="field">
          <label>كلمة المرور الجديدة</label>
          <input type="password" name="new_password" required minlength="6" autocomplete="new-password" />
        </div>
        <button type="submit" class="btn">استرجاع الدخول</button>
      </form>
      <a href="#" id="back-to-login-link" style="display:block;text-align:center;margin-top:16px;color:var(--text-dim);font-size:0.85rem">
        ← رجوع لتسجيل الدخول
      </a>
    </div>`;

  const form = container.querySelector("#recovery-form");
  const errorEl = container.querySelector("#recovery-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.innerHTML = "";
    const fd = new FormData(form);
    const username = fd.get("username");
    try {
      const result = await api.post("/auth/recover", {
        username,
        recovery_code: fd.get("recovery_code"),
        new_password: fd.get("new_password"),
      });
      if (result.new_recovery_code) await UI.showRecoveryCode(result.new_recovery_code);
      renderLoginForm(container, { prefillUsername: username, message: "تم تغيير كلمة المرور — سجّل دخولك الآن" });
    } catch (err) {
      errorEl.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  });

  container.querySelector("#back-to-login-link").addEventListener("click", (e) => {
    e.preventDefault();
    renderLoginForm(container);
  });
}

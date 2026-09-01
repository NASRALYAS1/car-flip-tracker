Views.login = async function (container) {
  container.innerHTML = `
    <div class="login-screen">
      <div class="logo">🚗</div>
      <h1>تجارة السيارات</h1>
      <div id="login-error"></div>
      <form id="login-form">
        <div class="field">
          <label>اسم المستخدم</label>
          <input type="text" name="username" required autocomplete="username" />
        </div>
        <div class="field">
          <label>كلمة المرور</label>
          <input type="password" name="password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn">تسجيل الدخول</button>
      </form>
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
      errorEl.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });
};

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
    <button class="btn secondary" id="backup-btn" style="margin-top:10px">نسخة احتياطية الآن</button>
    <button class="btn danger" id="logout-btn" style="margin-top:10px">تسجيل خروج</button>
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

  container.querySelector("#backup-btn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "جاري النسخ...";
    try {
      await api.post("/admin/backup-now");
      e.target.textContent = "تم إنشاء نسخة احتياطية ✓";
    } catch (err) {
      e.target.textContent = "فشل: " + err.message;
    }
    e.target.disabled = false;
  });

  container.querySelector("#logout-btn").addEventListener("click", async () => {
    await api.post("/auth/logout");
    appState.user = null;
    window.location.hash = "#/login";
    router();
  });
};

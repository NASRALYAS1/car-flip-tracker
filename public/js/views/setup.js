Views.setup = async function (container) {
  container.innerHTML = `
    <div class="login-screen">
      <div class="logo">🚗</div>
      <h1>إعداد التطبيق لأول مرة</h1>
      <p style="color:var(--text-dim);text-align:center;margin-top:-8px">
        هذا الإعداد يظهر مرة وحدة فقط. أنشئ حساب أول شريك بالتجارة، وبعدها
        تكدر تضيف باقي الشركاء من داخل الإعدادات.
      </p>
      <div id="setup-error"></div>
      <form id="setup-form">
        <div class="field"><label>اسم التجارة / المعرض</label><input name="business_name" placeholder="مثلاً: معرض الأمانة" /></div>
        <div class="field"><label>اسمك (الشريك الأول)</label><input name="display_name" required /></div>
        <div class="field"><label>اسم المستخدم لتسجيل الدخول</label><input name="username" required autocomplete="username" /></div>
        <div class="field"><label>كلمة المرور</label><input type="password" name="password" required autocomplete="new-password" minlength="6" /></div>
        <button type="submit" class="btn">إنشاء الحساب والبدء</button>
      </form>

      <div class="card" style="margin-top:20px">
        <p style="margin:0 0 8px;font-weight:700">عندك تجارة شغالة من قبل؟</p>
        <p style="margin:0;color:var(--text-dim);font-size:0.85rem;line-height:1.7">
          ما تحتاج تبدي من الصفر — التطبيق يقبل تواريخ قديمة بكل مكان:<br />
          • السيارات اللي بالمخزون: ضيفها بتاريخ وسعر الشراء الحقيقي.<br />
          • الديون بينك وبين شركائك: سجّلها بصفحة الديون بتاريخها الأصلي.<br />
          • الأقساط اللي جارية: سجّل البيع بتاريخه، وبخانة
          "المبلغ المدفوع سابقاً" اكتب مجموع اللي استلمته لحد الآن بمبلغ واحد.
        </p>
      </div>
    </div>`;

  const form = container.querySelector("#setup-form");
  const errorEl = container.querySelector("#setup-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.innerHTML = "";
    const fd = new FormData(form);
    try {
      const result = await api.post("/setup/init", {
        business_name: fd.get("business_name") || null,
        display_name: fd.get("display_name"),
        username: fd.get("username"),
        password: fd.get("password"),
      });
      appState.needsSetup = false;
      await loadShellData();
      if (result.recovery_code) await UI.showRecoveryCode(result.recovery_code);
      window.location.hash = "#/dashboard";
      await router();
      setupPush();
    } catch (err) {
      errorEl.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  });
};

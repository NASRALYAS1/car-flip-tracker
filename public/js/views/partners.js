Views.partners = async function (container) {
  const users = await api.get("/users");
  renderPartners(container, users);
};

function renderPartners(container, users) {
  const active = users.filter((u) => u.is_active);
  const inactive = users.filter((u) => !u.is_active);
  const totalPct = active.reduce((s, u) => s + Number(u.profit_split_pct), 0);

  const activeRows = active
    .map(
      (u) => `
    <div class="card-row" data-user-id="${u.id}">
      <span class="label">${esc(u.display_name)} <span style="opacity:.6">(${esc(u.username)})</span></span>
      <span class="value">
        ${Number(u.profit_split_pct).toFixed(1)}%
        <a href="#" data-edit-user="${u.id}" style="margin-inline-start:8px">تعديل</a>
        <a href="#" data-deactivate-user="${u.id}" style="color:var(--red);margin-inline-start:8px">تعطيل</a>
      </span>
    </div>`
    )
    .join("");

  const inactiveHtml = inactive.length
    ? `
    <h2>شركاء معطّلون</h2>
    <div class="card">
      ${inactive
        .map(
          (u) => `
        <div class="card-row" data-user-id="${u.id}">
          <span class="label">${esc(u.display_name)} <span style="opacity:.6">(${esc(u.username)})</span></span>
          <span class="value"><a href="#" data-reactivate-user="${u.id}">تفعيل</a></span>
        </div>`
        )
        .join("")}
    </div>`
    : "";

  container.innerHTML = `
    <div class="topbar">
      <span class="back" data-back>→</span>
      <h1>👥 الشركاء</h1>
    </div>

    <div class="card">
      ${activeRows || '<p style="color:var(--text-dim)">لا يوجد شركاء فعّالون</p>'}
      <div class="card-row" style="border-top:1px solid var(--border);margin-top:8px;padding-top:10px">
        <span class="label">مجموع النسب</span>
        <span class="value" style="color:${Math.abs(totalPct - 100) < 0.5 ? "var(--green)" : "var(--amber)"}">${totalPct.toFixed(1)}%</span>
      </div>
    </div>

    <button class="btn secondary" id="toggle-split-form" style="margin-bottom:16px">✏️ تعديل توزيع الأرباح</button>
    <div id="split-form-wrap" class="hidden card">
      <form id="split-form">
        ${active
          .map(
            (u) => `
          <div class="field"><label>${esc(u.display_name)}</label>
            <input type="number" step="0.1" min="0" max="100" name="split_${u.id}" value="${Number(u.profit_split_pct).toFixed(1)}" required />
          </div>`
          )
          .join("")}
        <div id="split-live-total" style="color:var(--text-dim);margin-bottom:10px"></div>
        <button type="submit" class="btn">حفظ التوزيع</button>
      </form>
    </div>

    <button class="btn secondary" id="toggle-add-partner" style="margin-bottom:16px">+ إضافة شريك جديد</button>
    <div id="add-partner-wrap" class="hidden card">
      <form id="add-partner-form">
        <div class="field"><label>الاسم</label><input name="display_name" required /></div>
        <div class="field"><label>اسم المستخدم</label><input name="username" required autocomplete="off" /></div>
        <div class="field"><label>كلمة المرور</label><input type="password" name="password" required minlength="6" autocomplete="new-password" /></div>
        <button type="submit" class="btn">إضافة الشريك</button>
      </form>
      <p style="color:var(--text-dim);font-size:0.85rem;margin-top:8px">
        الشريك الجديد يبدأ بنسبة 0% من الربح — عدّل التوزيع أعلاه بعد إضافته.
      </p>
    </div>

    ${inactiveHtml}
    <div id="partners-msg"></div>
  `;

  container.querySelector("[data-back]").addEventListener("click", () => (window.location.hash = "#/settings"));

  async function refresh() {
    const fresh = await api.get("/users");
    appState.users = fresh;
    renderPartners(container, fresh);
  }

  container.querySelector("#toggle-split-form").addEventListener("click", () => {
    container.querySelector("#split-form-wrap").classList.toggle("hidden");
  });
  container.querySelector("#toggle-add-partner").addEventListener("click", () => {
    container.querySelector("#add-partner-wrap").classList.toggle("hidden");
  });

  const splitForm = container.querySelector("#split-form");
  if (splitForm) {
    const liveTotal = container.querySelector("#split-live-total");
    const updateLiveTotal = () => {
      const fd = new FormData(splitForm);
      let sum = 0;
      for (const u of active) sum += parseFloat(fd.get(`split_${u.id}`)) || 0;
      liveTotal.textContent = `المجموع الحالي: ${sum.toFixed(1)}%`;
      liveTotal.style.color = Math.abs(sum - 100) < 0.5 ? "var(--green)" : "var(--amber)";
    };
    splitForm.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", updateLiveTotal));
    updateLiveTotal();

    splitForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(splitForm);
      const splits = {};
      for (const u of active) splits[u.id] = parseFloat(fd.get(`split_${u.id}`));
      try {
        await api.patch("/users/splits", { splits });
        await refresh();
        container.querySelector("#partners-msg").innerHTML =
          '<div class="card" style="color:var(--green)">تم حفظ التوزيع</div>';
      } catch (err) {
        container.querySelector("#partners-msg").innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
      }
    });
  }

  const addForm = container.querySelector("#add-partner-form");
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(addForm);
    try {
      const result = await api.post("/users", {
        display_name: fd.get("display_name"),
        username: fd.get("username"),
        password: fd.get("password"),
      });
      await refresh();
      if (result.recovery_code) {
        await UI.showRecoveryCode(result.recovery_code, { title: `🔑 رمز استرجاع ${esc(result.display_name)}` });
      }
    } catch (err) {
      container.querySelector("#partners-msg").innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  });

  container.querySelectorAll("[data-deactivate-user]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!(await UI.confirm("تعطيل هذا الشريك؟ ما راح يكدر يسجل دخول، بس سجله التاريخي يبقى محفوظ.", { danger: true }))) return;
      try {
        await api.post(`/users/${a.dataset.deactivateUser}/deactivate`);
        await refresh();
      } catch (err) {
        container.querySelector("#partners-msg").innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
      }
    });
  });

  container.querySelectorAll("[data-reactivate-user]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      await api.post(`/users/${a.dataset.reactivateUser}/reactivate`);
      await refresh();
    });
  });

  container.querySelectorAll("[data-edit-user]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const id = a.dataset.editUser;
      const u = users.find((x) => String(x.id) === id);
      openEditForm(container, u, refresh);
    });
  });
}

function openEditForm(container, user, refresh) {
  const existing = container.querySelector("#edit-partner-wrap");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "edit-partner-wrap";
  wrap.className = "card";
  wrap.innerHTML = `
    <h2>تعديل ${esc(user.display_name)}</h2>
    <form id="edit-partner-form">
      <div class="field"><label>الاسم</label><input name="display_name" value="${esc(user.display_name)}" required /></div>
      <div class="field"><label>اسم المستخدم</label><input name="username" value="${esc(user.username)}" required /></div>
      <div class="field"><label>كلمة مرور جديدة (اتركها فارغة لعدم التغيير)</label><input type="password" name="password" minlength="6" autocomplete="new-password" /></div>
      <button type="submit" class="btn">حفظ</button>
    </form>
  `;
  container.querySelector("#partners-msg").before(wrap);

  wrap.querySelector("#edit-partner-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      display_name: fd.get("display_name"),
      username: fd.get("username"),
    };
    if (fd.get("password")) payload.password = fd.get("password");
    try {
      await api.patch(`/users/${user.id}`, payload);
      await refresh();
    } catch (err) {
      container.querySelector("#partners-msg").innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  });
}

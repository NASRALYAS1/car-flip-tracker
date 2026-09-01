Views.expensePresets = async function (container) {
  const presets = await api.get("/expense-presets");
  renderExpensePresets(container, presets);
};

function renderExpensePresets(container, presets) {
  const rows = presets
    .map(
      (p) => `
    <div class="card-row" data-preset-id="${p.id}">
      <span class="label">${p.description}</span>
      <span class="value">
        ${p.default_currency === "USD" ? `$${(p.default_amount / 100).toFixed(2)}` : `${(p.default_amount / 100).toLocaleString("en-US")} د.ع`}
        <a href="#" data-edit-preset="${p.id}" style="margin-inline-start:8px">تعديل</a>
        <a href="#" data-del-preset="${p.id}" style="color:var(--red);margin-inline-start:8px">✕</a>
      </span>
    </div>`
    )
    .join("");

  container.innerHTML = `
    <div class="topbar">
      <span class="back" data-back>→</span>
      <h1>🧾 قوالب المصاريف الجاهزة</h1>
    </div>
    <p style="color:var(--text-dim);font-size:0.85rem;margin-top:-8px">
      أزرار تعبئة سريعة تظهر بصفحة كل سيارة — تعبّي الوصف والمبلغ تلقائياً،
      وتقدر تغيّر المبلغ وقت التسجيل الفعلي.
    </p>

    <div class="card">
      ${rows || '<p style="color:var(--text-dim)">لا يوجد قوالب بعد</p>'}
    </div>

    <button class="btn secondary" id="toggle-add-preset" style="margin:12px 0">+ إضافة قالب جديد</button>
    <div id="add-preset-wrap" class="hidden card">
      <form id="add-preset-form">
        <div class="field"><label>الوصف</label><input name="description" required placeholder="مثلاً: تعبئة بانزين" /></div>
        ${money.inputHtml("default_amount", "المبلغ الافتراضي")}
        <button type="submit" class="btn">إضافة</button>
      </form>
    </div>
    <div id="preset-msg"></div>
  `;

  container.querySelector("[data-back]").addEventListener("click", () => (window.location.hash = "#/settings"));

  async function refresh() {
    const fresh = await api.get("/expense-presets");
    appState.expensePresets = fresh;
    renderExpensePresets(container, fresh);
  }

  container.querySelector("#toggle-add-preset").addEventListener("click", () => {
    container.querySelector("#add-preset-wrap").classList.toggle("hidden");
  });

  const addForm = container.querySelector("#add-preset-form");
  money.bindInputToggle(addForm, "default_amount");
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(addForm);
    const amountField = money.readField(fd, "default_amount");
    if (!amountField) return;
    try {
      await api.post("/expense-presets", {
        description: fd.get("description"),
        default_amount: amountField.default_amount_amount,
        default_currency: amountField.default_amount_currency,
      });
      await refresh();
    } catch (err) {
      container.querySelector("#preset-msg").innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });

  container.querySelectorAll("[data-del-preset]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!confirm("حذف هذا القالب؟")) return;
      try {
        await api.del(`/expense-presets/${a.dataset.delPreset}`);
        await refresh();
      } catch (err) {
        container.querySelector("#preset-msg").innerHTML = `<div class="error-msg">${err.message}</div>`;
      }
    });
  });

  container.querySelectorAll("[data-edit-preset]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const preset = presets.find((p) => String(p.id) === a.dataset.editPreset);
      openPresetEditForm(container, preset, refresh);
    });
  });
}

function openPresetEditForm(container, preset, refresh) {
  const existing = container.querySelector("#edit-preset-wrap");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "edit-preset-wrap";
  wrap.className = "card";
  wrap.innerHTML = `
    <h2>تعديل ${preset.description}</h2>
    <form id="edit-preset-form">
      <div class="field"><label>الوصف</label><input name="description" value="${preset.description}" required /></div>
      ${money.inputHtml("default_amount", "المبلغ الافتراضي", { currency: preset.default_currency })}
      <button type="submit" class="btn">حفظ</button>
    </form>
  `;
  container.querySelector("#preset-msg").before(wrap);

  const form = wrap.querySelector("#edit-preset-form");
  form.querySelector('[name="default_amount_amount_display"]').value = (preset.default_amount / 100).toFixed(2);
  money.bindInputToggle(form, "default_amount");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const amountField = money.readField(fd, "default_amount");
    if (!amountField) return;
    try {
      await api.patch(`/expense-presets/${preset.id}`, {
        description: fd.get("description"),
        default_amount: amountField.default_amount_amount,
        default_currency: amountField.default_amount_currency,
      });
      await refresh();
    } catch (err) {
      container.querySelector("#preset-msg").innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });
}

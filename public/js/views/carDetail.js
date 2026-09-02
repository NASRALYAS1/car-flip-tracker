Views.carDetail = async function (container, id) {
  const car = await api.get(`/cars/${id}`);
  renderCarDetail(container, car);
};

function renderCarDetail(container, car) {
  const totalExpenses = car.expenses.reduce((s, e) => s + e.amount_usd_cents, 0);
  const runningCost = car.purchase_price_usd_cents + totalExpenses;

  container.innerHTML = `
    <div class="topbar">
      <span class="back" data-back>→</span>
      <h1>${car.make} ${car.model}</h1>
      <span class="badge ${car.status}">${CAR_STATUS_LABELS[car.status]}</span>
    </div>

    ${chainHtml(car.chain, car.id)}

    <div class="card">
      <div class="card-row"><span class="label">تاريخ الشراء</span><span class="value">${car.purchase_date}</span></div>
      <div class="card-row"><span class="label">سعر الشراء</span><span class="value">${money.formatUsd(car.purchase_price_usd_cents)}</span></div>
      ${car.year ? `<div class="card-row"><span class="label">سنة الصنع</span><span class="value">${car.year}</span></div>` : ""}
      ${car.color ? `<div class="card-row"><span class="label">اللون</span><span class="value">${car.color}</span></div>` : ""}
      ${car.mileage ? `<div class="card-row"><span class="label">العداد</span><span class="value">${car.mileage} كم</span></div>` : ""}
      ${car.seller_name ? `<div class="card-row"><span class="label">البائع</span><span class="value">${car.seller_name}</span></div>` : ""}
      ${car.condition_notes ? `<p style="margin-top:8px;color:var(--text-dim)">${car.condition_notes}</p>` : ""}
    </div>

    <h2>الصور</h2>
    <div class="photo-grid" id="photo-grid">
      ${car.photos.map((p) => `<img src="/api/photos/${p.id}" data-photo-id="${p.id}" />`).join("")}
    </div>
    <input type="file" id="photo-input" accept="image/*" capture="environment" class="hidden" />
    <button class="btn secondary" id="add-photo-btn" style="margin-bottom:16px">+ إضافة صورة</button>

    <h2>المصاريف</h2>
    <div class="card" id="expenses-card">
      ${
        car.expenses.length
          ? car.expenses
              .map(
                (e) => `
        <div class="card-row" data-expense-id="${e.id}">
          <span class="label">${e.description} <span style="opacity:.6">(${e.expense_date})</span></span>
          <span class="value">${money.formatUsd(e.amount_usd_cents)} <a href="#" data-edit-expense="${e.id}">✎</a> <a href="#" data-del-expense="${e.id}" style="color:var(--red)">✕</a></span>
        </div>`
              )
              .join("")
          : '<p style="color:var(--text-dim)">لا توجد مصاريف بعد</p>'
      }
      <div class="card-row" style="border-top:1px solid var(--border);margin-top:8px;padding-top:10px">
        <span class="label">إجمالي التكلفة</span>
        <span class="value">${money.formatUsd(runningCost)}</span>
      </div>
    </div>
    ${
      appState.expensePresets.length
        ? `<div class="btn-row" style="flex-wrap:wrap;margin-bottom:10px">
            ${appState.expensePresets
              .map(
                (p) =>
                  `<button type="button" class="btn secondary" data-preset-id="${p.id}" style="flex:0 0 auto">${p.description}</button>`
              )
              .join("")}
          </div>`
        : ""
    }
    <button class="btn secondary" id="toggle-expense-form" style="margin-bottom:16px">+ إضافة مصروف</button>
    <div id="expense-form-wrap" class="hidden card">
      <form id="expense-form">
        <div class="field"><label>الوصف</label><input name="description" required /></div>
        ${money.inputHtml("amount", "المبلغ")}
        <div class="field"><label>التاريخ</label><input type="date" name="expense_date" value="${new Date().toISOString().slice(0, 10)}" required /></div>
        <button type="submit" class="btn">حفظ المصروف</button>
      </form>
    </div>

    ${saleSectionHtml(car)}

    ${car.status === "in_stock" ? actionsHtml(car.id) : ""}
    <div id="car-detail-msg"></div>
  `;

  container.querySelector("[data-back]").addEventListener("click", () => (window.location.hash = "#/cars"));

  container.querySelector("#add-photo-btn").addEventListener("click", () => {
    container.querySelector("#photo-input").click();
  });
  container.querySelector("#photo-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    try {
      await api.post(`/cars/${car.id}/photos`, fd);
      const fresh = await api.get(`/cars/${car.id}`);
      renderCarDetail(container, fresh);
    } catch (err) {
      await UI.alert(err.message);
    }
  });
  container.querySelectorAll("#photo-grid img").forEach((img) => {
    img.addEventListener("click", async () => {
      if (!(await UI.confirm("حذف هذه الصورة؟", { danger: true }))) return;
      await api.del(`/photos/${img.dataset.photoId}`);
      const fresh = await api.get(`/cars/${car.id}`);
      renderCarDetail(container, fresh);
    });
  });

  container.querySelector("#toggle-expense-form").addEventListener("click", () => {
    container.querySelector("#expense-form-wrap").classList.toggle("hidden");
  });
  container.querySelectorAll("[data-preset-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = appState.expensePresets.find((p) => String(p.id) === btn.dataset.presetId);
      if (!preset) return;
      const wrap = container.querySelector("#expense-form-wrap");
      wrap.classList.remove("hidden");
      const form = container.querySelector("#expense-form");
      form.querySelector('[name="description"]').value = preset.description;
      form.querySelector('[data-money-currency="amount"]').value = preset.default_currency;
      const amountInput = form.querySelector('[name="amount_amount_display"]');
      amountInput.value = money.formatWithCommas((preset.default_amount / 100).toFixed(2));
      form.querySelector('[data-rate-row="amount"]').classList.toggle("show", preset.default_currency === "IQD");
      amountInput.focus();
      amountInput.select();
    });
  });
  const expenseForm = container.querySelector("#expense-form");
  money.bindInputToggle(expenseForm, "amount");
  expenseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(expenseForm);
    const amountField = money.readField(fd, "amount");
    if (!amountField) return;
    try {
      await api.post(`/cars/${car.id}/expenses`, {
        description: fd.get("description"),
        expense_date: fd.get("expense_date"),
        ...amountField,
      });
      const fresh = await api.get(`/cars/${car.id}`);
      renderCarDetail(container, fresh);
    } catch (err) {
      await UI.alert(err.message);
    }
  });
  container.querySelectorAll("[data-edit-expense]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const exp = car.expenses.find((x) => String(x.id) === a.dataset.editExpense);
      openExpenseEditForm(container, car, exp);
    });
  });
  container.querySelectorAll("[data-del-expense]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!(await UI.confirm("حذف هذا المصروف؟", { danger: true }))) return;
      await api.del(`/expenses/${a.dataset.delExpense}`);
      const fresh = await api.get(`/cars/${car.id}`);
      renderCarDetail(container, fresh);
    });
  });

  bindActions(container, car);
  bindSaleSection(container, car);
}

function openExpenseEditForm(container, car, expense) {
  const existing = container.querySelector("#edit-expense-wrap");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "edit-expense-wrap";
  wrap.className = "card";
  wrap.innerHTML = `
    <h2>تعديل المصروف</h2>
    <form id="edit-expense-form">
      <div class="field"><label>الوصف</label><input name="description" value="${expense.description}" required /></div>
      ${money.inputHtml("amount", "المبلغ", { currency: expense.amount_currency })}
      <div class="field"><label>التاريخ</label><input type="date" name="expense_date" value="${expense.expense_date}" required /></div>
      <button type="submit" class="btn">حفظ</button>
    </form>
  `;
  container.querySelector("#car-detail-msg").before(wrap);

  const form = wrap.querySelector("#edit-expense-form");
  form.querySelector('[name="amount_amount_display"]').value = money.formatWithCommas((expense.amount_amount / 100).toFixed(2));
  if (expense.amount_currency === "IQD" && expense.amount_exchange_rate) {
    form.querySelector('[name="amount_exchange_rate"]').value = expense.amount_exchange_rate;
  }
  money.bindInputToggle(form, "amount");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const amountField = money.readField(fd, "amount");
    if (!amountField) return;
    try {
      await api.patch(`/expenses/${expense.id}`, {
        description: fd.get("description"),
        expense_date: fd.get("expense_date"),
        ...amountField,
      });
      const fresh = await api.get(`/cars/${car.id}`);
      renderCarDetail(container, fresh);
    } catch (err) {
      container.querySelector("#car-detail-msg").innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });
}

function openSaleEditForm(container, car) {
  const existing = container.querySelector("#edit-sale-wrap");
  if (existing) existing.remove();

  const s = car.sale;
  const wrap = document.createElement("div");
  wrap.id = "edit-sale-wrap";
  wrap.className = "card";
  wrap.innerHTML = `
    <h2>تعديل البيع</h2>
    <form id="edit-sale-form">
      <div class="field"><label>تاريخ البيع</label><input type="date" name="sale_date" value="${s.sale_date}" required /></div>
      ${money.inputHtml("sale_price", "سعر البيع الكلي", { currency: s.sale_price_currency })}
      <div class="field"><label>اسم المشتري</label><input name="buyer_name" value="${s.buyer_name || ""}" /></div>
      <div class="field"><label>هاتف المشتري</label><input name="buyer_contact" value="${s.buyer_contact || ""}" /></div>
      ${
        s.sale_type === "installment"
          ? `<div class="field"><label>القسط الشهري المخطط (USD)</label><input type="number" step="0.01" min="0" name="planned_monthly" value="${(s.planned_monthly_installment_usd_cents / 100).toFixed(2)}" /></div>`
          : ""
      }
      <button type="submit" class="btn">حفظ</button>
    </form>
  `;
  container.querySelector("#car-detail-msg").before(wrap);

  const form = wrap.querySelector("#edit-sale-form");
  form.querySelector('[name="sale_price_amount_display"]').value = money.formatWithCommas((s.sale_price_amount / 100).toFixed(2));
  if (s.sale_price_currency === "IQD" && s.sale_price_exchange_rate) {
    form.querySelector('[name="sale_price_exchange_rate"]').value = s.sale_price_exchange_rate;
  }
  money.bindInputToggle(form, "sale_price");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const priceField = money.readField(fd, "sale_price");
    if (!priceField) return;
    const payload = {
      sale_date: fd.get("sale_date"),
      buyer_name: fd.get("buyer_name") || null,
      buyer_contact: fd.get("buyer_contact") || null,
      ...priceField,
    };
    if (s.sale_type === "installment") {
      payload.planned_monthly_installment_usd_cents = Math.round(parseFloat(fd.get("planned_monthly")) * 100);
    }
    try {
      await api.patch(`/cars/${car.id}/sale`, payload);
      const fresh = await api.get(`/cars/${car.id}`);
      renderCarDetail(container, fresh);
    } catch (err) {
      container.querySelector("#car-detail-msg").innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });
}

function chainHtml(chain, currentId) {
  if (!chain || chain.cars.length <= 1) return "";
  const items = chain.cars
    .map((c, i) => {
      const arrow = i > 0 ? '<span class="arrow">←</span>' : "";
      return `${arrow}<div class="chain-car ${c.id === currentId ? "current" : ""}" data-chain-id="${c.id}">${c.make} ${c.model}</div>`;
    })
    .join("");
  return `<div class="chain-strip">${items}</div>`;
}

function actionsHtml(id) {
  return `
    <div class="btn-row">
      <a href="#/sale/${id}" class="btn">بيع</a>
      <a href="#/trade/${id}" class="btn secondary">تبديل بسيارة</a>
    </div>
    <button class="btn secondary" id="archive-btn" style="margin-top:10px">أرشفة السيارة</button>
  `;
}

function bindActions(container, car) {
  const archiveBtn = container.querySelector("#archive-btn");
  if (archiveBtn) {
    archiveBtn.addEventListener("click", async () => {
      if (!(await UI.confirm("أرشفة هذه السيارة؟", { danger: true }))) return;
      await api.post(`/cars/${car.id}/archive`);
      window.location.hash = "#/cars";
    });
  }
}

function saleSectionHtml(car) {
  if (car.status === "traded") {
    return `
      <div class="card">
        <p>تم تبديل هذه السيارة بسيارة أخرى — ما تحقق عليها ربح مباشر، التكلفة انتقلت للسيارة الجديدة بالسلسلة أعلاه.</p>
      </div>
      <button class="btn secondary" id="undo-trade-btn" style="margin-bottom:16px">↩️ إلغاء التبديل (تم بالغلط)</button>
    `;
  }
  if (!car.sale) return "";

  const s = car.sale;
  const totalExpenses = car.expenses.reduce((sum, e) => sum + e.amount_usd_cents, 0);
  const totalCost = car.purchase_price_usd_cents + totalExpenses;
  const profit = s.sale_price_usd_cents - (s.discount_usd_cents || 0) - totalCost;

  let installmentHtml = "";
  if (s.sale_type === "installment") {
    const paid = car.installment_payments.reduce((sum, p) => sum + p.amount_usd_cents, 0);
    const totalPaid = (s.down_payment_usd_cents || 0) + paid;
    const discount = s.discount_usd_cents || 0;
    const remaining = s.sale_price_usd_cents - discount - totalPaid;
    const isPaidOff = remaining <= 0;
    // based on how much of the sale price is accounted for (paid + forgiven),
    // not just cash collected, so a discounted settlement correctly shows 100%
    const pct = s.sale_price_usd_cents > 0
      ? Math.min(100, Math.max(0, ((s.sale_price_usd_cents - remaining) / s.sale_price_usd_cents) * 100))
      : 0;

    const paymentsHtml = car.installment_payments.length
      ? car.installment_payments
          .map(
            (p) => `
        <div class="payment-row" data-payment-id="${p.id}">
          <div class="icon">💵</div>
          <div class="info">
            <div class="amt">${money.formatUsd(p.amount_usd_cents)}</div>
            <div class="date">${p.payment_date}</div>
          </div>
          <a href="#" class="del" data-del-payment="${p.id}" title="حذف الدفعة">✕</a>
        </div>`
          )
          .join("")
      : '<p style="color:var(--text-dim);margin:0">ما فيه دفعات مسجلة بعد</p>';

    installmentHtml = `
      <div class="card">
        <div style="text-align:center;padding:2px 0 6px">
          <div style="color:var(--text-dim);font-size:0.85rem;font-weight:700">${isPaidOff ? "تم السداد بالكامل ✅" : "الباقي على المشتري"}</div>
          <div style="font-size:2rem;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px;color:${isPaidOff ? "var(--green)" : "var(--amber)"}">
            ${money.formatUsd(Math.max(0, remaining))}
          </div>
        </div>
        <div class="progress-bar"><div class="fill ${isPaidOff ? "done" : ""}" style="width:${pct}%"></div></div>
        <div class="progress-caption">
          <span>دفع ${money.formatUsd(totalPaid)} من ${money.formatUsd(s.sale_price_usd_cents)}</span>
          <span>${Math.round(pct)}%</span>
        </div>
        <div class="card-row" style="margin-top:14px"><span class="label">المقدمة</span><span class="value">${money.formatUsd(s.down_payment_usd_cents || 0)}</span></div>
        <div class="card-row"><span class="label">القسط الشهري المخطط</span><span class="value">${money.formatUsd(s.planned_monthly_installment_usd_cents)}</span></div>
        ${
          discount > 0
            ? `<div class="card-row"><span class="label">خصم عند التسوية${s.discount_date ? ` (${s.discount_date})` : ""}</span><span class="value" style="color:var(--accent-2)">${money.formatUsd(discount)}</span></div>
               ${s.discount_notes ? `<div class="card-row"><span class="label">ملاحظات الخصم</span><span class="value">${s.discount_notes}</span></div>` : ""}`
            : ""
        }
      </div>

      <h2>سجل الدفعات</h2>
      <div class="card">${paymentsHtml}</div>

      ${
        !isPaidOff
          ? `
      <div class="btn-row" style="margin-bottom:16px">
        <button class="btn secondary" id="toggle-payment-form">+ تسجيل دفعة جديدة</button>
        <button class="btn secondary" id="payoff-btn" data-remaining="${remaining}">💰 دفع الباقي بالكامل</button>
      </div>
      <div id="payment-form-wrap" class="hidden card">
        <form id="payment-form">
          ${money.inputHtml("amount", "مبلغ الدفعة")}
          <div class="field"><label>التاريخ</label><input type="date" name="payment_date" value="${new Date().toISOString().slice(0, 10)}" required /></div>
          <div class="field"><label>استلمها</label>
            <select name="received_by">${appState.users.filter((u) => u.is_active).map((u) => `<option value="${u.id}">${u.display_name}</option>`).join("")}</select>
          </div>
          <button type="submit" class="btn">حفظ الدفعة</button>
        </form>
      </div>
      <button class="btn secondary" id="toggle-settle-form" style="margin-bottom:16px">🏷️ تسوية نهائية بخصم (المشتري يريد يدفع أقل من الباقي)</button>
      <div id="settle-form-wrap" class="hidden card">
        <p style="margin:0 0 10px;color:var(--text-dim)">
          الباقي الحالي: <strong style="color:var(--text)">${money.formatUsd(remaining)}</strong> —
          اكتب المبلغ اللي راح تقبله الحين وتعتبر العقد منتهي، والباقي ينحسب خصم.
        </p>
        <form id="settle-form">
          ${money.inputHtml("settle_amount", "المبلغ المقبول الآن")}
          <div id="settle-discount-preview" style="font-weight:800;color:var(--accent-2);margin:-4px 0 14px"></div>
          <div class="field"><label>التاريخ</label><input type="date" name="payment_date" value="${new Date().toISOString().slice(0, 10)}" required /></div>
          <div class="field"><label>ملاحظات (سبب الخصم مثلاً)</label><input name="notes" placeholder="تسديد مبكر" /></div>
          <button type="submit" class="btn">تأكيد التسوية والإغلاق</button>
        </form>
      </div>`
          : `<div class="empty-state"><span class="emoji">✅</span>العقد مكتمل ومسدد بالكامل، ما فيه إمكانية لإضافة دفعات جديدة عليه.</div>`
      }
    `;
  }

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0">البيع</h2>
        <a href="#" id="edit-sale-btn">✎ تعديل</a>
      </div>
      <div class="card-row"><span class="label">تاريخ البيع</span><span class="value">${s.sale_date}</span></div>
      <div class="card-row"><span class="label">سعر البيع</span><span class="value">${money.formatUsd(s.sale_price_usd_cents)}</span></div>
      ${s.buyer_name ? `<div class="card-row"><span class="label">المشتري</span><span class="value">${s.buyer_name}</span></div>` : ""}
      <div class="card-row" style="border-top:1px solid var(--border);margin-top:8px;padding-top:10px">
        <span class="label">الربح</span>
        <span class="value" style="color:${profit >= 0 ? "var(--green)" : "var(--red)"}">${money.formatUsd(profit)}</span>
      </div>
    </div>
    ${installmentHtml}
  `;
}

function bindSaleSection(container, car) {
  const undoTradeBtn = container.querySelector("#undo-trade-btn");
  if (undoTradeBtn) {
    undoTradeBtn.addEventListener("click", async () => {
      if (!(await UI.confirm("إلغاء هذا التبديل؟ السيارة الجديدة تنحذف والسيارة هذه ترجع للمخزون.", { danger: true }))) return;
      try {
        await api.del(`/cars/${car.id}/trade`);
        const fresh = await api.get(`/cars/${car.id}`);
        renderCarDetail(container, fresh);
      } catch (err) {
        await UI.alert(err.message);
      }
    });
  }

  const editSaleBtn = container.querySelector("#edit-sale-btn");
  if (editSaleBtn) {
    editSaleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openSaleEditForm(container, car);
    });
  }

  const toggleBtn = container.querySelector("#toggle-payment-form");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      container.querySelector("#payment-form-wrap").classList.toggle("hidden");
    });
    const form = container.querySelector("#payment-form");
    money.bindInputToggle(form, "amount");

    const payoffBtn = container.querySelector("#payoff-btn");
    if (payoffBtn) {
      payoffBtn.addEventListener("click", () => {
        container.querySelector("#payment-form-wrap").classList.remove("hidden");
        const remainingUsd = Number(payoffBtn.dataset.remaining) / 100;
        const amountInput = form.querySelector('[name="amount_amount_display"]');
        form.querySelector('[data-money-currency="amount"]').value = "USD";
        form.querySelector('[data-rate-row="amount"]').classList.remove("show");
        amountInput.value = money.formatWithCommas(remainingUsd.toFixed(2));
        amountInput.scrollIntoView({ block: "center" });
      });
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const amountField = money.readField(fd, "amount");
      if (!amountField) return;
      try {
        await api.post(`/sales/${car.sale.id}/payments`, {
          payment_date: fd.get("payment_date"),
          received_by: Number(fd.get("received_by")),
          ...amountField,
        });
        const fresh = await api.get(`/cars/${car.id}`);
        renderCarDetail(container, fresh);
      } catch (err) {
        await UI.alert(err.message);
      }
    });
  }

  const toggleSettleBtn = container.querySelector("#toggle-settle-form");
  if (toggleSettleBtn) {
    toggleSettleBtn.addEventListener("click", () => {
      container.querySelector("#settle-form-wrap").classList.toggle("hidden");
    });

    const settleForm = container.querySelector("#settle-form");
    money.bindInputToggle(settleForm, "settle_amount");

    const remainingUsdCents =
      car.sale.sale_price_usd_cents - (car.sale.discount_usd_cents || 0) -
      ((car.sale.down_payment_usd_cents || 0) + car.installment_payments.reduce((s, p) => s + p.amount_usd_cents, 0));

    const previewEl = settleForm.querySelector("#settle-discount-preview");
    const amountInput = settleForm.querySelector('[name="settle_amount_amount_display"]');
    const updatePreview = () => {
      const fd = new FormData(settleForm);
      const field = money.readField(fd, "settle_amount");
      if (!field) {
        previewEl.textContent = "";
        return;
      }
      const enteredUsdCents = field.settle_amount_currency === "IQD"
        ? Math.round((field.settle_amount_amount / 100 / field.settle_amount_exchange_rate) * 100)
        : field.settle_amount_amount;
      const discountNow = remainingUsdCents - enteredUsdCents;
      if (discountNow > 0) {
        previewEl.textContent = `🏷️ الخصم: ${money.formatUsd(discountNow)}`;
      } else if (discountNow === 0) {
        previewEl.textContent = "بدون خصم — هذا يغطي كل الباقي بالضبط";
      } else {
        previewEl.textContent = "⚠️ هذا المبلغ أكبر من الباقي — استخدم زر (دفع الباقي بالكامل) بدلاً من هذا";
      }
    };
    amountInput.addEventListener("input", updatePreview);
    settleForm.querySelector('[data-money-currency="settle_amount"]').addEventListener("change", updatePreview);
    settleForm.querySelector('[name="settle_amount_exchange_rate"]')?.addEventListener("input", updatePreview);

    settleForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(settleForm);
      const field = money.readField(fd, "settle_amount");
      if (!field) return;
      const enteredUsdCents = field.settle_amount_currency === "IQD"
        ? Math.round((field.settle_amount_amount / 100 / field.settle_amount_exchange_rate) * 100)
        : field.settle_amount_amount;
      const discountNow = remainingUsdCents - enteredUsdCents;
      if (discountNow <= 0) {
        await UI.alert("هذا المبلغ يغطي كل الباقي أو أكثر — ما فيه خصم لتسويته، استخدم (دفع الباقي بالكامل) بدل هذا.");
        return;
      }
      const confirmed = await UI.confirm(
        `راح تقبل ${money.formatUsd(enteredUsdCents)} وتسوي خصم ${money.formatUsd(discountNow)} على الباقي، ويصير العقد مكتمل. أكيد؟`,
        { okText: "أكيد، سوّي التسوية" }
      );
      if (!confirmed) return;
      try {
        await api.post(`/cars/${car.id}/sale/settle`, {
          payment_date: fd.get("payment_date"),
          notes: fd.get("notes") || null,
          amount_amount: field.settle_amount_amount,
          amount_currency: field.settle_amount_currency,
          amount_exchange_rate: field.settle_amount_exchange_rate,
        });
        const fresh = await api.get(`/cars/${car.id}`);
        renderCarDetail(container, fresh);
      } catch (err) {
        await UI.alert(err.message);
      }
    });
  }

  container.querySelectorAll("[data-del-payment]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!(await UI.confirm("حذف هذه الدفعة؟", { danger: true }))) return;
      await api.del(`/payments/${a.dataset.delPayment}`);
      const fresh = await api.get(`/cars/${car.id}`);
      renderCarDetail(container, fresh);
    });
  });
}

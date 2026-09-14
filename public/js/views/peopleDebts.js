// Rendered into the "ديون الناس" tab of the الديون screen. Shared: every
// partner sees and edits the same list, so the totals here are the business's
// position with the outside world, not one person's.
async function renderPeopleDebtsTab(container) {
  // Anything still queued from an offline session goes up first, so the
  // list below reflects the server rather than fighting with the queue.
  await Offline.flush();

  let serverDebts = [];
  let offlineOnly = false;
  try {
    serverDebts = await api.get("/people-debts");
  } catch (err) {
    // No connection and nothing cached — still show whatever is queued
    // locally rather than an error page.
    offlineOnly = true;
  }
  renderPeopleDebts(container, Offline.applyTo(serverDebts), offlineOnly);
}

function peopleDebtRecorder(userId) {
  const u = appState.users.find((x) => x.id === userId);
  return u ? u.display_name : "شريك سابق";
}

// What's still owed on a debt. A debt queued offline hasn't been through the
// server yet, so it carries no payment totals — nothing has been paid on it.
function debtRemaining(d) {
  return d.remaining_usd_cents ?? d.amount_usd_cents;
}

function renderPeopleDebtRows(debts) {
  if (!debts.length) return '<p style="color:var(--text-dim)">لا يوجد شي مسجل بعد</p>';
  return debts
    .map((d) => {
      const dirLabel = d.direction === "we_owe_them" ? "إحنا مدينين له" : "هو مدين إلنا";
      const paid = d.paid_usd_cents || 0;
      const partlyPaid = paid > 0 && !d.is_settled;
      return `
    <div class="list-item" data-debt-id="${d.id}" style="${d.is_settled ? "opacity:.55" : ""}">
      <div>
        <div class="main">${esc(d.person_name)}${d.is_settled ? " ✅" : ""}${d._pending ? ' <span class="badge in_stock">⏳ بانتظار المزامنة</span>' : ""}</div>
        <div class="sub">${dirLabel}${d.reason ? ` · ${esc(d.reason)}` : ""} · ${esc(d.debt_date)}${partlyPaid ? ` · انسدد ${money.formatUsd(paid)} من ${money.formatUsd(d.amount_usd_cents)}` : ""}</div>
      </div>
      <div class="end">
        ${partlyPaid ? '<div class="amt-label">الباقي</div>' : ""}
        <div class="amt">${partlyPaid ? money.formatUsd(debtRemaining(d)) : money.formatDual(d.amount_usd_cents, d)}</div>
      </div>
    </div>`;
    })
    .join("");
}

function renderPeopleDebts(container, debts, offlineOnly = false) {
  // Totals are what's still owed, not what was originally lent: a customer who
  // has paid back 700 of 1,000 owes the business 300.
  const active = debts.filter((d) => !d.is_settled);
  const owed = (direction) =>
    active
      .filter((d) => d.direction === direction)
      .reduce((s, d) => s + Math.max(0, debtRemaining(d)), 0);
  const totalTheyOweUs = owed("they_owe_us");
  const totalWeOweThem = owed("we_owe_them");

  container.innerHTML = `
    <p style="color:var(--text-dim);font-size:0.85rem;margin:0 0 12px">
      ديون المعرض مع ناس من برّه — زبون باقي عليه فلوس، أو حساب على المعرض لأحد.
      كل الشركاء يشوفون هذي القائمة ويقدرون يعدلونها. غير محسوبة ضمن أرباح التجارة.
    </p>
    ${
      offlineOnly
        ? `<div class="card" style="border-color:var(--amber)">
             <p style="margin:0;font-size:0.85rem">
               📴 بدون اتصال — تكدر تضيف ديون هسه وتنحفظ بالجهاز، وتنرفع تلقائياً لمن يرجع الاتصال.
             </p>
           </div>`
        : ""
    }

    <div class="grid-2">
      <div class="stat">
        <div class="num">${money.formatUsd(totalTheyOweUs)}</div>
        <div class="label">الناس مدينين إلنا</div>
      </div>
      <div class="stat">
        <div class="num">${money.formatUsd(totalWeOweThem)}</div>
        <div class="label">إحنا مدينين للناس</div>
      </div>
    </div>

    <button class="btn secondary" id="toggle-add-debt" style="margin:16px 0">+ إضافة دين</button>
    <div id="add-debt-wrap" class="hidden card">
      <form id="add-debt-form">
        <div class="field"><label>اسم الشخص</label><input name="person_name" required /></div>
        <div class="field"><label>شنو الاتجاه؟</label>
          <select name="direction">
            <option value="they_owe_us">هو مدين إلنا (لازم يرجع فلوس للمعرض)</option>
            <option value="we_owe_them">إحنا مدينين له (لازم المعرض يرجعله فلوس)</option>
          </select>
        </div>
        ${money.inputHtml("amount", "المبلغ")}
        <div class="field"><label>التاريخ</label><input type="date" name="debt_date" value="${new Date().toISOString().slice(0, 10)}" required /></div>
        <div class="field"><label>رقم الهاتف (اختياري)</label><input name="person_phone" /></div>
        <div class="field"><label>العنوان (اختياري)</label><input name="person_address" /></div>
        <div class="field"><label>سبب الدين (اختياري)</label><input name="reason" /></div>
        <div class="field"><label>ملاحظات (اختياري)</label><textarea name="notes" rows="2"></textarea></div>
        <button type="submit" class="btn">حفظ</button>
      </form>
    </div>

    <input type="search" id="people-debts-search" placeholder="🔍 دوّر بالاسم أو السبب أو الملاحظات..." style="margin-bottom:12px" />
    <div id="people-debts-list">${renderPeopleDebtRows(debts)}</div>
    <div id="people-debts-msg"></div>
  `;

  container.querySelector("#toggle-add-debt").addEventListener("click", () => {
    container.querySelector("#add-debt-wrap").classList.toggle("hidden");
  });

  // Returns the list it rendered, so a detail panel can reopen on the fresh
  // copy of the debt it was showing.
  async function refresh() {
    let fresh = [];
    let offline = false;
    try {
      fresh = await api.get("/people-debts");
    } catch {
      offline = true;
    }
    const list = Offline.applyTo(fresh);
    renderPeopleDebts(container, list, offline);
    return list;
  }

  function bindRowClicks() {
    container.querySelectorAll("#people-debts-list [data-debt-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const d = debts.find((x) => String(x.id) === row.dataset.debtId);
        openPeopleDebtDetail(container, d, refresh);
      });
    });
  }
  bindRowClicks();

  container.querySelector("#people-debts-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = !q
      ? debts
      : debts.filter((d) =>
          [d.person_name, d.person_phone, d.reason, d.notes]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)
        );
    container.querySelector("#people-debts-list").innerHTML = renderPeopleDebtRows(filtered);
    bindRowClicks();
  });

  const form = container.querySelector("#add-debt-form");
  money.bindInputToggle(form, "amount");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const amountField = money.readField(fd, "amount");
    if (!amountField) return;
    const payload = {
      person_name: fd.get("person_name"),
      direction: fd.get("direction"),
      debt_date: fd.get("debt_date"),
      person_phone: fd.get("person_phone") || null,
      person_address: fd.get("person_address") || null,
      reason: fd.get("reason") || null,
      notes: fd.get("notes") || null,
      ...amountField,
    };
    try {
      if (Offline.isOffline()) {
        Offline.queueCreate(payload);
      } else {
        await api.post("/people-debts", payload);
      }
      await refresh();
    } catch (err) {
      // Lost the connection mid-save: keep it locally rather than losing
      // what was just typed in.
      if (err.isOffline) {
        Offline.queueCreate(payload);
        await refresh();
        return;
      }
      container.querySelector("#people-debts-msg").innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  });
}

function openPeopleDebtDetail(container, debt, refresh) {
  const existing = container.querySelector("#debt-detail-wrap");
  if (existing) existing.remove();

  const paid = debt.paid_usd_cents || 0;
  const remaining = debtRemaining(debt);
  const payments = debt.payments || [];
  const canPay = !debt.is_settled && remaining > 0;

  const wrap = document.createElement("div");
  wrap.id = "debt-detail-wrap";
  wrap.className = "card";
  wrap.innerHTML = `
    <h2>${esc(debt.person_name)}</h2>
    <div class="card-row"><span class="label">الاتجاه</span><span class="value">${debt.direction === "we_owe_them" ? "إحنا مدينين له" : "هو مدين إلنا"}</span></div>
    <div class="card-row"><span class="label">المبلغ</span><span class="value">${money.formatDual(debt.amount_usd_cents, debt)}</span></div>
    ${
      paid > 0
        ? `<div class="card-row"><span class="label">انسدد لحد الآن</span><span class="value" style="color:var(--green)">${money.formatUsd(paid)}</span></div>
           <div class="card-row"><span class="label">الباقي</span><span class="value">${money.formatUsd(Math.max(0, remaining))}</span></div>`
        : ""
    }
    <div class="card-row"><span class="label">التاريخ</span><span class="value">${esc(debt.debt_date)}</span></div>
    ${debt.recorded_by ? `<div class="card-row"><span class="label">سجّله</span><span class="value">${esc(peopleDebtRecorder(debt.recorded_by))}</span></div>` : ""}
    ${debt.person_phone ? `<div class="card-row"><span class="label">الهاتف</span><span class="value">${esc(debt.person_phone)}</span></div>` : ""}
    ${debt.person_address ? `<div class="card-row"><span class="label">العنوان</span><span class="value">${esc(debt.person_address)}</span></div>` : ""}
    ${debt.reason ? `<div class="card-row"><span class="label">السبب</span><span class="value">${esc(debt.reason)}</span></div>` : ""}
    ${debt.notes ? `<div class="card-row"><span class="label">ملاحظات</span><span class="value">${esc(debt.notes)}</span></div>` : ""}
    ${debt.is_settled ? `<div class="card-row"><span class="label">تم السداد</span><span class="value" style="color:var(--green)">${esc(debt.settled_date || "")} ✅</span></div>` : ""}

    <div class="pd-section-title">الدفعات</div>
    ${
      payments.length
        ? payments
            .map(
              (p) => `
      <div class="payment-row">
        <div class="icon">💵</div>
        <div class="info">
          <div class="amt">${money.formatDual(p.amount_usd_cents, p)}</div>
          <div class="date">${esc(p.payment_date)}${p.notes ? ` · ${esc(p.notes)}` : ""}</div>
        </div>
        <a href="#" class="del" data-del-debt-payment="${p.id}" title="حذف الدفعة">✕</a>
      </div>`
            )
            .join("")
        : '<p style="color:var(--text-dim);margin:0">ما فيه دفعات مسجلة بعد</p>'
    }

    ${
      canPay
        ? `<form id="pd-payment-form" class="pd-payment-form">
            ${money.inputHtml("pay_amount", "مبلغ الدفعة")}
            <button type="button" class="btn secondary" id="pd-fill-remaining" style="margin:-4px 0 12px">كل الباقي (${money.formatUsd(remaining)})</button>
            <div class="field"><label>تاريخ الدفعة</label><input type="date" name="payment_date" value="${new Date().toISOString().slice(0, 10)}" required /></div>
            <div class="field"><label>ملاحظات (اختياري)</label><input name="payment_notes" /></div>
            <button type="submit" class="btn">حفظ الدفعة</button>
          </form>`
        : ""
    }

    <div class="btn-row" style="margin-top:14px">
      <button class="btn secondary" id="pd-settle-btn">${debt.is_settled ? "إلغاء علامة السداد" : paid > 0 ? "✅ اعتباره مسدد (بدون الباقي)" : "✅ تحديد كمسدد"}</button>
      <button class="btn danger" id="pd-delete-btn">حذف</button>
    </div>
    <button class="btn secondary" id="pd-close-btn" style="margin-top:10px">إغلاق</button>
  `;
  container.querySelector("#people-debts-msg").before(wrap);
  wrap.scrollIntoView({ block: "center" });

  wrap.querySelector("#pd-close-btn").addEventListener("click", () => wrap.remove());

  // Repayments go straight to the server rather than into the offline queue:
  // they change what's owed, and a debt that hasn't synced yet has no server
  // id to record them against.
  const needsServer = async () => {
    if (Offline.isOffline() || debt._pending) {
      await UI.alert("تسجيل الدفعات يحتاج اتصال بالإنترنت، والدين لازم يكون مرفوع للسيرفر.");
      return true;
    }
    return false;
  };

  const reopen = async () => {
    const list = await refresh();
    const fresh = (list || []).find((x) => String(x.id) === String(debt.id));
    if (fresh) openPeopleDebtDetail(container, fresh, refresh);
  };

  const payForm = wrap.querySelector("#pd-payment-form");
  if (payForm) {
    money.bindInputToggle(payForm, "pay_amount");
    wrap.querySelector("#pd-fill-remaining").addEventListener("click", () => {
      payForm.querySelector('[data-money-currency="pay_amount"]').value = "USD";
      payForm.querySelector('[data-rate-row="pay_amount"]').classList.remove("show");
      const input = payForm.querySelector('[name="pay_amount_amount_display"]');
      input.value = money.formatWithCommas((remaining / 100).toFixed(2));
      input.focus();
    });
    payForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (await needsServer()) return;
      const fd = new FormData(payForm);
      const field = money.readField(fd, "pay_amount");
      if (!field) return;
      try {
        await api.post(`/people-debts/${debt.id}/payments`, {
          payment_date: fd.get("payment_date"),
          notes: fd.get("payment_notes") || null,
          amount_amount: field.pay_amount_amount,
          amount_currency: field.pay_amount_currency,
          amount_exchange_rate: field.pay_amount_exchange_rate,
        });
        await reopen();
      } catch (err) {
        await UI.alert(err.message);
      }
    });
  }

  wrap.querySelectorAll("[data-del-debt-payment]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (await needsServer()) return;
      if (!(await UI.confirm("حذف هذه الدفعة؟", { danger: true }))) return;
      try {
        await api.del(`/people-debts/${debt.id}/payments/${a.dataset.delDebtPayment}`);
        await reopen();
      } catch (err) {
        await UI.alert(err.message);
      }
    });
  });

  wrap.querySelector("#pd-settle-btn").addEventListener("click", async () => {
    const patch = { is_settled: !debt.is_settled };
    try {
      if (Offline.isOffline() || debt._pending) {
        Offline.queuePatch(debt.id, patch);
      } else {
        await api.patch(`/people-debts/${debt.id}`, patch);
      }
    } catch (err) {
      if (!err.isOffline) {
        await UI.alert(err.message);
        return;
      }
      Offline.queuePatch(debt.id, patch);
    }
    wrap.remove();
    await refresh();
  });

  wrap.querySelector("#pd-delete-btn").addEventListener("click", async () => {
    if (!(await UI.confirm(`حذف دين ${esc(debt.person_name)}؟`, { danger: true }))) return;
    try {
      if (Offline.isOffline() || debt._pending) {
        Offline.queueDelete(debt.id);
      } else {
        await api.del(`/people-debts/${debt.id}`);
      }
    } catch (err) {
      if (!err.isOffline) {
        await UI.alert(err.message);
        return;
      }
      Offline.queueDelete(debt.id);
    }
    wrap.remove();
    await refresh();
  });
}

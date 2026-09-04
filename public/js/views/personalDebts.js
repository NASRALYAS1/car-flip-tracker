Views.personalDebts = async function (container) {
  // Anything still queued from an offline session goes up first, so the
  // list below reflects the server rather than fighting with the queue.
  await Offline.flush();

  let serverDebts = [];
  let offlineOnly = false;
  try {
    serverDebts = await api.get("/personal-debts");
  } catch (err) {
    // No connection and nothing cached — still show whatever is queued
    // locally rather than an error page.
    offlineOnly = true;
  }
  renderPersonalDebts(container, Offline.applyTo(serverDebts), offlineOnly);
};

function renderPersonalDebtRows(debts) {
  if (!debts.length) return '<p style="color:var(--text-dim)">لا يوجد شي مسجل بعد</p>';
  return debts
    .map((d) => {
      const dirLabel = d.direction === "i_owe_them" ? "أنا مدين له" : "هو مدين لي";
      return `
    <div class="list-item" data-debt-id="${d.id}" style="${d.is_settled ? "opacity:.55" : ""}">
      <div>
        <div class="main">${esc(d.person_name)}${d.is_settled ? " ✅" : ""}${d._pending ? ' <span class="badge in_stock">⏳ بانتظار المزامنة</span>' : ""}</div>
        <div class="sub">${dirLabel}${d.reason ? ` · ${esc(d.reason)}` : ""} · ${esc(d.debt_date)}</div>
      </div>
      <div class="end">
        <div class="amt">${money.formatDual(d.amount_usd_cents, d)}</div>
      </div>
    </div>`;
    })
    .join("");
}

function renderPersonalDebts(container, debts, offlineOnly = false) {
  const active = debts.filter((d) => !d.is_settled);
  const totalTheyOweMe = active
    .filter((d) => d.direction === "they_owe_me")
    .reduce((s, d) => s + d.amount_usd_cents, 0);
  const totalIOweThem = active
    .filter((d) => d.direction === "i_owe_them")
    .reduce((s, d) => s + d.amount_usd_cents, 0);

  container.innerHTML = `
    <div class="topbar">
      <span class="back" data-back>→</span>
      <h1>🔒 ديوني الشخصية</h1>
    </div>
    <p style="color:var(--text-dim);font-size:0.85rem;margin-top:-8px">
      هذه الصفحة خاصة بيك بس — باقي الشركاء ما يشوفونها ولا يقدرون يوصلونها. غير مرتبطة بحسابات التجارة أو تقسيم الأرباح.
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
        <div class="num">${money.formatUsd(totalTheyOweMe)}</div>
        <div class="label">الناس مدينين لي</div>
      </div>
      <div class="stat">
        <div class="num">${money.formatUsd(totalIOweThem)}</div>
        <div class="label">أنا مدين للناس</div>
      </div>
    </div>

    <button class="btn secondary" id="toggle-add-debt" style="margin:16px 0">+ إضافة دين</button>
    <div id="add-debt-wrap" class="hidden card">
      <form id="add-debt-form">
        <div class="field"><label>اسم الشخص</label><input name="person_name" required /></div>
        <div class="field"><label>شنو الاتجاه؟</label>
          <select name="direction">
            <option value="they_owe_me">هو مدين لي (لازم يرجعلي فلوس)</option>
            <option value="i_owe_them">أنا مدين له (لازم أرجعله فلوس)</option>
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

    <input type="search" id="personal-debts-search" placeholder="🔍 دوّر بالاسم أو السبب أو الملاحظات..." style="margin-bottom:12px" />
    <div id="personal-debts-list">${renderPersonalDebtRows(debts)}</div>
    <div id="personal-debts-msg"></div>
  `;

  container.querySelector("[data-back]").addEventListener("click", () => (window.location.hash = "#/settings"));

  container.querySelector("#toggle-add-debt").addEventListener("click", () => {
    container.querySelector("#add-debt-wrap").classList.toggle("hidden");
  });

  async function refresh() {
    let fresh = [];
    let offline = false;
    try {
      fresh = await api.get("/personal-debts");
    } catch {
      offline = true;
    }
    renderPersonalDebts(container, Offline.applyTo(fresh), offline);
  }

  function bindRowClicks() {
    container.querySelectorAll("#personal-debts-list [data-debt-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const d = debts.find((x) => String(x.id) === row.dataset.debtId);
        openPersonalDebtDetail(container, d, refresh);
      });
    });
  }
  bindRowClicks();

  container.querySelector("#personal-debts-search").addEventListener("input", (e) => {
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
    container.querySelector("#personal-debts-list").innerHTML = renderPersonalDebtRows(filtered);
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
        await api.post("/personal-debts", payload);
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
      container.querySelector("#personal-debts-msg").innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  });
}

function openPersonalDebtDetail(container, debt, refresh) {
  const existing = container.querySelector("#debt-detail-wrap");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "debt-detail-wrap";
  wrap.className = "card";
  wrap.innerHTML = `
    <h2>${esc(debt.person_name)}</h2>
    <div class="card-row"><span class="label">الاتجاه</span><span class="value">${debt.direction === "i_owe_them" ? "أنا مدين له" : "هو مدين لي"}</span></div>
    <div class="card-row"><span class="label">المبلغ</span><span class="value">${money.formatDual(debt.amount_usd_cents, debt)}</span></div>
    <div class="card-row"><span class="label">التاريخ</span><span class="value">${esc(debt.debt_date)}</span></div>
    ${debt.person_phone ? `<div class="card-row"><span class="label">الهاتف</span><span class="value">${esc(debt.person_phone)}</span></div>` : ""}
    ${debt.person_address ? `<div class="card-row"><span class="label">العنوان</span><span class="value">${esc(debt.person_address)}</span></div>` : ""}
    ${debt.reason ? `<div class="card-row"><span class="label">السبب</span><span class="value">${esc(debt.reason)}</span></div>` : ""}
    ${debt.notes ? `<div class="card-row"><span class="label">ملاحظات</span><span class="value">${esc(debt.notes)}</span></div>` : ""}
    ${debt.is_settled ? `<div class="card-row"><span class="label">تم السداد</span><span class="value" style="color:var(--green)">${esc(debt.settled_date || "")} ✅</span></div>` : ""}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn secondary" id="pd-settle-btn">${debt.is_settled ? "إلغاء علامة السداد" : "✅ تحديد كمسدد"}</button>
      <button class="btn danger" id="pd-delete-btn">حذف</button>
    </div>
    <button class="btn secondary" id="pd-close-btn" style="margin-top:10px">إغلاق</button>
  `;
  container.querySelector("#personal-debts-msg").before(wrap);
  wrap.scrollIntoView({ block: "center" });

  wrap.querySelector("#pd-close-btn").addEventListener("click", () => wrap.remove());

  wrap.querySelector("#pd-settle-btn").addEventListener("click", async () => {
    const patch = { is_settled: !debt.is_settled };
    try {
      if (Offline.isOffline() || debt._pending) {
        Offline.queuePatch(debt.id, patch);
      } else {
        await api.patch(`/personal-debts/${debt.id}`, patch);
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
        await api.del(`/personal-debts/${debt.id}`);
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

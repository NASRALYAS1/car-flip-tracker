Views.debtDetail = async function (container, id) {
  let entry;
  try {
    entry = await api.get(`/debts/${id}`);
  } catch (err) {
    container.innerHTML = `<div class="topbar"><span class="back" data-back>→</span><h1>القيد</h1></div><div class="error-msg">${esc(err.message)}</div>`;
    container.querySelector("[data-back]").addEventListener("click", () => (window.location.hash = "#/debts"));
    return;
  }

  const label = entry.entry_type === "loan" ? "سلفة" : "تسديد";
  const businessName = (appState.settings && appState.settings.business_name) || "تجارة السيارات";
  const { primary: primaryAmount, secondary: secondaryAmount } = money.formatDualParts(entry.amount_usd_cents, entry);

  container.innerHTML = `
    <div class="topbar no-print">
      <span class="back" data-back>→</span>
      <h1>تفاصيل القيد</h1>
    </div>

    <div class="invoice-card">
      <div class="type-badge">${esc(businessName)} — ${label}</div>
      <div class="amount">${primaryAmount}</div>
      <div class="amount-iqd">≈ ${secondaryAmount}</div>
      <div class="flow">${esc(debtFlowText(entry))}</div>
    </div>

    <div class="card">
      <div class="card-row"><span class="label">التاريخ</span><span class="value">${esc(entry.entry_date)}</span></div>
      <div class="card-row"><span class="label">النوع</span><span class="value">${label}</span></div>
      <div class="card-row"><span class="label">من (الدائن)</span><span class="value">${esc(entry.lender_name)}</span></div>
      <div class="card-row"><span class="label">إلى (المدين)</span><span class="value">${esc(entry.borrower_name)}</span></div>
      ${entry.amount_currency === "IQD" ? `<div class="card-row"><span class="label">سعر الصرف وقتها</span><span class="value">${esc(entry.amount_exchange_rate)}</span></div>` : ""}
      ${entry.notes ? `<div class="card-row"><span class="label">ملاحظات</span><span class="value">${esc(entry.notes)}</span></div>` : ""}
      <div class="card-row"><span class="label">سجّلها</span><span class="value">${esc(entry.recorded_by_name)}</span></div>
    </div>

    <div class="btn-row no-print">
      <button class="btn secondary" id="share-btn">📤 مشاركة عبر واتساب</button>
      <button class="btn secondary" id="print-btn">🖨️ طباعة / حفظ PDF</button>
    </div>
    <button class="btn danger no-print" id="delete-btn" style="margin-top:10px">حذف هذا القيد</button>
  `;

  container.querySelector("[data-back]").addEventListener("click", () => (window.location.hash = "#/debts"));

  container.querySelector("#share-btn").addEventListener("click", async () => {
    const text = [
      `📋 ${businessName} — ${label}`,
      debtFlowText(entry),
      `المبلغ: ${primaryAmount} (≈ ${secondaryAmount})`,
      `التاريخ: ${entry.entry_date}`,
      entry.notes ? `ملاحظات: ${entry.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    if (navigator.share) {
      try {
        await navigator.share({ title: `${businessName} — ${label}`, text });
        return;
      } catch {
        // cancelled — nothing to do
      }
    } else {
      await UI.alert("المشاركة غير مدعومة بهذا المتصفح، انسخ النص يدوياً:\n\n" + text);
    }
  });

  container.querySelector("#print-btn").addEventListener("click", () => {
    window.print();
  });

  container.querySelector("#delete-btn").addEventListener("click", async () => {
    if (!(await UI.confirm("حذف هذا القيد؟", { danger: true }))) return;
    try {
      await api.del(`/debts/${id}`);
      window.location.hash = "#/debts";
    } catch (err) {
      await UI.alert(err.message);
    }
  });
};

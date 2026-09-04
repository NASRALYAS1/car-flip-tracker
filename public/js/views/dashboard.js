Views.dashboard = async function (container) {
  const d = await api.get("/dashboard");
  const profitPositive = d.total_profit_usd_cents >= 0;
  const partnerRows = d.partner_shares
    .map(
      (p) => `
      <div class="card-row">
        <span class="label">حصة ${esc(p.display_name)}</span>
        <span class="value">${money.formatUsd(p.share_usd_cents)}</span>
      </div>`
    )
    .join("");

  container.innerHTML = `
    <div class="topbar"><h1>👋 أهلاً ${esc((appState.user && appState.user.display_name) || "")}</h1></div>

    <div class="card" style="background:linear-gradient(160deg,#17233f,#131c33);border-color:#2f3f68">
      <div style="color:var(--text-dim);font-size:0.85rem;font-weight:700;margin-bottom:4px">إجمالي الربح</div>
      <div style="font-size:2rem;font-weight:800;color:${profitPositive ? "var(--green)" : "var(--red)"};font-variant-numeric:tabular-nums">
        ${money.formatUsd(d.total_profit_usd_cents)}
      </div>
      <div style="margin-top:10px">${partnerRows}</div>
    </div>

    <h2>نظرة عامة</h2>
    <div class="grid-2">
      <div class="stat">
        <div class="num">🚗 ${d.in_stock_count}</div>
        <div class="label">سيارات بالمخزون</div>
      </div>
      <div class="stat">
        <div class="num">${money.formatUsd(d.in_stock_value_usd_cents)}</div>
        <div class="label">قيمة المخزون</div>
      </div>
      <div class="stat">
        <div class="num green">✅ ${d.sold_this_month_count}</div>
        <div class="label">مباعة هذا الشهر</div>
      </div>
      <div class="stat">
        <div class="num ${d.overdue_installments_count > 0 ? "amber" : ""}">${d.overdue_installments_count > 0 ? "⚠️" : "🎉"} ${d.overdue_installments_count}</div>
        <div class="label">أقساط متأخرة</div>
      </div>
    </div>

    ${
      d.overdue_installments_count > 0
        ? `<a href="#/installments" class="btn danger" style="margin-top:4px">⚠️ عرض الأقساط المتأخرة</a>`
        : ""
    }

    <div class="btn-row" style="margin-top:16px">
      <a href="#/add-car" class="btn">+ إضافة سيارة</a>
      <a href="#/cars" class="btn secondary">عرض السيارات</a>
    </div>
  `;
};

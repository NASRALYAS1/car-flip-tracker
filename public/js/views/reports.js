function currentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

function currentYearRange() {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

Views.reports = async function (container) {
  let period = "all"; // 'all' | 'month' | 'year' | 'custom'
  let customFrom = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 10);
  let customTo = new Date().toISOString().slice(0, 10);

  function rangeFor() {
    if (period === "month") return currentMonthRange();
    if (period === "year") return currentYearRange();
    if (period === "custom") return { from: customFrom, to: customTo };
    return { from: "0000-01-01", to: "9999-12-31" };
  }

  async function load() {
    const { from, to } = rangeFor();
    const [summary, aging] = await Promise.all([
      api.get(`/reports/summary?from=${from}&to=${to}`),
      api.get("/reports/inventory-aging"),
    ]);
    render(summary, aging);
  }

  function render(summary, aging) {
    const profitPositive = summary.profit_usd_cents >= 0;
    const partnerRows = summary.partner_shares
      .map(
        (p) => `
      <div class="card-row">
        <span class="label">🧑 حصة ${p.display_name}</span>
        <span class="value">${money.formatUsd(p.share_usd_cents)}</span>
      </div>`
      )
      .join("");

    const carsRows = summary.cars.length
      ? summary.cars
          .map(
            (c) => `
      <div class="list-item" data-car-id="${c.car_id}">
        <div>
          <div class="main">${c.make} ${c.model} ${c.year || ""}</div>
          <div class="sub">${c.sale_date}${c.buyer_name ? ` · ${c.buyer_name}` : ""}</div>
        </div>
        <div class="end">
          <div class="amt" style="color:${c.profit_usd_cents >= 0 ? "var(--green)" : "var(--red)"}">${money.formatUsd(c.profit_usd_cents)}</div>
          ${c.is_accrued ? `<span class="badge in_stock">جاري التحصيل</span>` : ""}
        </div>
      </div>`
          )
          .join("")
      : '<p style="color:var(--text-dim)">ما فيه سيارات مباعة بهذه الفترة</p>';

    const agingRows = aging.length
      ? aging
          .map((a) => {
            const runningCost = a.purchase_price_usd_cents + a.total_expenses_usd_cents;
            const stale = a.days_in_stock >= 60;
            return `
      <div class="list-item" data-car-id="${a.car_id}">
        <div>
          <div class="main">${a.make} ${a.model} ${a.year || ""}</div>
          <div class="sub">اشتُريت بتاريخ ${a.purchase_date}</div>
        </div>
        <div class="end">
          <div class="amt">${money.formatUsd(runningCost)}</div>
          <span class="badge ${stale ? "overdue" : "in_stock"}">${a.days_in_stock} يوم بالمخزون</span>
        </div>
      </div>`;
          })
          .join("")
      : '<p style="color:var(--text-dim)">لا توجد سيارات بالمخزون حالياً</p>';

    container.innerHTML = `
      <div class="topbar"><h1>📊 التقارير</h1></div>

      <div class="segmented">
        <button type="button" data-period="all" class="${period === "all" ? "active" : ""}">كل الفترة</button>
        <button type="button" data-period="month" class="${period === "month" ? "active" : ""}">هذا الشهر</button>
        <button type="button" data-period="year" class="${period === "year" ? "active" : ""}">هذا العام</button>
        <button type="button" data-period="custom" class="${period === "custom" ? "active" : ""}">نطاق مخصص</button>
      </div>

      ${
        period === "custom"
          ? `
      <div class="card" style="margin-bottom:16px">
        <div class="grid-2">
          <div class="field"><label>من تاريخ</label><input type="date" id="range-from" value="${customFrom}" /></div>
          <div class="field"><label>إلى تاريخ</label><input type="date" id="range-to" value="${customTo}" /></div>
        </div>
        <button type="button" class="btn secondary" id="apply-range-btn" style="margin-top:4px">تطبيق</button>
      </div>`
          : ""
      }

      <div class="card" style="background:linear-gradient(160deg,#17233f,#131c33);border-color:#2f3f68">
        <div style="color:var(--text-dim);font-size:0.85rem;font-weight:700;margin-bottom:4px">صافي الربح بهذه الفترة</div>
        <div style="font-size:2rem;font-weight:800;color:${profitPositive ? "var(--green)" : "var(--red)"};font-variant-numeric:tabular-nums">
          ${money.formatUsd(summary.profit_usd_cents)}
        </div>
        ${partnerRows ? `<div style="margin-top:10px">${partnerRows}</div>` : ""}
      </div>

      <div class="grid-2">
        <div class="stat">
          <div class="num">🚗 ${summary.cars_sold_count}</div>
          <div class="label">سيارات مباعة</div>
        </div>
        <div class="stat">
          <div class="num">${money.formatUsd(summary.avg_profit_usd_cents)}</div>
          <div class="label">متوسط الربح لكل سيارة</div>
        </div>
        <div class="stat">
          <div class="num">${money.formatUsd(summary.revenue_usd_cents)}</div>
          <div class="label">إجمالي الإيرادات</div>
        </div>
        <div class="stat">
          <div class="num">${money.formatUsd(summary.cost_usd_cents)}</div>
          <div class="label">إجمالي التكلفة</div>
        </div>
      </div>

      <h2>السيارات المباعة بهذه الفترة</h2>
      <div id="cars-sold-list">${carsRows}</div>

      <h2>📦 المخزون الحالي (الأقدم أولاً)</h2>
      <div id="aging-list">${agingRows}</div>
    `;

    container.querySelectorAll(".segmented button").forEach((btn) => {
      btn.addEventListener("click", () => {
        period = btn.dataset.period;
        load();
      });
    });

    const applyBtn = container.querySelector("#apply-range-btn");
    if (applyBtn) {
      applyBtn.addEventListener("click", () => {
        customFrom = container.querySelector("#range-from").value;
        customTo = container.querySelector("#range-to").value;
        load();
      });
    }

    container.querySelectorAll("#cars-sold-list [data-car-id], #aging-list [data-car-id]").forEach((row) => {
      row.addEventListener("click", () => {
        window.location.hash = `#/car/${row.dataset.carId}`;
      });
    });
  }

  await load();
};

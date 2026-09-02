function renderInstallmentRows(rows) {
  if (!rows.length) {
    return '<div class="empty-state"><span class="emoji">📅</span>لا توجد نتائج</div>';
  }
  return rows
    .map((r) => {
      const statusBadge = r.is_paid_off
        ? '<span class="badge ok">مكتمل</span>'
        : r.is_overdue
        ? '<span class="badge overdue">متأخر</span>'
        : '<span class="badge in_stock">جاري</span>';
      return `
    <div class="list-item" data-car-id="${r.car_id}">
      <div>
        <div class="main">${r.make} ${r.model} ${r.year || ""}</div>
        <div class="sub">${r.buyer_name || "بدون اسم مشتري"}</div>
      </div>
      <div class="end">
        <div class="amt">${money.formatUsd(r.remaining_usd_cents)}</div>
        ${statusBadge}
      </div>
    </div>`;
    })
    .join("");
}

Views.installments = async function (container) {
  const rows = await api.get("/reports/installments");

  container.innerHTML = `
    <div class="topbar"><h1>📅 الأقساط</h1></div>
    <input type="search" id="installments-search" placeholder="🔍 دوّر باسم المشتري أو السيارة..." style="margin-bottom:12px" />
    <div id="installments-list">${renderInstallmentRows(rows)}</div>
  `;

  function bindRowClicks() {
    container.querySelectorAll("#installments-list .list-item").forEach((item) => {
      item.addEventListener("click", () => {
        window.location.hash = `#/car/${item.dataset.carId}`;
      });
    });
  }
  bindRowClicks();

  container.querySelector("#installments-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = !q
      ? rows
      : rows.filter((r) =>
          [r.make, r.model, r.year, r.buyer_name]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)
        );
    container.querySelector("#installments-list").innerHTML = renderInstallmentRows(filtered);
    bindRowClicks();
  });
};

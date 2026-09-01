Views.installments = async function (container) {
  const rows = await api.get("/reports/installments");

  const list = rows.length
    ? rows
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
        .join("")
    : '<div class="empty-state"><span class="emoji">📅</span>لا توجد عقود تقسيط بعد</div>';

  container.innerHTML = `
    <div class="topbar"><h1>📅 الأقساط</h1></div>
    ${list}
  `;

  container.querySelectorAll(".list-item").forEach((item) => {
    item.addEventListener("click", () => {
      window.location.hash = `#/car/${item.dataset.carId}`;
    });
  });
};

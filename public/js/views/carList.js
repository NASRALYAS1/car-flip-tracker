const CAR_STATUS_LABELS = {
  in_stock: "بالمخزون",
  sold: "مباعة",
  traded: "مبدَّلة",
  archived: "مؤرشفة",
};

Views.carList = async function (container, status) {
  const cars = await api.get(`/cars?status=${status}`);

  const tabs = ["in_stock", "sold", "traded"]
    .map(
      (s) =>
        `<button class="${s === status ? "active" : ""}" data-status="${s}">${CAR_STATUS_LABELS[s]}</button>`
    )
    .join("");

  const list = cars.length
    ? cars
        .map((car) => {
          const sub = [car.year, car.color].filter(Boolean).join(" · ");
          return `
        <div class="list-item" data-id="${car.id}">
          <div>
            <div class="main">${car.make} ${car.model}</div>
            <div class="sub">${sub || car.purchase_date}</div>
          </div>
          <div class="end">
            <div class="amt">${money.formatUsd(car.purchase_price_usd_cents)}</div>
            <span class="badge ${car.status}">${CAR_STATUS_LABELS[car.status]}</span>
          </div>
        </div>`;
        })
        .join("")
    : `<div class="empty-state"><span class="emoji">🚗</span>لا توجد سيارات ${CAR_STATUS_LABELS[status]}</div>`;

  container.innerHTML = `
    <div class="topbar"><h1>السيارات</h1></div>
    <div class="segmented">${tabs}</div>
    <div id="car-list">${list}</div>
    <a href="#/add-car" class="btn fab">+ إضافة سيارة</a>
  `;

  container.querySelectorAll(".segmented button").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.hash = `#/cars/${btn.dataset.status}`;
    });
  });

  container.querySelectorAll(".list-item").forEach((item) => {
    item.addEventListener("click", () => {
      window.location.hash = `#/car/${item.dataset.id}`;
    });
  });
};

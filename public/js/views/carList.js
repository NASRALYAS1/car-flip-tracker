const CAR_STATUS_LABELS = {
  in_stock: "بالمخزون",
  sold: "مباعة",
  traded: "مبدَّلة",
  archived: "مؤرشفة",
};

function renderCarListItems(cars, status) {
  if (!cars.length) {
    return `<div class="empty-state"><span class="emoji">🚗</span>لا توجد نتائج</div>`;
  }
  return cars
    .map((car) => {
      const sub = [car.year, car.color].filter(Boolean).join(" · ");
      return `
    <div class="list-item" data-id="${car.id}">
      <div>
        <div class="main">${esc(car.make)} ${esc(car.model)}</div>
        <div class="sub">${esc(sub || car.purchase_date)}</div>
      </div>
      <div class="end">
        <div class="amt">${money.formatUsd(car.purchase_price_usd_cents)}</div>
        <span class="badge ${car.status}">${CAR_STATUS_LABELS[car.status]}</span>
      </div>
    </div>`;
    })
    .join("");
}

Views.carList = async function (container, status) {
  const cars = await api.get(`/cars?status=${status}`);

  const tabs = ["in_stock", "sold", "traded"]
    .map(
      (s) =>
        `<button class="${s === status ? "active" : ""}" data-status="${s}">${CAR_STATUS_LABELS[s]}</button>`
    )
    .join("");

  container.innerHTML = `
    <div class="topbar"><h1>السيارات</h1></div>
    <div class="segmented">${tabs}</div>
    <input type="search" id="car-search" placeholder="🔍 دوّر بالماركة، الموديل، اللون، رقم الشاصي..." style="margin-bottom:12px" />
    <div id="car-list">${cars.length ? renderCarListItems(cars, status) : `<div class="empty-state"><span class="emoji">🚗</span>لا توجد سيارات ${CAR_STATUS_LABELS[status]}</div>`}</div>
    <a href="#/add-car" class="btn fab">+ إضافة سيارة</a>
  `;

  container.querySelectorAll(".segmented button").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.hash = `#/cars/${btn.dataset.status}`;
    });
  });

  function bindRowClicks() {
    container.querySelectorAll("#car-list .list-item").forEach((item) => {
      item.addEventListener("click", () => {
        window.location.hash = `#/car/${item.dataset.id}`;
      });
    });
  }
  bindRowClicks();

  container.querySelector("#car-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = !q
      ? cars
      : cars.filter((car) =>
          [car.make, car.model, car.color, car.vin, car.year, car.seller_name]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)
        );
    container.querySelector("#car-list").innerHTML = renderCarListItems(filtered, status);
    bindRowClicks();
  });
};

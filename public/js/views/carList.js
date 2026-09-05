const CAR_STATUS_LABELS = {
  in_stock: "بالمخزون",
  sold: "مباعة",
  traded: "مبدَّلة",
  archived: "مؤرشفة",
};

// What the number on the left of a row should be depends on where the car is
// in its life. While it's in stock the only figure that exists yet is what it
// cost. Once it's sold, the cost is history and the question is whether the
// deal made or lost money — so the row switches to showing that outcome, and
// a losing deal is coloured red end to end (name included) so it can't be
// missed while scrolling a long list.
function carOutcome(car) {
  const profit = car.profit;
  if (!profit) {
    return {
      isLoss: false,
      label: "سعر الشراء",
      value: money.formatUsd(car.purchase_price_usd_cents),
      tone: "",
    };
  }
  const final = profit.final_profit_usd_cents;
  const isLoss = final < 0;
  return {
    isLoss,
    // An installment sale still being collected shows where the deal lands
    // once it's paid off, not the running accrual — a car sold for less than
    // it cost is a loss the day it's sold, however much has come in so far.
    label: isLoss ? "الخسارة" : profit.is_accrued ? "الربح المتوقع" : "الربح",
    value: money.formatUsd(Math.abs(final)),
    tone: isLoss ? "loss" : "gain",
  };
}

function countCars(n) {
  if (n === 1) return "سيارة واحدة";
  if (n === 2) return "سيارتين";
  if (n <= 10) return `${n} سيارات`;
  return `${n} سيارة`;
}

function renderCarListItems(cars, status) {
  if (!cars.length) {
    return `<div class="empty-state"><span class="emoji">🚗</span>لا توجد نتائج</div>`;
  }
  return cars
    .map((car) => {
      const sub = [car.year, car.color].filter(Boolean).join(" · ");
      const outcome = carOutcome(car);
      return `
    <div class="list-item car-row ${outcome.isLoss ? "loss" : ""}" data-id="${car.id}">
      <div class="who">
        <div class="main ${outcome.isLoss ? "loss" : ""}">${esc(car.make)} ${esc(car.model)}</div>
        <div class="sub">${esc(sub || car.purchase_date)}</div>
      </div>
      <div class="end">
        <div class="amt-label">${outcome.label}</div>
        <div class="amt ${outcome.tone}">${outcome.value}</div>
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

  const losses = cars.filter((car) => car.profit && car.profit.final_profit_usd_cents < 0);
  const lossBanner = losses.length
    ? `<div class="loss-summary">${countCars(losses.length)} بخسارة بهذي القائمة</div>`
    : "";

  container.innerHTML = `
    <div class="topbar"><h1>السيارات</h1></div>
    <div class="segmented">${tabs}</div>
    <input type="search" id="car-search" placeholder="🔍 دوّر بالماركة، الموديل، اللون، رقم الشاصي..." style="margin-bottom:12px" />
    ${lossBanner}
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

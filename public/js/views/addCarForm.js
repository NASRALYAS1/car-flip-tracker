Views.addCarForm = async function (container) {
  const today = new Date().toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="topbar">
      <span class="back" data-back>→</span>
      <h1>إضافة سيارة</h1>
    </div>
    <div id="form-error"></div>
    <form id="add-car-form">
      <div class="field"><label>الماركة</label><input name="make" required /></div>
      <div class="field"><label>الموديل</label><input name="model" required /></div>
      <div class="grid-2">
        <div class="field"><label>سنة الصنع</label><input type="number" name="year" /></div>
        <div class="field"><label>اللون</label><input name="color" /></div>
      </div>
      <div class="field"><label>العداد (كم)</label><input type="number" name="mileage" /></div>
      <div class="field"><label>رقم الشاصي (VIN)</label><input name="vin" /></div>
      <div class="field"><label>تاريخ الشراء</label><input type="date" name="purchase_date" value="${today}" required /></div>

      ${money.inputHtml("purchase_price", "سعر الشراء")}

      <div class="field"><label>اسم البائع</label><input name="seller_name" /></div>
      <div class="field"><label>هاتف البائع</label><input name="seller_contact" /></div>
      <div class="field"><label>ملاحظات الحالة</label><textarea name="condition_notes" rows="3"></textarea></div>

      <button type="submit" class="btn">حفظ السيارة</button>
    </form>
  `;

  money.bindInputToggle(container, "purchase_price");
  container.querySelector("[data-back]").addEventListener("click", () => history.back());

  const form = container.querySelector("#add-car-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const priceField = money.readField(fd, "purchase_price");
    if (!priceField) {
      container.querySelector("#form-error").innerHTML =
        '<div class="error-msg">سعر الشراء مطلوب</div>';
      return;
    }

    const payload = {
      make: fd.get("make"),
      model: fd.get("model"),
      year: fd.get("year") ? Number(fd.get("year")) : null,
      color: fd.get("color") || null,
      mileage: fd.get("mileage") ? Number(fd.get("mileage")) : null,
      vin: fd.get("vin") || null,
      purchase_date: fd.get("purchase_date"),
      seller_name: fd.get("seller_name") || null,
      seller_contact: fd.get("seller_contact") || null,
      condition_notes: fd.get("condition_notes") || null,
      ...priceField,
    };

    try {
      const car = await api.post("/cars", payload);
      window.location.hash = `#/car/${car.id}`;
    } catch (err) {
      container.querySelector("#form-error").innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });
};

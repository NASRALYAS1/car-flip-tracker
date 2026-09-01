Views.tradeForm = async function (container, carId) {
  const car = await api.get(`/cars/${carId}`);
  const today = new Date().toISOString().slice(0, 10);
  const totalExpenses = car.expenses.reduce((s, e) => s + e.amount_usd_cents, 0);
  const carriedCost = car.purchase_price_usd_cents + totalExpenses;

  container.innerHTML = `
    <div class="topbar">
      <span class="back" data-back>→</span>
      <h1>تبديل ${car.make} ${car.model}</h1>
    </div>
    <div id="form-error"></div>

    <div class="card">
      <p style="margin:0">تكلفة هذه السيارة حتى الآن (شراء + مصاريف): <strong>${money.formatUsd(carriedCost)}</strong></p>
      <p style="margin:4px 0 0;color:var(--text-dim);font-size:0.85rem">هذه التكلفة راح تنتقل للسيارة الجديدة (± فرق الفلوس)، بدون احتساب ربح وهمي.</p>
    </div>

    <h2>السيارة الجديدة الداخلة</h2>
    <form id="trade-form">
      <div class="field"><label>الماركة</label><input name="make" required /></div>
      <div class="field"><label>الموديل</label><input name="model" required /></div>
      <div class="grid-2">
        <div class="field"><label>سنة الصنع</label><input type="number" name="year" /></div>
        <div class="field"><label>اللون</label><input name="color" /></div>
      </div>
      <div class="field"><label>رقم الشاصي (VIN)</label><input name="vin" /></div>
      <div class="field"><label>تاريخ التبديل</label><input type="date" name="trade_date" value="${today}" required /></div>

      <h3>فرق الفلوس</h3>
      <div class="segmented">
        <button type="button" class="active" data-dir="none">بدون فرق</button>
        <button type="button" data-dir="paid">دفعنا فرق</button>
        <button type="button" data-dir="received">استلمنا فرق</button>
      </div>
      <input type="hidden" name="cash_direction" value="none" />
      <div id="cash-fields" class="hidden">
        ${money.inputHtml("cash_adjustment", "مبلغ الفرق", { required: false })}
      </div>

      <div class="field"><label>اسم الطرف الآخر</label><input name="other_party_name" /></div>
      <div class="field"><label>هاتف الطرف الآخر</label><input name="other_party_contact" /></div>
      <div class="field"><label>ملاحظات</label><textarea name="notes" rows="2"></textarea></div>

      <button type="submit" class="btn">تأكيد التبديل</button>
    </form>
  `;

  container.querySelector("[data-back]").addEventListener("click", () => history.back());
  money.bindInputToggle(container, "cash_adjustment");

  let direction = "none";
  const cashFields = container.querySelector("#cash-fields");
  container.querySelectorAll(".segmented button").forEach((btn) => {
    btn.addEventListener("click", () => {
      direction = btn.dataset.dir;
      container.querySelector('[name="cash_direction"]').value = direction;
      container.querySelectorAll(".segmented button").forEach((b) => b.classList.toggle("active", b === btn));
      cashFields.classList.toggle("hidden", direction === "none");
    });
  });

  const form = container.querySelector("#trade-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);

    const payload = {
      make: fd.get("make"),
      model: fd.get("model"),
      year: fd.get("year") ? Number(fd.get("year")) : null,
      color: fd.get("color") || null,
      vin: fd.get("vin") || null,
      trade_date: fd.get("trade_date"),
      cash_direction: direction,
      other_party_name: fd.get("other_party_name") || null,
      other_party_contact: fd.get("other_party_contact") || null,
      notes: fd.get("notes") || null,
    };

    if (direction !== "none") {
      const cashField = money.readField(fd, "cash_adjustment");
      if (!cashField) {
        container.querySelector("#form-error").innerHTML = '<div class="error-msg">مبلغ الفرق مطلوب</div>';
        return;
      }
      Object.assign(payload, cashField);
    }

    try {
      const newCar = await api.post(`/cars/${carId}/trade`, payload);
      window.location.hash = `#/car/${newCar.id}`;
    } catch (err) {
      container.querySelector("#form-error").innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });
};

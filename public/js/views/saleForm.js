Views.saleForm = async function (container, carId) {
  const car = await api.get(`/cars/${carId}`);
  const today = new Date().toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="topbar">
      <span class="back" data-back>→</span>
      <h1>بيع ${car.make} ${car.model}</h1>
    </div>
    <div id="form-error"></div>

    <div class="segmented">
      <button type="button" class="active" data-type="cash">بيع نقدي</button>
      <button type="button" data-type="installment">بيع بالتقسيط</button>
    </div>

    <form id="sale-form">
      <input type="hidden" name="sale_type" value="cash" />
      <div class="field"><label>تاريخ البيع</label><input type="date" name="sale_date" value="${today}" required /></div>
      ${money.inputHtml("sale_price", "سعر البيع الكلي")}

      <div id="installment-fields" class="hidden">
        ${money.inputHtml("down_payment", "المقدمة", { required: false })}
        <div class="field">
          <label>القسط الشهري المخطط (USD)</label>
          <input type="number" step="0.01" min="0" name="planned_monthly_installment_display" />
        </div>
      </div>

      <div class="field"><label>اسم المشتري</label><input name="buyer_name" /></div>
      <div class="field"><label>هاتف المشتري</label><input name="buyer_contact" /></div>
      <div class="field"><label>ملاحظات</label><textarea name="notes" rows="2"></textarea></div>

      <button type="submit" class="btn">تأكيد البيع</button>
    </form>
  `;

  container.querySelector("[data-back]").addEventListener("click", () => history.back());
  money.bindInputToggle(container, "sale_price");
  money.bindInputToggle(container, "down_payment");

  let saleType = "cash";
  const installmentFields = container.querySelector("#installment-fields");
  container.querySelectorAll(".segmented button").forEach((btn) => {
    btn.addEventListener("click", () => {
      saleType = btn.dataset.type;
      container.querySelector('[name="sale_type"]').value = saleType;
      container.querySelectorAll(".segmented button").forEach((b) => b.classList.toggle("active", b === btn));
      installmentFields.classList.toggle("hidden", saleType !== "installment");
    });
  });

  const form = container.querySelector("#sale-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const priceField = money.readField(fd, "sale_price");
    if (!priceField) {
      container.querySelector("#form-error").innerHTML = '<div class="error-msg">سعر البيع مطلوب</div>';
      return;
    }

    const payload = {
      sale_type: saleType,
      sale_date: fd.get("sale_date"),
      buyer_name: fd.get("buyer_name") || null,
      buyer_contact: fd.get("buyer_contact") || null,
      notes: fd.get("notes") || null,
      ...priceField,
    };

    if (saleType === "installment") {
      const downField = money.readField(fd, "down_payment");
      if (downField) Object.assign(payload, downField);
      const monthly = fd.get("planned_monthly_installment_display");
      if (!monthly) {
        container.querySelector("#form-error").innerHTML =
          '<div class="error-msg">القسط الشهري المخطط مطلوب لبيع التقسيط</div>';
        return;
      }
      payload.planned_monthly_installment_usd_cents = Math.round(parseFloat(monthly) * 100);
    }

    try {
      await api.post(`/cars/${carId}/sale`, payload);
      window.location.hash = `#/car/${carId}`;
    } catch (err) {
      container.querySelector("#form-error").innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });
};

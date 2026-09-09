// Mirrors the server's allowlist in src/routes/photos.ts. Checked here too so
// a 12MB photo is refused while it's still a thumbnail on screen, rather than
// after the car has already been created and the upload comes back rejected.
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

Views.addCarForm = async function (container) {
  const today = new Date().toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="topbar">
      <span class="back" data-back>→</span>
      <h1>إضافة سيارة</h1>
    </div>
    <div id="form-error"></div>
    <form id="add-car-form">
      <div class="field"><label>اسم السيارة</label><input name="name" required placeholder="تويوتا لاندكروزر برادو VXR" /></div>
      <div class="grid-2">
        <div class="field"><label>سنة الصنع</label><input type="number" name="year" /></div>
        <div class="field"><label>اللون</label><input name="color" /></div>
      </div>
      <div class="field"><label>العداد (كم) — اختياري</label><input type="number" name="mileage" /></div>
      <div class="field"><label>رقم الشاصي (VIN) — اختياري</label><input name="vin" /></div>
      <div class="field"><label>تاريخ الشراء</label><input type="date" name="purchase_date" value="${today}" required /></div>

      ${money.inputHtml("purchase_price", "سعر الشراء")}

      <div class="field"><label>اسم البائع</label><input name="seller_name" /></div>
      <div class="field"><label>هاتف البائع</label><input name="seller_contact" /></div>
      <div class="field"><label>ملاحظات الحالة</label><textarea name="condition_notes" rows="3"></textarea></div>

      <div class="field">
        <label>صور السيارة — اختياري</label>
        <div class="photo-picks hidden" id="photo-picks"></div>
        <input type="file" id="photo-input" accept="image/*" multiple class="hidden" />
        <button type="button" class="btn secondary" id="pick-photos-btn">📷 إضافة صور</button>
        <p class="picker-hint" id="picker-hint">تكدر تتركها الحين وتضيفها بعدين من صفحة السيارة.</p>
      </div>

      <button type="submit" class="btn" id="save-car-btn">حفظ السيارة</button>
    </form>
  `;

  money.bindInputToggle(container, "purchase_price");
  container.querySelector("[data-back]").addEventListener("click", () => history.back());

  // Photos are optional and the car is the thing that matters, so nothing
  // here can block saving: files are held in memory until the car exists
  // (the upload endpoint needs its id), and a file the server would reject
  // is caught at pick time rather than after the car has been created.
  const picked = [];
  const picksEl = container.querySelector("#photo-picks");
  const photoInput = container.querySelector("#photo-input");
  const hintEl = container.querySelector("#picker-hint");

  function countPhotos(n) {
    if (n === 1) return "صورة وحدة";
    if (n === 2) return "صورتين";
    if (n <= 10) return n + " صور";
    return n + " صورة";
  }

  function renderPicks() {
    picksEl.classList.toggle("hidden", picked.length === 0);
    picksEl.innerHTML = picked
      .map(
        (pick, i) => `
      <div class="pick">
        <img src="${pick.url}" alt="" />
        <button type="button" class="remove" data-remove="${i}" aria-label="حذف الصورة">✕</button>
      </div>`
      )
      .join("");
    hintEl.textContent = picked.length
      ? countPhotos(picked.length) + " راح تنرفع بعد حفظ السيارة."
      : "تكدر تتركها الحين وتضيفها بعدين من صفحة السيارة.";

    picksEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.remove);
        URL.revokeObjectURL(picked[i].url);
        picked.splice(i, 1);
        renderPicks();
      });
    });
  }

  container.querySelector("#pick-photos-btn").addEventListener("click", () => photoInput.click());

  photoInput.addEventListener("change", async () => {
    const rejected = [];
    for (const file of Array.from(photoInput.files || [])) {
      if (!PHOTO_TYPES.has(file.type)) {
        rejected.push(esc(file.name) + ": نوع الملف غير مدعوم");
        continue;
      }
      if (file.size > PHOTO_MAX_BYTES) {
        rejected.push(esc(file.name) + ": حجمها أكبر من 10 ميغابايت");
        continue;
      }
      picked.push({ file, url: URL.createObjectURL(file) });
    }
    // cleared so picking the same file again still fires a change event
    photoInput.value = "";
    renderPicks();
    if (rejected.length) await UI.alert("ما انضافت:\n\n" + rejected.join("\n"));
  });

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
      name: fd.get("name"),
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

    const saveBtn = container.querySelector("#save-car-btn");
    if (saveBtn.disabled) return; // a double tap shouldn't create the car twice
    saveBtn.disabled = true;
    saveBtn.textContent = "جاري الحفظ...";

    let car;
    try {
      car = await api.post("/cars", payload);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "حفظ السيارة";
      container.querySelector("#form-error").innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
      return;
    }

    // The car is saved from here on. A photo that fails to upload is worth
    // saying out loud, but it must never read as "the car wasn't saved" — so
    // it goes to the car's page either way, with a note about what to retry.
    const failed = [];
    for (let i = 0; i < picked.length; i++) {
      saveBtn.textContent = "جاري رفع الصورة " + (i + 1) + " من " + picked.length + "...";
      const body = new FormData();
      body.append("photo", picked[i].file);
      try {
        await api.post(`/cars/${car.id}/photos`, body);
      } catch (err) {
        failed.push(esc(picked[i].file.name) + ": " + esc(err.message));
      }
    }

    for (const pick of picked) URL.revokeObjectURL(pick.url);

    if (failed.length) {
      await UI.alert(
        "تم حفظ السيارة، بس " +
          (failed.length === 1 ? "صورة وحدة ما انرفعت" : "بعض الصور ما انرفعت") +
          ":\n\n" +
          failed.join("\n") +
          "\n\nتكدر تحاول ترفعها من صفحة السيارة."
      );
    }

    window.location.hash = `#/car/${car.id}`;
  });
};

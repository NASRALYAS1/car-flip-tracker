const money = {
  formatUsd(cents) {
    if (cents === null || cents === undefined) return "-";
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, "0");
    return `${sign}$${whole.toLocaleString("en-US")}.${frac}`;
  },

  lastRate() {
    return localStorage.getItem("last_exchange_rate") || "1310";
  },
  setLastRate(rate) {
    if (rate) localStorage.setItem("last_exchange_rate", String(rate));
  },

  // Renders a currency-aware money field: amount + USD/IQD select + (conditional) exchange rate.
  inputHtml(prefix, labelText, opts = {}) {
    const required = opts.required !== false;
    const defaultCurrency = opts.currency || "USD";
    return `
      <div class="field">
        <label>${labelText}</label>
        <div class="money-input">
          <input type="number" step="0.01" min="0" name="${prefix}_amount_display"
                 ${required ? "required" : ""} placeholder="0.00" autocomplete="off" />
          <select name="${prefix}_currency" data-money-currency="${prefix}">
            <option value="USD" ${defaultCurrency === "USD" ? "selected" : ""}>USD</option>
            <option value="IQD" ${defaultCurrency === "IQD" ? "selected" : ""}>IQD</option>
          </select>
        </div>
        <div class="exchange-rate-row ${defaultCurrency === "IQD" ? "show" : ""}" data-rate-row="${prefix}">
          <label>سعر الصرف اليوم (كم دينار = 1 دولار؟)</label>
          <input type="number" step="0.01" min="0" name="${prefix}_exchange_rate"
                 placeholder="مثلاً 1310" value="${money.lastRate()}" />
        </div>
      </div>`;
  },

  // Call after inserting inputHtml() into the DOM to wire the currency toggle.
  bindInputToggle(container, prefix) {
    const select = container.querySelector(`[data-money-currency="${prefix}"]`);
    const rateRow = container.querySelector(`[data-rate-row="${prefix}"]`);
    if (!select || !rateRow) return;
    select.addEventListener("change", () => {
      rateRow.classList.toggle("show", select.value === "IQD");
    });

    // A leftover/autofilled value in a number input doesn't get replaced by
    // typing unless it's selected first — without this, new digits get
    // inserted into whatever was already there (e.g. typing "2" into an
    // existing "999.96" silently produces "2999.96"). Select-all on focus
    // so typing always starts fresh.
    const amountInput = container.querySelector(`[name="${prefix}_amount_display"]`);
    if (amountInput) amountInput.addEventListener("focus", () => amountInput.select());
    const rateInput = container.querySelector(`[name="${prefix}_exchange_rate"]`);
    if (rateInput) rateInput.addEventListener("focus", () => rateInput.select());
  },

  // Reads a money field back out of a submitted form's FormData into the
  // {prefix}_amount / {prefix}_currency / {prefix}_exchange_rate shape the API expects.
  readField(formData, prefix) {
    const display = formData.get(`${prefix}_amount_display`);
    const currency = formData.get(`${prefix}_currency`) || "USD";
    const rate = formData.get(`${prefix}_exchange_rate`);
    if (display === null || display === "") return null;

    const amount = Math.round(parseFloat(display) * 100);
    const result = { [`${prefix}_amount`]: amount, [`${prefix}_currency`]: currency };
    if (currency === "IQD") {
      result[`${prefix}_exchange_rate`] = parseFloat(rate);
      money.setLastRate(rate);
    }
    return result;
  },
};

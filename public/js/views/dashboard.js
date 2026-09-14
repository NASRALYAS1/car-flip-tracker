Views.dashboard = async function (container) {
  const d = await api.get("/dashboard");
  renderDashboard(container, d);
};

// The dashboard answers two different questions about profit and used to blur
// them into one. "How much has this business made" is the lifetime total and
// never resets. "How much is there to share out" is what's been made since the
// partners last took their profit — that's the number they act on, so it leads,
// with each partner's cut of it and the button that records taking it. What
// each partner has already taken comes from the recorded distributions and is
// fixed; changing the split later doesn't rewrite it.
function renderDashboard(container, d) {
  const partners = d.partners || [];
  const active = partners.filter((p) => p.is_active);
  const total = d.total_profit_usd_cents || 0;
  // Fallbacks keep an older cached response (served offline) from breaking the
  // screen before the first fresh load.
  const pending = d.undistributed_profit_usd_cents ?? total;
  const last = d.last_distribution || null;
  const distributions = d.distributions || [];
  const stockCapital = d.stock_capital_usd_cents ?? d.in_stock_value_usd_cents ?? 0;
  const outstanding = d.outstanding_installments_usd_cents || 0;
  const color = (cents) => (cents >= 0 ? "var(--green)" : "var(--red)");

  const pendingRows = active
    .map(
      (p) => `
      <div class="card-row">
        <span class="label">حصة ${esc(p.display_name)}</span>
        <span class="value">${money.formatUsd(p.pending_share_usd_cents || 0)}</span>
      </div>`
    )
    .join("");

  const takenRows = partners
    .map(
      (p) => `
      <div class="card-row">
        <span class="label">${esc(p.display_name)}${p.is_active ? "" : ' <span class="partner-former">(شريك سابق)</span>'}</span>
        <span class="value">${money.formatUsd(p.received_usd_cents || 0)}</span>
      </div>`
    )
    .join("");

  let pendingFooter;
  if (pending > 0) {
    pendingFooter = `<button class="btn" id="distribute-btn" style="margin-top:12px">توزيع الأرباح</button>`;
  } else if (pending < 0) {
    pendingFooter = `<p class="dist-note">الأرقام نزلت بعد آخر توزيع (مثلاً مصروف منسي أو تعديل على صفقة)، فالتوزيع الجاي راح يكون أقل بهذا المبلغ.</p>`;
  } else {
    pendingFooter = `<p class="dist-note">ما فيه ربح جديد للتوزيع هسه.</p>`;
  }

  const historyHtml = distributions.length
    ? `
    <details class="dist-history">
      <summary>سجل التوزيعات (${distributions.length})</summary>
      ${distributions
        .map(
          (dist, i) => `
        <div class="card dist-item">
          <div class="card-row">
            <span class="label">${esc(dist.distribution_date)}${dist.recorded_by_name ? ` · سجّله ${esc(dist.recorded_by_name)}` : ""}</span>
            <span class="value">${money.formatUsd(dist.distributed_usd_cents)}</span>
          </div>
          ${(dist.shares || [])
            .map(
              (s) => `
            <div class="card-row sub">
              <span class="label">${esc(s.display_name)} (${formatPct(s.split_pct)}%)</span>
              <span class="value">${money.formatUsd(s.share_usd_cents)}</span>
            </div>`
            )
            .join("")}
          ${dist.notes ? `<p class="dist-note">${esc(dist.notes)}</p>` : ""}
          ${
            i === 0
              ? `<button class="btn secondary" data-delete-distribution="${dist.id}" style="margin-top:10px">حذف هذا التوزيع (إذا انسجل بالغلط)</button>`
              : ""
          }
        </div>`
        )
        .join("")}
    </details>`
    : "";

  container.innerHTML = `
    <div class="topbar"><h1>👋 أهلاً ${esc((appState.user && appState.user.display_name) || "")}</h1></div>

    <div class="card dist-hero">
      <div class="dist-title">الربح اللي ما توزع بعد</div>
      <div class="dist-amount" style="color:${color(pending)}">${money.formatUsd(pending)}</div>
      <div class="dist-sub">${last ? `آخر توزيع: ${esc(last.distribution_date)}` : "ما صار أي توزيع لحد الآن"}</div>
      <div class="dist-shares">${pendingRows}</div>
      ${pendingFooter}
    </div>

    <div class="card">
      <div class="card-row">
        <span class="label">إجمالي الربح من بداية الشغل</span>
        <span class="value" style="color:${color(total)}">${money.formatUsd(total)}</span>
      </div>
      ${distributions.length ? `<div class="dist-section-label">اللي أخذه كل شريك من التوزيعات</div>${takenRows}` : ""}
    </div>

    ${historyHtml}

    <h2>نظرة عامة</h2>
    <div class="grid-2">
      <div class="stat">
        <div class="num">🚗 ${d.in_stock_count || 0}</div>
        <div class="label">سيارات بالمخزون</div>
      </div>
      <div class="stat">
        <div class="num">${money.formatUsd(stockCapital)}</div>
        <div class="label">رأس المال بالمخزون</div>
      </div>
      <div class="stat">
        <div class="num green">✅ ${d.sold_this_month_count || 0}</div>
        <div class="label">مباعة هذا الشهر</div>
      </div>
      <div class="stat">
        <div class="num ${d.overdue_installments_count > 0 ? "amber" : ""}">${d.overdue_installments_count > 0 ? "⚠️" : "🎉"} ${d.overdue_installments_count || 0}</div>
        <div class="label">أقساط متأخرة</div>
      </div>
      <div class="stat wide">
        <div class="num">${money.formatUsd(outstanding)}</div>
        <div class="label">أقساط باقية على المشترين</div>
      </div>
    </div>

    ${
      d.overdue_installments_count > 0
        ? `<a href="#/installments" class="btn danger" style="margin-top:4px">⚠️ عرض الأقساط المتأخرة</a>`
        : ""
    }

    <div class="btn-row" style="margin-top:16px">
      <a href="#/add-car" class="btn">+ إضافة سيارة</a>
      <a href="#/cars" class="btn secondary">عرض السيارات</a>
    </div>
  `;

  const distributeBtn = container.querySelector("#distribute-btn");
  if (distributeBtn) {
    distributeBtn.addEventListener("click", async () => {
      const lines = active
        .map((p) => `${esc(p.display_name)}: ${money.formatUsd(p.pending_share_usd_cents || 0)}`)
        .join("\n");
      // Profit on paper isn't cash in the drawer. Money already spent on stock or
      // still owed by buyers can't also be handed to the partners, so the
      // confirmation puts both figures right beside the amount being taken.
      const message =
        `راح توزعون ${money.formatUsd(pending)}:\n${lines}\n\n` +
        `انتبهوا: ${money.formatUsd(stockCapital)} من فلوسكم محطوطة بالسيارات، و${money.formatUsd(outstanding)} أقساط بعدها ما انقبضت. ` +
        `تأكدوا عندكم كاش يكفي قبل التوزيع.`;
      if (!(await UI.confirm(message, { okText: "وزّع الأرباح" }))) return;

      distributeBtn.disabled = true;
      try {
        await api.post("/distributions", {
          expected_undistributed_usd_cents: pending,
          distribution_date: new Date().toISOString().slice(0, 10),
        });
      } catch (err) {
        await UI.alert(err.message);
      }
      await Views.dashboard(container);
    });
  }

  container.querySelectorAll("[data-delete-distribution]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await UI.confirm(
        "حذف آخر توزيع؟ المبلغ اللي توزع بي يرجع يبين كربح ما توزع بعد. استخدمه بس إذا التوزيع انسجل بالغلط.",
        { danger: true, okText: "حذف التوزيع" }
      );
      if (!ok) return;
      try {
        await api.del(`/distributions/${btn.dataset.deleteDistribution}`);
      } catch (err) {
        await UI.alert(err.message);
      }
      await Views.dashboard(container);
    });
  });
}

function formatPct(pct) {
  const n = Number(pct) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

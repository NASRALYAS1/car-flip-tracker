Views.debts = async function (container) {
  const data = await api.get("/debts");
  renderDebts(container, data);
};

function userName(id) {
  const u = appState.users.find((u) => u.id === id);
  return u ? u.display_name : "؟";
}

// Which currency should this pair's balance lead with? There's no single
// "original currency" for a net balance (it's a sum across possibly many
// transactions), so use whichever currency they most recently actually
// transacted in — entries are already sorted newest-first.
function latestEntryForPair(entries, userA, userB) {
  return entries.find(
    (e) =>
      (e.lender_user_id === userA && e.borrower_user_id === userB) ||
      (e.lender_user_id === userB && e.borrower_user_id === userA)
  );
}

function renderDebtEntries(entries) {
  if (!entries.length) return '<p style="color:var(--text-dim)">لا يوجد سجل بعد</p>';
  return entries
    .map((e) => {
      const label = e.entry_type === "loan" ? "سلفة" : "تسديد";
      return `
    <div class="list-item" data-debt-id="${e.id}">
      <div>
        <div class="main">${label}: ${e.lender_name} ← ${e.borrower_name}</div>
        <div class="sub">${e.entry_date}</div>
      </div>
      <div class="end">
        <div class="amt">${money.formatDual(e.amount_usd_cents, e)}</div>
      </div>
    </div>`;
    })
    .join("");
}

function renderDebts(container, data) {
  const balanceCards = data.net_balances
    .map((b) => {
      if (b.net_usd_cents === 0) {
        return `<div class="card"><p style="margin:0">لا يوجد رصيد مستحق بين ${userName(b.user_a)} و ${userName(b.user_b)}</p></div>`;
      }
      const creditor = b.net_usd_cents > 0 ? b.user_a : b.user_b;
      const debtor = b.net_usd_cents > 0 ? b.user_b : b.user_a;
      const latest = latestEntryForPair(data.entries, b.user_a, b.user_b);
      return `
      <div class="card">
        <p style="margin:0"><strong>${userName(debtor)}</strong> مديون لـ <strong>${userName(creditor)}</strong></p>
        <p style="margin:4px 0 0;font-size:1.2rem;color:var(--amber)">${money.formatDual(Math.abs(b.net_usd_cents), latest)}</p>
      </div>`;
    })
    .join("");

  const activeUsers = appState.users.filter((u) => u.is_active);

  container.innerHTML = `
    <div class="topbar"><h1>🤝 الديون بين الشريكين</h1></div>
    ${balanceCards}

    <div class="btn-row" style="margin:12px 0">
      <button class="btn secondary" id="toggle-debt-form">+ تسجيل سلفة أو تسديد</button>
      <button class="btn secondary" id="share-history-btn">📤 مشاركة السجل الكامل</button>
    </div>
    <div id="debt-form-wrap" class="hidden card">
      <form id="debt-form">
        <div class="field"><label>الطرف الأول</label>
          <select name="party_a">${activeUsers.map((u) => `<option value="${u.id}">${u.display_name}</option>`).join("")}</select>
        </div>
        <div class="field"><label>الطرف الثاني</label>
          <select name="party_b">${activeUsers.map((u, i) => `<option value="${u.id}" ${i === 1 ? "selected" : ""}>${u.display_name}</option>`).join("")}</select>
        </div>
        <div class="field"><label>شنو صار؟</label>
          <select name="entry_type">
            <option value="loan">الطرف الأول أقرض الطرف الثاني (سلفة جديدة)</option>
            <option value="repayment">الطرف الثاني سدّد (دفع) للطرف الأول</option>
          </select>
        </div>
        <p style="color:var(--text-dim);font-size:0.85rem;margin-top:-6px">
          مهم: خلي "الطرف الأول" و"الطرف الثاني" نفس الشخصين دائماً لنفس السلفة —
          سواء تسجل السلفة نفسها أو تسدد جزء منها بعدين، لا تبدلهم.
        </p>
        ${money.inputHtml("amount", "المبلغ")}
        <div class="field"><label>التاريخ</label><input type="date" name="entry_date" value="${new Date().toISOString().slice(0, 10)}" required /></div>
        <div class="field"><label>ملاحظات</label><input name="notes" /></div>
        <button type="submit" class="btn">حفظ</button>
      </form>
    </div>

    <h2>السجل (اضغط على أي قيد لعرض التفاصيل)</h2>
    <input type="search" id="debts-search" placeholder="🔍 دوّر بالاسم أو الملاحظات أو التاريخ..." style="margin-bottom:12px" />
    <div id="debts-list">${renderDebtEntries(data.entries)}</div>
    <div id="debts-msg"></div>
  `;

  container.querySelector("#toggle-debt-form").addEventListener("click", () => {
    container.querySelector("#debt-form-wrap").classList.toggle("hidden");
  });

  function bindEntryClicks() {
    container.querySelectorAll("#debts-list [data-debt-id]").forEach((row) => {
      row.addEventListener("click", () => {
        window.location.hash = `#/debt/${row.dataset.debtId}`;
      });
    });
  }
  bindEntryClicks();

  container.querySelector("#debts-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = !q
      ? data.entries
      : data.entries.filter((entry) =>
          [entry.lender_name, entry.borrower_name, entry.notes, entry.entry_date]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)
        );
    container.querySelector("#debts-list").innerHTML = renderDebtEntries(filtered);
    bindEntryClicks();
  });

  container.querySelector("#share-history-btn").addEventListener("click", () => {
    shareDebtsHistory(data);
  });

  async function refresh() {
    const fresh = await api.get("/debts");
    renderDebts(container, fresh);
  }

  const form = container.querySelector("#debt-form");
  money.bindInputToggle(form, "amount");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const amountField = money.readField(fd, "amount");
    if (!amountField) return;

    if (fd.get("party_a") === fd.get("party_b")) {
      await UI.alert("الطرف الأول والطرف الثاني يجب أن يكونوا مختلفين");
      return;
    }

    try {
      await api.post("/debts", {
        entry_type: fd.get("entry_type"),
        lender_user_id: Number(fd.get("party_a")),
        borrower_user_id: Number(fd.get("party_b")),
        entry_date: fd.get("entry_date"),
        notes: fd.get("notes") || null,
        ...amountField,
      });
      await refresh();
    } catch (err) {
      container.querySelector("#debts-msg").innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });
}

function buildDebtsHistoryText(data) {
  const businessName = (appState.settings && appState.settings.business_name) || "تجارة السيارات";
  const lines = [`📋 سجل الديون بين الشركاء — ${businessName}`, ""];

  lines.push("الأرصدة الحالية:");
  if (data.net_balances.length === 0) {
    lines.push("لا يوجد أي سجل بعد");
  }
  for (const b of data.net_balances) {
    if (b.net_usd_cents === 0) {
      lines.push(`- لا يوجد رصيد مستحق بين ${userName(b.user_a)} و ${userName(b.user_b)}`);
    } else {
      const creditor = b.net_usd_cents > 0 ? b.user_a : b.user_b;
      const debtor = b.net_usd_cents > 0 ? b.user_b : b.user_a;
      const latest = latestEntryForPair(data.entries, b.user_a, b.user_b);
      lines.push(
        `- ${userName(debtor)} مديون لـ ${userName(creditor)}: ${money.formatDualText(Math.abs(b.net_usd_cents), latest)}`
      );
    }
  }

  lines.push("", "تفاصيل القيود:");
  for (const e of data.entries) {
    const label = e.entry_type === "loan" ? "سلفة" : "تسديد";
    lines.push(`- ${e.entry_date} | ${label}: ${e.lender_name} ← ${e.borrower_name} | ${money.formatDualText(e.amount_usd_cents, e)}`);
  }

  return lines.join("\n");
}

async function shareDebtsHistory(data) {
  const text = buildDebtsHistoryText(data);
  if (navigator.share) {
    try {
      await navigator.share({ title: "سجل الديون بين الشركاء", text });
      return;
    } catch {
      // user cancelled the share sheet, or share failed — fall through to download
    }
  }
  downloadTextFile(`سجل-الديون-${new Date().toISOString().slice(0, 10)}.txt`, text);
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

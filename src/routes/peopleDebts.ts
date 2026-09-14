import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { formatUsd, parseMoneyField } from "../lib/money";

// mounted at /api/people-debts — the business's shared record of debts with
// people outside the partnership: customers who still owe on something, a
// mechanic the dealership owes, an old debt that predates this app. Every
// partner sees and edits the same list, which is the difference between this
// and partner_loans: that one is money moving between the partners
// themselves, this one is money moving between the business and everyone
// else. recorded_by is kept as an audit note (who entered this), never as a
// permission — it deliberately does not scope any query below.
//
// A debt can be repaid in parts. Each part is its own row in
// people_debt_payments, so the amount originally owed is never overwritten and
// the history of what came back, and when, stays intact. What is still owed is
// always the original amount minus those rows.
export const peopleDebtsRoutes = new Hono<AppEnv>();
peopleDebtsRoutes.use("*", requireAuth);

const DIRECTIONS = ["they_owe_us", "we_owe_them"] as const;

function isDirection(value: unknown): value is (typeof DIRECTIONS)[number] {
  return DIRECTIONS.includes(value as (typeof DIRECTIONS)[number]);
}

type DebtRow = Record<string, unknown> & { id: number; amount_usd_cents: number; is_settled: number };

type PaymentRow = {
  id: number;
  debt_id: number;
  payment_date: string;
  amount_amount: number;
  amount_currency: string;
  amount_exchange_rate: number | null;
  amount_usd_cents: number;
  notes: string | null;
  recorded_by: number | null;
  created_at: string;
};

async function paidSoFar(db: D1Database, debtId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(amount_usd_cents), 0) AS total FROM people_debt_payments WHERE debt_id = ?`)
    .bind(debtId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

peopleDebtsRoutes.get("/", async (c) => {
  const [debts, payments] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM people_debts ORDER BY is_settled ASC, debt_date DESC, id DESC`).all<DebtRow>(),
    c.env.DB.prepare(`SELECT * FROM people_debt_payments ORDER BY payment_date DESC, id DESC`).all<PaymentRow>(),
  ]);

  const byDebt = new Map<number, PaymentRow[]>();
  for (const p of payments.results ?? []) {
    const list = byDebt.get(p.debt_id) ?? [];
    list.push(p);
    byDebt.set(p.debt_id, list);
  }

  return c.json(
    (debts.results ?? []).map((d) => {
      const list = byDebt.get(d.id) ?? [];
      const paid = list.reduce((sum, p) => sum + p.amount_usd_cents, 0);
      return { ...d, payments: list, paid_usd_cents: paid, remaining_usd_cents: d.amount_usd_cents - paid };
    })
  );
});

peopleDebtsRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();

  const personName = String(body.person_name ?? "").trim();
  if (!personName) return c.json({ error: "اسم الشخص مطلوب" }, 400);
  if (!isDirection(body.direction)) return c.json({ error: "الاتجاه غير صحيح" }, 400);
  if (!body.debt_date) return c.json({ error: "التاريخ مطلوب" }, 400);

  let amount;
  try {
    amount = parseMoneyField(body, "amount");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO people_debts (
       recorded_by, direction, person_name, person_phone, person_address,
       reason, notes, amount_amount, amount_currency, amount_exchange_rate,
       amount_usd_cents, debt_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      c.get("userId"),
      body.direction,
      personName,
      body.person_phone || null,
      body.person_address || null,
      body.reason || null,
      body.notes || null,
      amount.amount,
      amount.currency,
      amount.exchangeRate,
      amount.usdCents,
      body.debt_date
    )
    .run();

  const row = await c.env.DB.prepare(`SELECT * FROM people_debts WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();
  return c.json(row, 201);
});

peopleDebtsRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = await c.env.DB.prepare(`SELECT * FROM people_debts WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return c.json({ error: "غير موجود" }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const field of ["person_name", "person_phone", "person_address", "reason", "notes", "debt_date"] as const) {
    if (field in body) {
      sets.push(`${field} = ?`);
      values.push(body[field] || null);
    }
  }
  if (isDirection(body.direction)) {
    sets.push("direction = ?");
    values.push(body.direction);
  }
  if ("amount_amount" in body || "amount_currency" in body) {
    const merged = {
      amount_amount: body.amount_amount ?? existing.amount_amount,
      amount_currency: body.amount_currency ?? existing.amount_currency,
      amount_exchange_rate: body.amount_exchange_rate ?? existing.amount_exchange_rate,
    };
    let amount;
    try {
      amount = parseMoneyField(merged, "amount");
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    // Part of it may already have been repaid. Lowering the debt below that
    // would leave it owing a negative amount.
    const paid = await paidSoFar(c.env.DB, id);
    if (amount.usdCents < paid) {
      return c.json({ error: `المبلغ ما يكدر يكون أقل من اللي انسدد (${formatUsd(paid)})` }, 400);
    }
    sets.push("amount_amount = ?", "amount_currency = ?", "amount_exchange_rate = ?", "amount_usd_cents = ?");
    values.push(amount.amount, amount.currency, amount.exchangeRate, amount.usdCents);
  }
  if ("is_settled" in body) {
    const settled = !!body.is_settled;
    sets.push("is_settled = ?", "settled_date = ?");
    values.push(settled ? 1 : 0, settled ? (body.settled_date as string) || new Date().toISOString().slice(0, 10) : null);
  }

  if (sets.length === 0) return c.json({ error: "لا يوجد شي للتعديل" }, 400);

  values.push(id);
  await c.env.DB.prepare(`UPDATE people_debts SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const row = await c.env.DB.prepare(`SELECT * FROM people_debts WHERE id = ?`).bind(id).first();
  return c.json(row);
});

peopleDebtsRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = await c.env.DB.prepare(`SELECT id FROM people_debts WHERE id = ?`)
    .bind(id)
    .first<{ id: number }>();
  if (!existing) return c.json({ error: "غير موجود" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM people_debt_payments WHERE debt_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM people_debts WHERE id = ?`).bind(id),
  ]);
  return c.json({ ok: true });
});

peopleDebtsRoutes.post("/:id/payments", async (c) => {
  const debtId = Number(c.req.param("id"));
  const debt = await c.env.DB.prepare(`SELECT id, amount_usd_cents FROM people_debts WHERE id = ?`)
    .bind(debtId)
    .first<{ id: number; amount_usd_cents: number }>();
  if (!debt) return c.json({ error: "غير موجود" }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  if (!body.payment_date) return c.json({ error: "تاريخ الدفعة مطلوب" }, 400);

  let amount;
  try {
    amount = parseMoneyField(body, "amount");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  if (amount.usdCents <= 0) {
    return c.json({ error: "مبلغ الدفعة يجب أن يكون أكبر من صفر" }, 400);
  }

  const remaining = debt.amount_usd_cents - (await paidSoFar(c.env.DB, debtId));
  if (remaining <= 0) return c.json({ error: "هذا الدين مسدد بالكامل" }, 400);
  // A debt can't be repaid by more than is owed: the surplus would have
  // nowhere to go, and the debt would read as owing a negative amount.
  if (amount.usdCents > remaining) {
    return c.json({ error: `المبلغ أكبر من الباقي (${formatUsd(remaining)})` }, 400);
  }

  const clearsDebt = amount.usdCents === remaining;
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO people_debt_payments (
         debt_id, payment_date, amount_amount, amount_currency, amount_exchange_rate,
         amount_usd_cents, notes, recorded_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      debtId,
      body.payment_date,
      amount.amount,
      amount.currency,
      amount.exchangeRate,
      amount.usdCents,
      body.notes || null,
      c.get("userId")
    ),
  ];
  // The payment that clears the debt marks it settled in the same transaction,
  // dated the day the last of the money came in.
  if (clearsDebt) {
    statements.push(
      c.env.DB.prepare(`UPDATE people_debts SET is_settled = 1, settled_date = ? WHERE id = ?`).bind(
        body.payment_date,
        debtId
      )
    );
  }
  await c.env.DB.batch(statements);

  if (amount.currency === "IQD" && amount.exchangeRate) {
    await c.env.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'last_exchange_rate'`)
      .bind(String(amount.exchangeRate))
      .run();
  }

  return c.json({ ok: true, remaining_usd_cents: remaining - amount.usdCents, is_settled: clearsDebt }, 201);
});

peopleDebtsRoutes.delete("/:id/payments/:paymentId", async (c) => {
  const debtId = Number(c.req.param("id"));
  const paymentId = Number(c.req.param("paymentId"));

  const payment = await c.env.DB.prepare(
    `SELECT id, amount_usd_cents FROM people_debt_payments WHERE id = ? AND debt_id = ?`
  )
    .bind(paymentId, debtId)
    .first<{ id: number; amount_usd_cents: number }>();
  if (!payment) return c.json({ error: "الدفعة غير موجودة" }, 404);

  const debt = await c.env.DB.prepare(`SELECT amount_usd_cents, is_settled FROM people_debts WHERE id = ?`)
    .bind(debtId)
    .first<{ amount_usd_cents: number; is_settled: number }>();
  if (!debt) return c.json({ error: "غير موجود" }, 404);

  const remainingAfter =
    debt.amount_usd_cents - ((await paidSoFar(c.env.DB, debtId)) - payment.amount_usd_cents);

  const statements = [c.env.DB.prepare(`DELETE FROM people_debt_payments WHERE id = ?`).bind(paymentId)];
  // Removing a payment that had cleared the debt means something is owed again.
  if (debt.is_settled && remainingAfter > 0) {
    statements.push(
      c.env.DB.prepare(`UPDATE people_debts SET is_settled = 0, settled_date = NULL WHERE id = ?`).bind(debtId)
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

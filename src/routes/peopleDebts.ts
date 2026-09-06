import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { parseMoneyField } from "../lib/money";

// mounted at /api/people-debts — the business's shared record of debts with
// people outside the partnership: customers who still owe on something, a
// mechanic the dealership owes, an old debt that predates this app. Every
// partner sees and edits the same list, which is the difference between this
// and partner_loans: that one is money moving between the partners
// themselves, this one is money moving between the business and everyone
// else. recorded_by is kept as an audit note (who entered this), never as a
// permission — it deliberately does not scope any query below.
export const peopleDebtsRoutes = new Hono<AppEnv>();
peopleDebtsRoutes.use("*", requireAuth);

const DIRECTIONS = ["they_owe_us", "we_owe_them"] as const;

function isDirection(value: unknown): value is (typeof DIRECTIONS)[number] {
  return DIRECTIONS.includes(value as (typeof DIRECTIONS)[number]);
}

peopleDebtsRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM people_debts ORDER BY is_settled ASC, debt_date DESC, id DESC`
  ).all();
  return c.json(results ?? []);
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

  await c.env.DB.prepare(`DELETE FROM people_debts WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { parseMoneyField } from "../lib/money";

// mounted at /api/personal-debts — each partner's own private record of
// debts with people outside the business. Every route below scopes to
// c.get("userId") from the session, never to anything the client sends, so
// one partner can never read, edit, or even detect another partner's rows.
export const personalDebtsRoutes = new Hono<AppEnv>();
personalDebtsRoutes.use("*", requireAuth);

personalDebtsRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM personal_debts WHERE owner_user_id = ?
     ORDER BY is_settled ASC, debt_date DESC, id DESC`
  )
    .bind(userId)
    .all();
  return c.json(results ?? []);
});

personalDebtsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<Record<string, unknown>>();

  const personName = String(body.person_name ?? "").trim();
  const direction = body.direction as string;
  if (!personName) return c.json({ error: "اسم الشخص مطلوب" }, 400);
  if (direction !== "they_owe_me" && direction !== "i_owe_them") {
    return c.json({ error: "الاتجاه غير صحيح" }, 400);
  }
  if (!body.debt_date) return c.json({ error: "التاريخ مطلوب" }, 400);

  let amount;
  try {
    amount = parseMoneyField(body, "amount");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO personal_debts (
       owner_user_id, direction, person_name, person_phone, person_address,
       reason, notes, amount_amount, amount_currency, amount_exchange_rate,
       amount_usd_cents, debt_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      userId,
      direction,
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

  const row = await c.env.DB.prepare(`SELECT * FROM personal_debts WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();
  return c.json(row, 201);
});

async function loadOwned(db: D1Database, id: number, userId: number) {
  return db
    .prepare(`SELECT * FROM personal_debts WHERE id = ? AND owner_user_id = ?`)
    .bind(id, userId)
    .first<{ id: number }>();
}

personalDebtsRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const existing = await loadOwned(c.env.DB, id, userId);
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
  if (body.direction === "they_owe_me" || body.direction === "i_owe_them") {
    sets.push("direction = ?");
    values.push(body.direction);
  }
  if ("amount_amount" in body || "amount_currency" in body) {
    const merged = {
      amount_amount: body.amount_amount ?? (existing as Record<string, unknown>).amount_amount,
      amount_currency: body.amount_currency ?? (existing as Record<string, unknown>).amount_currency,
      amount_exchange_rate: body.amount_exchange_rate ?? (existing as Record<string, unknown>).amount_exchange_rate,
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

  values.push(id, userId);
  await c.env.DB.prepare(`UPDATE personal_debts SET ${sets.join(", ")} WHERE id = ? AND owner_user_id = ?`)
    .bind(...values)
    .run();

  const row = await c.env.DB.prepare(`SELECT * FROM personal_debts WHERE id = ?`).bind(id).first();
  return c.json(row);
});

personalDebtsRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const existing = await loadOwned(c.env.DB, id, userId);
  if (!existing) return c.json({ error: "غير موجود" }, 404);

  await c.env.DB.prepare(`DELETE FROM personal_debts WHERE id = ? AND owner_user_id = ?`)
    .bind(id, userId)
    .run();
  return c.json({ ok: true });
});

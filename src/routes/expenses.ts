import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { parseMoneyField } from "../lib/money";

export const expenseRoutes = new Hono<AppEnv>();
expenseRoutes.use("*", requireAuth);

// mounted at /api/cars/:id/expenses
expenseRoutes.post("/", async (c) => {
  const carId = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  if (!body.description || !body.expense_date) {
    return c.json({ error: "الوصف وتاريخ المصروف مطلوبة" }, 400);
  }

  let amount;
  try {
    amount = parseMoneyField(body, "amount");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO expenses (
       car_id, description, amount_amount, amount_currency, amount_exchange_rate,
       amount_usd_cents, category, expense_date, added_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      carId,
      body.description,
      amount.amount,
      amount.currency,
      amount.exchangeRate,
      amount.usdCents,
      body.category ?? null,
      body.expense_date,
      c.get("userId")
    )
    .run();

  if (amount.currency === "IQD" && amount.exchangeRate) {
    await c.env.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'last_exchange_rate'`)
      .bind(String(amount.exchangeRate))
      .run();
  }

  const expense = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();

  return c.json(expense, 201);
});

// standalone routes mounted at /api/expenses/:id
export const expenseItemRoutes = new Hono<AppEnv>();
expenseItemRoutes.use("*", requireAuth);

expenseItemRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  const sets: string[] = [];
  const values: unknown[] = [];

  if ("description" in body) {
    sets.push("description = ?");
    values.push(body.description);
  }
  if ("category" in body) {
    sets.push("category = ?");
    values.push(body.category);
  }
  if ("expense_date" in body) {
    sets.push("expense_date = ?");
    values.push(body.expense_date);
  }
  if ("amount_amount" in body || "amount_currency" in body) {
    const existing = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    if (!existing) return c.json({ error: "المصروف غير موجود" }, 404);

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

  if (sets.length === 0) return c.json({ error: "لا يوجد شي للتعديل" }, 400);

  values.push(id);
  await c.env.DB.prepare(`UPDATE expenses SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const expense = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`).bind(id).first();
  return c.json(expense);
});

expenseItemRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`DELETE FROM expenses WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

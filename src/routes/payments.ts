import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { parseMoneyField } from "../lib/money";

// mounted at /api/sales/:id/payments
export const paymentRoutes = new Hono<AppEnv>();
paymentRoutes.use("*", requireAuth);

paymentRoutes.post("/", async (c) => {
  const saleId = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  if (!body.payment_date) {
    return c.json({ error: "تاريخ الدفعة مطلوب" }, 400);
  }

  const sale = await c.env.DB.prepare(`SELECT id FROM sales WHERE id = ?`)
    .bind(saleId)
    .first();
  if (!sale) return c.json({ error: "عقد البيع غير موجود" }, 404);

  let amount;
  try {
    amount = parseMoneyField(body, "amount");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  const receivedBy = body.received_by ? Number(body.received_by) : c.get("userId");

  const result = await c.env.DB.prepare(
    `INSERT INTO installment_payments (
       sale_id, payment_date, amount_amount, amount_currency,
       amount_exchange_rate, amount_usd_cents, received_by, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      saleId,
      body.payment_date,
      amount.amount,
      amount.currency,
      amount.exchangeRate,
      amount.usdCents,
      receivedBy,
      body.notes ?? null
    )
    .run();

  if (amount.currency === "IQD" && amount.exchangeRate) {
    await c.env.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'last_exchange_rate'`)
      .bind(String(amount.exchangeRate))
      .run();
  }

  const payment = await c.env.DB.prepare(`SELECT * FROM installment_payments WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();

  return c.json(payment, 201);
});

// standalone: /api/payments/:id
export const paymentItemRoutes = new Hono<AppEnv>();
paymentItemRoutes.use("*", requireAuth);

paymentItemRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`DELETE FROM installment_payments WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

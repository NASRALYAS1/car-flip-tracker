import { Hono } from "hono";
import type { AppEnv, SaleType } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { parseMoneyField } from "../lib/money";

// mounted at /api/cars/:id/sale
export const saleRoutes = new Hono<AppEnv>();
saleRoutes.use("*", requireAuth);

saleRoutes.post("/", async (c) => {
  const carId = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  const saleType = (body.sale_type as SaleType) ?? "cash";
  if (saleType !== "cash" && saleType !== "installment") {
    return c.json({ error: "sale_type يجب أن يكون cash أو installment" }, 400);
  }
  if (!body.sale_date) {
    return c.json({ error: "تاريخ البيع مطلوب" }, 400);
  }

  const car = await c.env.DB.prepare(`SELECT status FROM cars WHERE id = ?`)
    .bind(carId)
    .first<{ status: string }>();
  if (!car) return c.json({ error: "السيارة غير موجودة" }, 404);
  if (car.status !== "in_stock") {
    return c.json({ error: "هذه السيارة مو بالمخزون حالياً" }, 400);
  }

  let price;
  try {
    price = parseMoneyField(body, "sale_price");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  let downPayment = { amount: null as number | null, currency: null as string | null, exchangeRate: null as number | null, usdCents: 0 };
  if (body.down_payment_amount !== undefined && body.down_payment_amount !== null && body.down_payment_amount !== "") {
    try {
      const dp = parseMoneyField(body, "down_payment");
      downPayment = dp;
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }

  let plannedMonthly: number | null = null;
  if (saleType === "installment") {
    plannedMonthly = Number(body.planned_monthly_installment_usd_cents);
    if (!Number.isFinite(plannedMonthly) || plannedMonthly <= 0) {
      return c.json({ error: "القسط الشهري المخطط مطلوب لبيع التقسيط" }, 400);
    }
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO sales (
       car_id, sale_type, sale_date, sale_price_amount, sale_price_currency,
       sale_price_exchange_rate, sale_price_usd_cents,
       down_payment_amount, down_payment_currency, down_payment_exchange_rate,
       down_payment_usd_cents, planned_monthly_installment_usd_cents,
       buyer_name, buyer_contact, notes, sold_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      carId,
      saleType,
      body.sale_date,
      price.amount,
      price.currency,
      price.exchangeRate,
      price.usdCents,
      downPayment.amount,
      downPayment.currency,
      downPayment.exchangeRate,
      downPayment.usdCents,
      plannedMonthly,
      body.buyer_name ?? null,
      body.buyer_contact ?? null,
      body.notes ?? null,
      c.get("userId")
    )
    .run();

  await c.env.DB.prepare(
    `UPDATE cars SET status = 'sold', updated_at = datetime('now') WHERE id = ?`
  )
    .bind(carId)
    .run();

  if (price.currency === "IQD" && price.exchangeRate) {
    await c.env.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'last_exchange_rate'`)
      .bind(String(price.exchangeRate))
      .run();
  }

  const sale = await c.env.DB.prepare(`SELECT * FROM sales WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();

  return c.json(sale, 201);
});

saleRoutes.patch("/", async (c) => {
  const carId = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  const sale = await c.env.DB.prepare(`SELECT * FROM sales WHERE car_id = ?`)
    .bind(carId)
    .first<Record<string, unknown>>();
  if (!sale) return c.json({ error: "لا يوجد بيع لهذه السيارة" }, 404);

  const sets: string[] = [];
  const values: unknown[] = [];

  for (const field of ["sale_date", "buyer_name", "buyer_contact", "notes"] as const) {
    if (field in body) {
      sets.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if ("sale_price_amount" in body || "sale_price_currency" in body) {
    const merged = {
      sale_price_amount: body.sale_price_amount ?? sale.sale_price_amount,
      sale_price_currency: body.sale_price_currency ?? sale.sale_price_currency,
      sale_price_exchange_rate: body.sale_price_exchange_rate ?? sale.sale_price_exchange_rate,
    };
    let price;
    try {
      price = parseMoneyField(merged, "sale_price");
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    sets.push(
      "sale_price_amount = ?",
      "sale_price_currency = ?",
      "sale_price_exchange_rate = ?",
      "sale_price_usd_cents = ?"
    );
    values.push(price.amount, price.currency, price.exchangeRate, price.usdCents);
  }

  if ("planned_monthly_installment_usd_cents" in body) {
    sets.push("planned_monthly_installment_usd_cents = ?");
    values.push(Number(body.planned_monthly_installment_usd_cents));
  }

  if (sets.length === 0) return c.json({ error: "لا يوجد شي للتعديل" }, 400);

  values.push(sale.id);
  await c.env.DB.prepare(`UPDATE sales SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await c.env.DB.prepare(`SELECT * FROM sales WHERE id = ?`)
    .bind(sale.id)
    .first();
  return c.json(updated);
});

saleRoutes.delete("/", async (c) => {
  const carId = Number(c.req.param("id"));

  const sale = await c.env.DB.prepare(`SELECT id FROM sales WHERE car_id = ?`)
    .bind(carId)
    .first<{ id: number }>();
  if (!sale) return c.json({ error: "لا يوجد بيع لهذه السيارة" }, 404);

  await c.env.DB.prepare(`DELETE FROM sales WHERE id = ?`).bind(sale.id).run();
  await c.env.DB.prepare(
    `UPDATE cars SET status = 'in_stock', updated_at = datetime('now') WHERE id = ?`
  )
    .bind(carId)
    .run();

  return c.json({ ok: true });
});

import { Hono } from "hono";
import type { AppEnv, CarStatus } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { parseMoneyField } from "../lib/money";
import { getChainForCar } from "../lib/chain";

export const carsRoutes = new Hono<AppEnv>();
carsRoutes.use("*", requireAuth);

carsRoutes.get("/", async (c) => {
  const status = c.req.query("status") as CarStatus | undefined;
  const query = status
    ? c.env.DB.prepare(`SELECT * FROM cars WHERE status = ? ORDER BY purchase_date DESC`).bind(
        status
      )
    : c.env.DB.prepare(`SELECT * FROM cars ORDER BY purchase_date DESC`);

  const { results } = await query.all();
  return c.json(results ?? []);
});

carsRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();

  if (!body.make || !body.model || !body.purchase_date) {
    return c.json({ error: "الماركة والموديل وتاريخ الشراء مطلوبة" }, 400);
  }

  let price;
  try {
    price = parseMoneyField(body, "purchase_price");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO cars (
       make, model, year, vin, color, mileage, purchase_date,
       purchase_price_amount, purchase_price_currency, purchase_price_exchange_rate,
       purchase_price_usd_cents, seller_name, seller_contact, condition_notes,
       status, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_stock', ?)`
  )
    .bind(
      body.make,
      body.model,
      body.year ?? null,
      body.vin ?? null,
      body.color ?? null,
      body.mileage ?? null,
      body.purchase_date,
      price.amount,
      price.currency,
      price.exchangeRate,
      price.usdCents,
      body.seller_name ?? null,
      body.seller_contact ?? null,
      body.condition_notes ?? null,
      c.get("userId")
    )
    .run();

  if (price.currency === "IQD" && price.exchangeRate) {
    await c.env.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'last_exchange_rate'`)
      .bind(String(price.exchangeRate))
      .run();
  }

  const car = await c.env.DB.prepare(`SELECT * FROM cars WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();

  return c.json(car, 201);
});

carsRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));

  const car = await c.env.DB.prepare(`SELECT * FROM cars WHERE id = ?`).bind(id).first();
  if (!car) return c.json({ error: "السيارة غير موجودة" }, 404);

  const [expenses, photos, sale] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM expenses WHERE car_id = ? ORDER BY expense_date DESC`)
      .bind(id)
      .all(),
    c.env.DB.prepare(`SELECT * FROM car_photos WHERE car_id = ? ORDER BY uploaded_at DESC`)
      .bind(id)
      .all(),
    c.env.DB.prepare(`SELECT * FROM sales WHERE car_id = ?`).bind(id).first(),
  ]);

  let payments: unknown[] = [];
  if (sale) {
    const paymentsRes = await c.env.DB.prepare(
      `SELECT * FROM installment_payments WHERE sale_id = ? ORDER BY payment_date DESC`
    )
      .bind((sale as { id: number }).id)
      .all();
    payments = paymentsRes.results ?? [];
  }

  const chain = await getChainForCar(c.env.DB, id);

  return c.json({
    ...car,
    expenses: expenses.results ?? [],
    photos: photos.results ?? [],
    sale: sale ?? null,
    installment_payments: payments,
    chain,
  });
});

carsRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  const editable = [
    "make",
    "model",
    "year",
    "vin",
    "color",
    "mileage",
    "seller_name",
    "seller_contact",
    "condition_notes",
  ] as const;

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of editable) {
    if (field in body) {
      sets.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (sets.length === 0) return c.json({ error: "لا يوجد شي للتعديل" }, 400);

  sets.push(`updated_at = datetime('now')`);
  values.push(id);

  await c.env.DB.prepare(`UPDATE cars SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const car = await c.env.DB.prepare(`SELECT * FROM cars WHERE id = ?`).bind(id).first();
  return c.json(car);
});

carsRoutes.post("/:id/archive", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(
    `UPDATE cars SET status = 'archived', updated_at = datetime('now') WHERE id = ?`
  )
    .bind(id)
    .run();
  return c.json({ ok: true });
});

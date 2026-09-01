import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { parseMoneyField } from "../lib/money";
import { getChainForCar } from "../lib/chain";

// mounted at /api/cars/:id/trade and /api/cars/:id/chain
export const tradeRoutes = new Hono<AppEnv>();
tradeRoutes.use("*", requireAuth);

tradeRoutes.get("/chain", async (c) => {
  const carId = Number(c.req.param("id"));
  const chain = await getChainForCar(c.env.DB, carId);
  return c.json(chain);
});

tradeRoutes.post("/trade", async (c) => {
  const outgoingCarId = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  if (!body.make || !body.model || !body.trade_date) {
    return c.json({ error: "بيانات السيارة الجديدة وتاريخ التبديل مطلوبة" }, 400);
  }

  const outgoingCar = await c.env.DB.prepare(
    `SELECT id, status, purchase_price_usd_cents FROM cars WHERE id = ?`
  )
    .bind(outgoingCarId)
    .first<{ id: number; status: string; purchase_price_usd_cents: number }>();

  if (!outgoingCar) return c.json({ error: "السيارة غير موجودة" }, 404);
  if (outgoingCar.status !== "in_stock") {
    return c.json({ error: "هذه السيارة مو بالمخزون حالياً" }, 400);
  }

  const expensesRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount_usd_cents), 0) AS total FROM expenses WHERE car_id = ?`
  )
    .bind(outgoingCarId)
    .first<{ total: number }>();
  const outgoingExpenses = expensesRow?.total ?? 0;
  const carriedCost = outgoingCar.purchase_price_usd_cents + outgoingExpenses;

  const cashDirection = (body.cash_direction as string) ?? "none"; // 'paid' | 'received' | 'none'
  let cashAdjustment = { amount: 0, currency: "USD" as "USD" | "IQD", exchangeRate: null as number | null, usdCents: 0 };
  if (cashDirection === "paid" || cashDirection === "received") {
    try {
      cashAdjustment = parseMoneyField(body, "cash_adjustment");
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    if (cashDirection === "received") {
      cashAdjustment = { ...cashAdjustment, usdCents: -cashAdjustment.usdCents };
    }
  }

  const newCarCostUsdCents = carriedCost + cashAdjustment.usdCents;
  if (newCarCostUsdCents < 0) {
    return c.json({ error: "التكلفة المحسوبة للسيارة الجديدة سالبة، تحقق من فرق الفلوس" }, 400);
  }

  const userId = c.get("userId");

  // 1) create the new incoming car (cost carried forward, no fabricated profit)
  const newCarResult = await c.env.DB.prepare(
    `INSERT INTO cars (
       make, model, year, vin, color, mileage, purchase_date,
       purchase_price_amount, purchase_price_currency, purchase_price_exchange_rate,
       purchase_price_usd_cents, condition_notes, status, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', NULL, ?, ?, 'in_stock', ?)`
  )
    .bind(
      body.make,
      body.model,
      body.year ?? null,
      body.vin ?? null,
      body.color ?? null,
      body.mileage ?? null,
      body.trade_date,
      newCarCostUsdCents,
      newCarCostUsdCents,
      body.condition_notes ?? null,
      userId
    )
    .run();

  const newCarId = newCarResult.meta.last_row_id as number;

  // 2) record the trade linking outgoing -> incoming
  const tradeResult = await c.env.DB.prepare(
    `INSERT INTO trades (
       outgoing_car_id, incoming_car_id, cash_adjustment_amount, cash_adjustment_currency,
       cash_adjustment_exchange_rate, cash_adjustment_usd_cents, other_party_name,
       other_party_contact, trade_date, notes, recorded_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      outgoingCarId,
      newCarId,
      cashAdjustment.amount,
      cashAdjustment.currency,
      cashAdjustment.exchangeRate,
      cashAdjustment.usdCents,
      body.other_party_name ?? null,
      body.other_party_contact ?? null,
      body.trade_date,
      body.notes ?? null,
      userId
    )
    .run();

  const tradeId = tradeResult.meta.last_row_id;

  // 3) link the new car back to the trade, and close out the outgoing car
  await c.env.DB.prepare(`UPDATE cars SET acquired_via_trade_id = ? WHERE id = ?`)
    .bind(tradeId, newCarId)
    .run();
  await c.env.DB.prepare(
    `UPDATE cars SET status = 'traded', updated_at = datetime('now') WHERE id = ?`
  )
    .bind(outgoingCarId)
    .run();

  const newCar = await c.env.DB.prepare(`SELECT * FROM cars WHERE id = ?`).bind(newCarId).first();
  return c.json(newCar, 201);
});

// undoes a trade recorded by mistake — only allowed while the incoming car
// is still untouched (still in stock, no expenses/photos logged on it yet)
// so this can never silently destroy real bookkeeping.
tradeRoutes.delete("/trade", async (c) => {
  const outgoingCarId = Number(c.req.param("id"));

  const trade = await c.env.DB.prepare(`SELECT * FROM trades WHERE outgoing_car_id = ?`)
    .bind(outgoingCarId)
    .first<{ id: number; incoming_car_id: number }>();
  if (!trade) return c.json({ error: "لا يوجد تبديل مسجل لهذه السيارة" }, 404);

  const incomingCarId = trade.incoming_car_id;
  const incomingCar = await c.env.DB.prepare(`SELECT status FROM cars WHERE id = ?`)
    .bind(incomingCarId)
    .first<{ status: string }>();

  if (!incomingCar || incomingCar.status !== "in_stock") {
    return c.json(
      { error: "ما تكدر تلغي هذا التبديل — حالة السيارة الجديدة تغيّرت (مباعة أو مبدَّلة ثانية)" },
      400
    );
  }

  const [expenseCount, photoCount] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM expenses WHERE car_id = ?`)
      .bind(incomingCarId)
      .first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM car_photos WHERE car_id = ?`)
      .bind(incomingCarId)
      .first<{ n: number }>(),
  ]);
  if ((expenseCount?.n ?? 0) > 0 || (photoCount?.n ?? 0) > 0) {
    return c.json(
      { error: "ما تكدر تلغي هذا التبديل — تمت إضافة مصاريف أو صور على السيارة الجديدة" },
      400
    );
  }

  await c.env.DB.prepare(`DELETE FROM cars WHERE id = ?`).bind(incomingCarId).run();
  await c.env.DB.prepare(`DELETE FROM trades WHERE id = ?`).bind(trade.id).run();
  await c.env.DB.prepare(
    `UPDATE cars SET status = 'in_stock', updated_at = datetime('now') WHERE id = ?`
  )
    .bind(outgoingCarId)
    .run();

  return c.json({ ok: true });
});

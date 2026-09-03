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

  // Onboarding an installment sale that was already part-way paid before
  // this app existed: rather than making someone re-enter months of past
  // payments one by one, they give a single lump total plus the date of the
  // last payment they actually received. It's stored as one normal payment
  // row, so every balance/progress/overdue calculation downstream treats it
  // like any other payment with no special-casing — and the date keeps the
  // overdue check honest instead of dating it to the original sale.
  if (
    saleType === "installment" &&
    body.prior_paid_amount !== undefined &&
    body.prior_paid_amount !== null &&
    body.prior_paid_amount !== ""
  ) {
    let priorPaid;
    try {
      priorPaid = parseMoneyField(body, "prior_paid");
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }

    if (priorPaid.usdCents > 0) {
      if (!body.prior_paid_date) {
        return c.json({ error: "تاريخ آخر دفعة سابقة مطلوب" }, 400);
      }
      await c.env.DB.prepare(
        `INSERT INTO installment_payments (
           sale_id, payment_date, amount_amount, amount_currency,
           amount_exchange_rate, amount_usd_cents, received_by, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          result.meta.last_row_id,
          body.prior_paid_date,
          priorPaid.amount,
          priorPaid.currency,
          priorPaid.exchangeRate,
          priorPaid.usdCents,
          c.get("userId"),
          "دفعات سابقة قبل استخدام التطبيق"
        )
        .run();
    }
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

// Records a real payment that's *less* than the remaining balance and
// forgives the shortfall as a discount, for when a buyer wants to settle
// an installment plan early (often at a negotiated discount) instead of
// finishing out the planned monthly schedule. The actual cash received is
// still logged as a normal installment_payments row; only the gap between
// that and what was technically owed gets recorded as a discount.
saleRoutes.post("/settle", async (c) => {
  const carId = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  const sale = await c.env.DB.prepare(`SELECT * FROM sales WHERE car_id = ?`)
    .bind(carId)
    .first<Record<string, any>>();
  if (!sale) return c.json({ error: "لا يوجد بيع لهذه السيارة" }, 404);
  if (sale.sale_type !== "installment") {
    return c.json({ error: "هذا الإجراء فقط لعقود التقسيط" }, 400);
  }
  if (!body.payment_date) {
    return c.json({ error: "تاريخ الدفعة مطلوب" }, 400);
  }

  let amount;
  try {
    amount = parseMoneyField(body, "amount");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  if (amount.usdCents <= 0) {
    return c.json({ error: "المبلغ يجب أن يكون أكبر من صفر" }, 400);
  }

  const paidRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount_usd_cents), 0) AS total FROM installment_payments WHERE sale_id = ?`
  )
    .bind(sale.id)
    .first<{ total: number }>();
  const totalPaid = (sale.down_payment_usd_cents || 0) + (paidRow?.total ?? 0);
  const remaining = sale.sale_price_usd_cents - (sale.discount_usd_cents || 0) - totalPaid;

  if (remaining <= 0) {
    return c.json({ error: "ما فيه باقي على هذا العقد أصلاً" }, 400);
  }
  if (amount.usdCents >= remaining) {
    return c.json(
      { error: "هذا المبلغ يغطي كل الباقي — استخدم زر (دفع الباقي بالكامل) العادي بدون خصم" },
      400
    );
  }

  const discountNow = remaining - amount.usdCents;
  const receivedBy = body.received_by ? Number(body.received_by) : c.get("userId");

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO installment_payments (
         sale_id, payment_date, amount_amount, amount_currency,
         amount_exchange_rate, amount_usd_cents, received_by, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sale.id,
      body.payment_date,
      amount.amount,
      amount.currency,
      amount.exchangeRate,
      amount.usdCents,
      receivedBy,
      body.notes ?? null
    ),
    c.env.DB.prepare(
      `UPDATE sales SET discount_usd_cents = discount_usd_cents + ?, discount_notes = ?, discount_date = ? WHERE id = ?`
    ).bind(discountNow, body.notes ?? null, body.payment_date, sale.id),
  ]);

  if (amount.currency === "IQD" && amount.exchangeRate) {
    await c.env.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'last_exchange_rate'`)
      .bind(String(amount.exchangeRate))
      .run();
  }

  const updatedSale = await c.env.DB.prepare(`SELECT * FROM sales WHERE id = ?`)
    .bind(sale.id)
    .first();

  return c.json({ sale: updatedSale, discount_given_usd_cents: discountNow }, 201);
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

import { Hono } from "hono";
import type { AppEnv, CarStatus } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { parseMoneyField } from "../lib/money";
import { getChainForCar } from "../lib/chain";
import { computeProfit } from "../lib/profit";

export const carsRoutes = new Hono<AppEnv>();
carsRoutes.use("*", requireAuth);

// The list carries each sold car's profit alongside it, so the list screen
// can show — and colour — the outcome of a deal without a round trip per row.
// A car bought at 10,000 and sold at 8,000 has to be visible as a loss while
// scanning the list, not only after opening it.
const CAR_LIST_SELECT = `
  SELECT
    c.*,
    s.id AS _sale_id,
    s.sale_type AS _sale_type,
    s.sale_price_usd_cents AS _sale_price_usd_cents,
    COALESCE(s.discount_usd_cents, 0) AS _discount_usd_cents,
    COALESCE(s.down_payment_usd_cents, 0) AS _down_payment_usd_cents,
    COALESCE(e.total, 0) AS _expenses_usd_cents,
    COALESCE(p.total, 0) AS _installments_paid_usd_cents
  FROM cars c
  LEFT JOIN sales s ON s.car_id = c.id
  LEFT JOIN (SELECT car_id, SUM(amount_usd_cents) AS total FROM expenses GROUP BY car_id) e
    ON e.car_id = c.id
  LEFT JOIN (SELECT sale_id, SUM(amount_usd_cents) AS total FROM installment_payments GROUP BY sale_id) p
    ON p.sale_id = s.id
`;

type CarListRow = Record<string, unknown> & {
  _sale_id: number | null;
  _sale_type: string | null;
  _sale_price_usd_cents: number | null;
  _discount_usd_cents: number;
  _down_payment_usd_cents: number;
  _expenses_usd_cents: number;
  _installments_paid_usd_cents: number;
  purchase_price_usd_cents: number;
};

function withProfit(row: CarListRow) {
  const car: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith("_")) car[key] = value;
  }
  car.total_expenses_usd_cents = row._expenses_usd_cents;
  car.profit = row._sale_id
    ? computeProfit({
        sale_type: row._sale_type ?? "cash",
        sale_price_usd_cents: row._sale_price_usd_cents ?? 0,
        discount_usd_cents: row._discount_usd_cents,
        down_payment_usd_cents: row._down_payment_usd_cents,
        purchase_price_usd_cents: row.purchase_price_usd_cents,
        total_expenses_usd_cents: row._expenses_usd_cents,
        installments_paid_usd_cents: row._installments_paid_usd_cents,
      })
    : null;
  return car;
}

carsRoutes.get("/", async (c) => {
  const status = c.req.query("status") as CarStatus | undefined;
  const query = status
    ? c.env.DB.prepare(`${CAR_LIST_SELECT} WHERE c.status = ? ORDER BY c.purchase_date DESC`).bind(
        status
      )
    : c.env.DB.prepare(`${CAR_LIST_SELECT} ORDER BY c.purchase_date DESC`);

  const { results } = await query.all<CarListRow>();
  return c.json((results ?? []).map(withProfit));
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

  const expenseRows = expenses.results ?? [];
  const totalExpenses = expenseRows.reduce(
    (sum, e) => sum + Number((e as { amount_usd_cents: number }).amount_usd_cents),
    0
  );

  let profit = null;
  if (sale) {
    const s = sale as {
      sale_type: string;
      sale_price_usd_cents: number;
      discount_usd_cents: number;
      down_payment_usd_cents: number | null;
    };
    const installmentsPaid = (payments as { amount_usd_cents: number }[]).reduce(
      (sum, p) => sum + p.amount_usd_cents,
      0
    );
    profit = computeProfit({
      sale_type: s.sale_type,
      sale_price_usd_cents: s.sale_price_usd_cents,
      discount_usd_cents: s.discount_usd_cents || 0,
      down_payment_usd_cents: s.down_payment_usd_cents || 0,
      purchase_price_usd_cents: (car as { purchase_price_usd_cents: number }).purchase_price_usd_cents,
      total_expenses_usd_cents: totalExpenses,
      installments_paid_usd_cents: installmentsPaid,
    });
  }

  return c.json({
    ...car,
    expenses: expenseRows,
    photos: photos.results ?? [],
    sale: sale ?? null,
    installment_payments: payments,
    chain,
    profit,
  });
});

carsRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  const car = await c.env.DB.prepare(
    `SELECT id, acquired_via_trade_id FROM cars WHERE id = ?`
  )
    .bind(id)
    .first<{ id: number; acquired_via_trade_id: number | null }>();
  if (!car) return c.json({ error: "السيارة غير موجودة" }, 404);

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

  // Correcting a purchase price that was typed wrong is one of the most
  // common fixes on an already-recorded deal, so it's editable — but only
  // for a car that stands on its own. Inside a trade chain the purchase
  // price isn't a price at all: it's the cost carried forward from the car
  // before it, and it was already snapshotted into the car after it. Editing
  // it there would silently desync the chain's cost, so it's refused with an
  // explanation instead of quietly producing wrong profit downstream.
  if ("purchase_price_amount" in body || "purchase_price_currency" in body) {
    if (car.acquired_via_trade_id) {
      return c.json(
        { error: "ما تكدر تعدّل سعر الشراء لسيارة جاية من تبديل — تكلفتها منقولة من السيارة السابقة بالسلسلة" },
        400
      );
    }
    const outgoingTrade = await c.env.DB.prepare(
      `SELECT id FROM trades WHERE outgoing_car_id = ?`
    )
      .bind(id)
      .first<{ id: number }>();
    if (outgoingTrade) {
      return c.json(
        { error: "ما تكدر تعدّل سعر الشراء لسيارة تم تبديلها — تكلفتها منقولة للسيارة الجديدة بالسلسلة" },
        400
      );
    }

    let price;
    try {
      price = parseMoneyField(body, "purchase_price");
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    sets.push(
      "purchase_price_amount = ?",
      "purchase_price_currency = ?",
      "purchase_price_exchange_rate = ?",
      "purchase_price_usd_cents = ?"
    );
    values.push(price.amount, price.currency, price.exchangeRate, price.usdCents);
  }

  if (sets.length === 0) return c.json({ error: "لا يوجد شي للتعديل" }, 400);

  sets.push(`updated_at = datetime('now')`);
  values.push(id);

  await c.env.DB.prepare(`UPDATE cars SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await c.env.DB.prepare(`SELECT * FROM cars WHERE id = ?`).bind(id).first();
  return c.json(updated);
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

// Deleting a car erases the whole deal — the purchase, its expenses, its
// photos, its sale and every installment payment on it. It exists because a
// deal can be entered by mistake (wrong car, duplicate entry, a sale that
// never actually happened), and leaving it archived would keep dragging a
// fictional cost through every profit report.
//
// A car that's part of a trade chain is refused: its cost is either carried
// in from the car before it or already carried out into the car after it, so
// removing it mid-chain would leave the chain pointing at a car that no
// longer exists and the carried cost unaccounted for. The trade has to be
// undone first, which is a flow that already exists and already has its own
// safety checks.
carsRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));

  const car = await c.env.DB.prepare(
    `SELECT id, acquired_via_trade_id FROM cars WHERE id = ?`
  )
    .bind(id)
    .first<{ id: number; acquired_via_trade_id: number | null }>();
  if (!car) return c.json({ error: "السيارة غير موجودة" }, 404);

  if (car.acquired_via_trade_id) {
    return c.json(
      {
        error:
          "هذي السيارة جاية من تبديل — لازم تلغي التبديل من السيارة السابقة بالسلسلة قبل ما تحذفها",
      },
      400
    );
  }

  const outgoingTrade = await c.env.DB.prepare(
    `SELECT id FROM trades WHERE outgoing_car_id = ?`
  )
    .bind(id)
    .first<{ id: number }>();
  if (outgoingTrade) {
    return c.json(
      { error: "هذي السيارة مبدَّلة بسيارة ثانية — ألغِ التبديل أولاً، بعدها تكدر تحذفها" },
      400
    );
  }

  // R2 objects aren't covered by the database delete, so they'd be orphaned
  // and billed forever if they weren't removed here explicitly.
  const photos = await c.env.DB.prepare(`SELECT r2_key FROM car_photos WHERE car_id = ?`)
    .bind(id)
    .all<{ r2_key: string }>();
  for (const photo of photos.results ?? []) {
    await c.env.STORAGE.delete(photo.r2_key).catch(() => {
      // a missing object shouldn't block deleting the deal itself
    });
  }

  // Deleted explicitly, in dependency order, rather than leaning on the
  // schema's ON DELETE CASCADE — one batch, so a failure part-way through
  // can't leave a sale with no car or payments with no sale.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM installment_payments WHERE sale_id IN (SELECT id FROM sales WHERE car_id = ?)`
    ).bind(id),
    c.env.DB.prepare(`DELETE FROM sales WHERE car_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM expenses WHERE car_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM car_photos WHERE car_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM cars WHERE id = ?`).bind(id),
  ]);

  return c.json({ ok: true });
});

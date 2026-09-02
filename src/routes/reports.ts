import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";

export const reportsRoutes = new Hono<AppEnv>();
reportsRoutes.use("*", requireAuth);

reportsRoutes.get("/installments", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
       s.id AS sale_id, s.car_id, c.make, c.model, c.year,
       s.buyer_name, s.buyer_contact, s.sale_date,
       s.sale_price_usd_cents, s.down_payment_usd_cents, s.discount_usd_cents,
       s.planned_monthly_installment_usd_cents,
       MAX(ip.payment_date) AS last_payment_date,
       COALESCE(SUM(ip.amount_usd_cents), 0) AS paid_installments_usd_cents
     FROM sales s
     JOIN cars c ON c.id = s.car_id
     LEFT JOIN installment_payments ip ON ip.sale_id = s.id
     WHERE s.sale_type = 'installment'
     GROUP BY s.id
     ORDER BY s.sale_date DESC`
  ).all<Record<string, number | string | null>>();

  const rows = (results ?? []).map((r) => {
    const totalPaid =
      Number(r.down_payment_usd_cents ?? 0) + Number(r.paid_installments_usd_cents ?? 0);
    const remaining =
      Number(r.sale_price_usd_cents) - Number(r.discount_usd_cents ?? 0) - totalPaid;
    const plannedMonthly = Number(r.planned_monthly_installment_usd_cents ?? 0);
    const remainingInstallmentsEstimate =
      plannedMonthly > 0 ? Math.max(0, Math.ceil(remaining / plannedMonthly)) : null;

    const baseline = (r.last_payment_date as string | null) ?? (r.sale_date as string);
    const nextDue = new Date(baseline);
    nextDue.setMonth(nextDue.getMonth() + 1);
    const isOverdue = remaining > 0 && new Date() > nextDue;

    return {
      ...r,
      total_paid_usd_cents: totalPaid,
      remaining_usd_cents: remaining,
      remaining_installments_estimate: remainingInstallmentsEstimate,
      is_overdue: isOverdue,
      is_paid_off: remaining <= 0,
    };
  });

  return c.json(rows);
});

// Profit report over a date range (matched against sale_date), plus the
// same proportional partner split logic the dashboard uses for the
// lifetime total — applied here to just the period's profit.
reportsRoutes.get("/summary", async (c) => {
  const from = c.req.query("from") || "0000-01-01";
  const to = c.req.query("to") || "9999-12-31";

  const { results } = await c.env.DB.prepare(
    `SELECT c.id AS car_id, c.make, c.model, c.year, s.sale_date, s.buyer_name,
            cp.purchase_price_usd_cents, cp.total_expenses_usd_cents,
            cp.sale_price_usd_cents, s.discount_usd_cents, cp.profit_usd_cents
     FROM car_profit cp
     JOIN cars c ON c.id = cp.car_id
     JOIN sales s ON s.car_id = c.id
     WHERE cp.profit_usd_cents IS NOT NULL AND s.sale_date >= ? AND s.sale_date <= ?
     ORDER BY s.sale_date DESC`
  )
    .bind(from, to)
    .all<{
      car_id: number;
      make: string;
      model: string;
      year: number | null;
      sale_date: string;
      buyer_name: string | null;
      purchase_price_usd_cents: number;
      total_expenses_usd_cents: number;
      sale_price_usd_cents: number;
      discount_usd_cents: number;
      profit_usd_cents: number;
    }>();

  const cars = results ?? [];
  const revenue = cars.reduce((s, r) => s + (r.sale_price_usd_cents - r.discount_usd_cents), 0);
  const cost = cars.reduce((s, r) => s + r.purchase_price_usd_cents + r.total_expenses_usd_cents, 0);
  const profit = cars.reduce((s, r) => s + r.profit_usd_cents, 0);

  const { results: partnerRows } = await c.env.DB.prepare(
    `SELECT id, display_name, profit_split_pct FROM users WHERE is_active = 1 ORDER BY id`
  ).all<{ id: number; display_name: string; profit_split_pct: number }>();
  const partners = partnerRows ?? [];
  const totalPct = partners.reduce((s, p) => s + p.profit_split_pct, 0);

  let allocated = 0;
  const partnerShares = partners.map((p, i) => {
    const isLast = i === partners.length - 1;
    let share: number;
    if (isLast) {
      share = profit - allocated;
    } else if (totalPct > 0) {
      share = Math.round((profit * p.profit_split_pct) / totalPct);
    } else {
      share = Math.round(profit / partners.length);
    }
    allocated += share;
    return { user_id: p.id, display_name: p.display_name, split_pct: p.profit_split_pct, share_usd_cents: share };
  });

  return c.json({
    from,
    to,
    revenue_usd_cents: revenue,
    cost_usd_cents: cost,
    profit_usd_cents: profit,
    cars_sold_count: cars.length,
    avg_profit_usd_cents: cars.length ? Math.round(profit / cars.length) : 0,
    partner_shares: partnerShares,
    cars,
  });
});

// How long has each still-unsold car been sitting on the lot — capital
// tied up in slow-moving inventory is something a dealer wants visibility
// into, separate from any date range (it's always "as of right now").
reportsRoutes.get("/inventory-aging", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.id AS car_id, c.make, c.model, c.year, c.purchase_date,
            c.purchase_price_usd_cents,
            COALESCE(SUM(e.amount_usd_cents), 0) AS total_expenses_usd_cents,
            CAST(julianday('now') - julianday(c.purchase_date) AS INTEGER) AS days_in_stock
     FROM cars c
     LEFT JOIN expenses e ON e.car_id = c.id
     WHERE c.status = 'in_stock'
     GROUP BY c.id
     ORDER BY days_in_stock DESC`
  ).all();

  return c.json(results ?? []);
});

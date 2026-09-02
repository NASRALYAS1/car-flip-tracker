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

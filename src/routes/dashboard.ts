import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";

export const dashboardRoutes = new Hono<AppEnv>();
dashboardRoutes.use("*", requireAuth);

dashboardRoutes.get("/", async (c) => {
  const db = c.env.DB;

  const [profitRow, inStockRow, soldThisMonthRow, partnersRow, overdueRow] = await Promise.all([
    db
      .prepare(`SELECT COALESCE(SUM(profit_usd_cents), 0) AS total FROM car_profit WHERE profit_usd_cents IS NOT NULL`)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(purchase_price_usd_cents), 0) AS value
         FROM cars WHERE status = 'in_stock'`
      )
      .first<{ count: number; value: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM sales
         WHERE strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now')`
      )
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT id, display_name, profit_split_pct FROM users WHERE is_active = 1 ORDER BY id`
      )
      .all<{ id: number; display_name: string; profit_split_pct: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sales s
         JOIN cars c ON c.id = s.car_id
         LEFT JOIN installment_payments ip ON ip.sale_id = s.id
         WHERE s.sale_type = 'installment'
         GROUP BY s.id
         HAVING (s.sale_price_usd_cents - s.discount_usd_cents - s.down_payment_usd_cents - COALESCE(SUM(ip.amount_usd_cents), 0)) > 0
           AND julianday('now') - julianday(COALESCE(MAX(ip.payment_date), s.sale_date)) > 30`
      )
      .all<{ count: number }>(),
  ]);

  const totalProfit = profitRow?.total ?? 0;
  const partners = partnersRow.results ?? [];
  // normalize against whatever the active partners' percentages actually sum
  // to, rather than assuming exactly 100 — stays correct right after a
  // partner is added (0%) or deactivated without forcing an immediate
  // "fix the split" step.
  const totalPct = partners.reduce((s, p) => s + p.profit_split_pct, 0);

  let allocated = 0;
  const partnerShares = partners.map((p, i) => {
    const isLast = i === partners.length - 1;
    let share: number;
    if (isLast) {
      share = totalProfit - allocated;
    } else if (totalPct > 0) {
      share = Math.round((totalProfit * p.profit_split_pct) / totalPct);
    } else {
      share = Math.round(totalProfit / partners.length);
    }
    allocated += share;
    return {
      user_id: p.id,
      display_name: p.display_name,
      split_pct: p.profit_split_pct,
      share_usd_cents: share,
    };
  });

  return c.json({
    total_profit_usd_cents: totalProfit,
    partner_shares: partnerShares,
    in_stock_count: inStockRow?.count ?? 0,
    in_stock_value_usd_cents: inStockRow?.value ?? 0,
    sold_this_month_count: soldThisMonthRow?.count ?? 0,
    overdue_installments_count: overdueRow.results?.length ?? 0,
  });
});

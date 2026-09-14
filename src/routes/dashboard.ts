import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { installmentState } from "../lib/installments";
import { distributionOverview, lifetimeRealizedProfit, listDistributions } from "../lib/distributions";

export const dashboardRoutes = new Hono<AppEnv>();
dashboardRoutes.use("*", requireAuth);

dashboardRoutes.get("/", async (c) => {
  const db = c.env.DB;

  const lifetimeProfit = await lifetimeRealizedProfit(db);

  const [overview, distributions, stockRow, soldThisMonthRow, installmentRows] = await Promise.all([
    distributionOverview(db, lifetimeProfit),
    listDistributions(db),
    // Capital sitting in cars that haven't been sold: what they cost plus what
    // has been spent on them since. Expenses used to be left out, so three cars
    // bought at 10,000 with 1,000 spent on each showed 30,000 when 33,000 was
    // really tied up. Archived cars are hidden from the stock list but are still
    // the business's money, so they count here too.
    db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN c.status = 'in_stock' THEN 1 ELSE 0 END), 0) AS in_stock_count,
           COALESCE(SUM(CASE WHEN c.status = 'archived' THEN 1 ELSE 0 END), 0) AS archived_count,
           COALESCE(SUM(c.purchase_price_usd_cents
             + COALESCE((SELECT SUM(e.amount_usd_cents) FROM expenses e WHERE e.car_id = c.id), 0)), 0) AS capital
         FROM cars c
         WHERE c.status IN ('in_stock', 'archived')`
      )
      .first<{ in_stock_count: number; archived_count: number; capital: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM sales
         WHERE strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now')`
      )
      .first<{ count: number }>(),
    // Counted in JS through the shared rule rather than a second SQL one: this
    // used to say "more than 30 days", while the car page and the nightly
    // reminder said "more than one month", so the badge here could disagree
    // with the car it was pointing at.
    db
      .prepare(
        `SELECT s.sale_price_usd_cents, s.discount_usd_cents, s.down_payment_usd_cents,
                s.sale_date,
                MAX(ip.payment_date) AS last_payment_date,
                COALESCE(SUM(ip.amount_usd_cents), 0) AS paid_usd_cents
         FROM sales s
         LEFT JOIN installment_payments ip ON ip.sale_id = s.id
         WHERE s.sale_type = 'installment'
         GROUP BY s.id`
      )
      .all<{
        sale_price_usd_cents: number;
        discount_usd_cents: number;
        down_payment_usd_cents: number | null;
        sale_date: string;
        last_payment_date: string | null;
        paid_usd_cents: number;
      }>(),
  ]);

  let overdueCount = 0;
  // Money buyers still owe on installments. Shown beside the distribute button
  // because profit that has accrued isn't necessarily cash in hand.
  let outstandingInstallments = 0;
  for (const r of installmentRows.results ?? []) {
    const state = installmentState({
      sale_price_usd_cents: r.sale_price_usd_cents,
      discount_usd_cents: r.discount_usd_cents || 0,
      down_payment_usd_cents: r.down_payment_usd_cents || 0,
      paid_usd_cents: r.paid_usd_cents,
      sale_date: r.sale_date,
      last_payment_date: r.last_payment_date,
    });
    if (state.is_overdue) overdueCount++;
    if (state.remaining_usd_cents > 0) outstandingInstallments += state.remaining_usd_cents;
  }

  return c.json({
    total_profit_usd_cents: lifetimeProfit,
    undistributed_profit_usd_cents: overview.undistributed_usd_cents,
    last_distribution: overview.last_distribution,
    partners: overview.partners,
    distributions,
    in_stock_count: stockRow?.in_stock_count ?? 0,
    archived_count: stockRow?.archived_count ?? 0,
    stock_capital_usd_cents: stockRow?.capital ?? 0,
    outstanding_installments_usd_cents: outstandingInstallments,
    sold_this_month_count: soldThisMonthRow?.count ?? 0,
    overdue_installments_count: overdueCount,
  });
});

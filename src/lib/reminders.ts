import type { Bindings } from "../types";
import { notifyAllPartners } from "./webpush";

type InstallmentSaleRow = {
  sale_id: number;
  car_id: number;
  make: string;
  model: string;
  buyer_name: string | null;
  sale_date: string;
  sale_price_usd_cents: number;
  down_payment_usd_cents: number;
  discount_usd_cents: number;
  last_payment_date: string | null;
  paid_usd_cents: number;
};

function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function checkOverdueInstallments(env: Bindings, db: D1Database): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT
         s.id AS sale_id, c.id AS car_id, c.make, c.model, s.buyer_name,
         s.sale_date, s.sale_price_usd_cents, s.down_payment_usd_cents, s.discount_usd_cents,
         MAX(ip.payment_date) AS last_payment_date,
         COALESCE(SUM(ip.amount_usd_cents), 0) AS paid_usd_cents
       FROM sales s
       JOIN cars c ON c.id = s.car_id
       LEFT JOIN installment_payments ip ON ip.sale_id = s.id
       WHERE s.sale_type = 'installment'
       GROUP BY s.id`
    )
    .all<InstallmentSaleRow>();

  const today = new Date();
  let overdueCount = 0;

  for (const row of results ?? []) {
    const totalPaid = row.down_payment_usd_cents + row.paid_usd_cents;
    const remaining = row.sale_price_usd_cents - row.discount_usd_cents - totalPaid;
    if (remaining <= 0) continue;

    const baseline = row.last_payment_date ?? row.sale_date;
    const nextDue = addMonths(baseline, 1);
    if (today <= nextDue) continue;

    overdueCount++;
    const remainingUsd = (remaining / 100).toLocaleString("en-US");
    const carLabel = `${row.make} ${row.model}`;
    const buyer = row.buyer_name ? ` (${row.buyer_name})` : "";
    await notifyAllPartners(
      env,
      db,
      "قسط متأخر",
      `${carLabel}${buyer}: الباقي $${remainingUsd} — تأخر القسط عن موعده`
    );
  }

  return overdueCount;
}

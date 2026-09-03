export type ProfitInputs = {
  sale_type: string; // 'cash' | 'installment'
  sale_price_usd_cents: number;
  discount_usd_cents: number;
  down_payment_usd_cents: number;
  purchase_price_usd_cents: number;
  total_expenses_usd_cents: number;
  installments_paid_usd_cents: number; // SUM(installment_payments) — excludes the down payment
};

export type ProfitResult = {
  realized_profit_usd_cents: number;
  target_profit_usd_cents: number;
  is_accrued: boolean; // true while an installment sale is still open — the number is a running estimate, not final
};

// A cash sale is atomic, so its profit is exact and final the moment it's
// recorded. An installment sale is different: the buyer might still owe
// most of the price, so booking the full profit immediately overstates what
// the business has actually earned — and if the deal later settles early at
// a discount, that overstated number would have to be walked back down,
// which looked like the dashboard "losing" money it never really had.
//
// So while an installment sale is still open, profit accrues proportionally
// to how much of the installment portion (sale price minus the down
// payment) has actually been collected — the same $2,000-over-8-months
// idea, expressed as a fraction of dollars in rather than a literal month
// count, since payments don't reliably land in even monthly chunks. The
// moment the sale closes — full payment or a discounted settlement — this
// collapses to the exact final number: sale price minus discount minus
// cost. That's also why a discount only ever shows up once the deal is
// actually closed, never as a live guess about a settlement that hasn't
// happened yet.
export function computeProfit(s: ProfitInputs): ProfitResult {
  const cost = s.purchase_price_usd_cents + s.total_expenses_usd_cents;
  const targetProfit = s.sale_price_usd_cents - cost;

  if (s.sale_type !== "installment") {
    const realized = s.sale_price_usd_cents - s.discount_usd_cents - cost;
    return { realized_profit_usd_cents: realized, target_profit_usd_cents: realized, is_accrued: false };
  }

  const totalPaid = s.down_payment_usd_cents + s.installments_paid_usd_cents;
  const remaining = s.sale_price_usd_cents - s.discount_usd_cents - totalPaid;
  const closed = remaining <= 0;

  if (closed) {
    const realized = s.sale_price_usd_cents - s.discount_usd_cents - cost;
    return { realized_profit_usd_cents: realized, target_profit_usd_cents: targetProfit, is_accrued: false };
  }

  const installmentPortion = s.sale_price_usd_cents - s.down_payment_usd_cents;
  if (installmentPortion <= 0) {
    return { realized_profit_usd_cents: targetProfit, target_profit_usd_cents: targetProfit, is_accrued: false };
  }

  const collected = Math.min(s.installments_paid_usd_cents, installmentPortion);
  const fraction = collected / installmentPortion;
  return {
    realized_profit_usd_cents: Math.round(targetProfit * fraction),
    target_profit_usd_cents: targetProfit,
    is_accrued: true,
  };
}

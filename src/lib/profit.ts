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
  // What this deal ends up at once it's fully settled: sale price minus any
  // discount minus cost. Same as realized on a closed deal; on an open
  // installment sale it's where the running accrual is heading. This is the
  // number that answers "did we win or lose on this car" — a car bought at
  // 10,000 and sold at 8,000 is a loss from the day it's sold, no matter how
  // little of the installment plan has been collected so far.
  final_profit_usd_cents: number;
  is_accrued: boolean; // true while an installment sale is still open — the number is a running estimate, not final
};

// A cash sale is atomic, so its profit is exact and final the moment it's
// recorded. An installment sale is different: the buyer might still owe most
// of the price, so booking the full profit immediately overstates what the
// business has actually earned — and if the deal later settles early at a
// discount, that overstated number would have to be walked back down, which
// looked like the dashboard "losing" money it never really had.
//
// So while an installment sale is still open, profit accrues in proportion to
// how much of the full sale price has actually been received, the down payment
// included. It used to count installments only, which meant a car sold for
// 15,000 with 10,000 paid down showed no profit at all on the day of the sale,
// with two-thirds of the price already in hand.
//
// A loss is the exception: it is counted in full the day the car is sold.
// Spreading a loss over the payments the same way hid it — a car sold for
// 2,000 less than it cost showed almost nothing lost on the dashboard until the
// buyer finished paying, and profit that didn't exist could be shared out
// between the partners in the meantime. How much of a profit has been earned
// depends on the money coming in; the amount lost does not.
//
// The moment the sale closes — full payment or a discounted settlement — all of
// this collapses to the exact final number: sale price minus discount minus
// cost. That's also why a discount only ever shows up once the deal is actually
// closed, never as a live guess about a settlement that hasn't happened yet.
export function computeProfit(s: ProfitInputs): ProfitResult {
  const cost = s.purchase_price_usd_cents + s.total_expenses_usd_cents;
  const targetProfit = s.sale_price_usd_cents - cost;
  const finalProfit = s.sale_price_usd_cents - s.discount_usd_cents - cost;

  if (s.sale_type !== "installment") {
    return {
      realized_profit_usd_cents: finalProfit,
      target_profit_usd_cents: finalProfit,
      final_profit_usd_cents: finalProfit,
      is_accrued: false,
    };
  }

  const totalPaid = s.down_payment_usd_cents + s.installments_paid_usd_cents;
  const remaining = s.sale_price_usd_cents - s.discount_usd_cents - totalPaid;

  if (remaining <= 0) {
    return {
      realized_profit_usd_cents: finalProfit,
      target_profit_usd_cents: targetProfit,
      final_profit_usd_cents: finalProfit,
      is_accrued: false,
    };
  }

  // Unreachable while something is still owed (that needs a positive price),
  // but it keeps the division below safe.
  if (s.sale_price_usd_cents <= 0) {
    return {
      realized_profit_usd_cents: targetProfit,
      target_profit_usd_cents: targetProfit,
      final_profit_usd_cents: finalProfit,
      is_accrued: false,
    };
  }

  const received = Math.min(totalPaid, s.sale_price_usd_cents);
  const fraction = received / s.sale_price_usd_cents;
  return {
    realized_profit_usd_cents: targetProfit < 0 ? targetProfit : Math.round(targetProfit * fraction),
    target_profit_usd_cents: targetProfit,
    final_profit_usd_cents: finalProfit,
    is_accrued: true,
  };
}

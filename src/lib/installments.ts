// One definition of "when is the next installment due", because there were
// three. The dashboard counted a sale overdue after 30 days; the nightly
// reminder and the car page counted it overdue after one calendar month. In
// a 31-day month those disagree, so the badge on the dashboard and the state
// shown on the car itself could contradict each other for days at a time —
// and the notification would fire on a third schedule again.
//
// The month arithmetic is also done properly here. `d.setMonth(d.getMonth()+1)`
// on the 31st rolls into the month after next (Jan 31 + 1 month = Mar 3),
// quietly handing buyers who pay at month-end a few extra days of grace and
// making the due date drift later every cycle.
export function nextInstallmentDue(baselineDate: string): Date {
  const d = new Date(baselineDate);
  const dayOfMonth = d.getUTCDate();

  // Move to the 1st before changing month so the month never overflows, then
  // clamp back to the intended day (or the last day, for a shorter month).
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(dayOfMonth, lastDayOfTargetMonth));

  return d;
}

export type InstallmentState = {
  remaining_usd_cents: number;
  is_paid_off: boolean;
  is_overdue: boolean;
  next_due: string;
};

export function installmentState(input: {
  sale_price_usd_cents: number;
  discount_usd_cents: number;
  down_payment_usd_cents: number;
  paid_usd_cents: number;
  sale_date: string;
  last_payment_date: string | null;
  now?: Date;
}): InstallmentState {
  const totalPaid = input.down_payment_usd_cents + input.paid_usd_cents;
  const remaining = input.sale_price_usd_cents - input.discount_usd_cents - totalPaid;
  const nextDue = nextInstallmentDue(input.last_payment_date ?? input.sale_date);
  const now = input.now ?? new Date();

  return {
    remaining_usd_cents: remaining,
    is_paid_off: remaining <= 0,
    is_overdue: remaining > 0 && now > nextDue,
    next_due: nextDue.toISOString().slice(0, 10),
  };
}

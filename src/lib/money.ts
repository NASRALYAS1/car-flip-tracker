import type { Currency } from "../types";

export type MoneyInput = {
  amount: number; // in minor units: USD cents, or IQD fils (IQD amount * 100)
  currency: Currency;
  exchangeRate?: number | null; // IQD per 1 USD, required when currency = IQD
};

export type MoneyStored = {
  amount: number;
  currency: Currency;
  exchangeRate: number | null;
  usdCents: number;
};

/**
 * Converts an entered amount (in minor units of its own currency) to USD cents.
 * exchangeRate is IQD-per-USD (e.g. 1310), matching how partners quote rates locally.
 */
export function toUsdCents(input: MoneyInput): MoneyStored {
  if (input.currency === "USD") {
    return {
      amount: Math.round(input.amount),
      currency: "USD",
      exchangeRate: null,
      usdCents: Math.round(input.amount),
    };
  }

  if (!input.exchangeRate || input.exchangeRate <= 0) {
    throw new Error("exchangeRate is required and must be > 0 for IQD amounts");
  }

  // amount is IQD fils (IQD * 100). Convert IQD -> USD using rate (IQD per USD).
  const iqdWhole = input.amount / 100;
  const usdWhole = iqdWhole / input.exchangeRate;
  const usdCents = Math.round(usdWhole * 100);

  return {
    amount: Math.round(input.amount),
    currency: "IQD",
    exchangeRate: input.exchangeRate,
    usdCents,
  };
}

/**
 * Reads a `${prefix}_amount` / `${prefix}_currency` / `${prefix}_exchange_rate`
 * triplet from a parsed JSON body and returns the computed MoneyStored fields
 * (as a flat object ready to spread into a D1 bind() call).
 */
export function parseMoneyField(
  body: Record<string, unknown>,
  prefix: string
): { amount: number; currency: Currency; exchangeRate: number | null; usdCents: number } {
  const amount = Number(body[`${prefix}_amount`]);
  const currency = body[`${prefix}_currency`] as Currency;
  const exchangeRateRaw = body[`${prefix}_exchange_rate`];
  const exchangeRate =
    exchangeRateRaw === undefined || exchangeRateRaw === null || exchangeRateRaw === ""
      ? null
      : Number(exchangeRateRaw);

  if (!Number.isFinite(amount)) {
    throw new Error(`${prefix}_amount is required and must be a number`);
  }
  // A negative amount silently corrupts the books -- a negative expense
  // inflates profit, a negative payment increases what's still owed. Nothing
  // in this app legitimately submits one: the trade cash adjustment is
  // entered positive and negated afterwards by direction, and discounts are
  // derived server-side. The upper bound is a sanity guard against a
  // fat-fingered or scripted absurd value, well above any real car price.
  if (amount < 0) {
    throw new Error("المبلغ لا يمكن أن يكون سالباً");
  }
  if (amount > 1_000_000_000_00) {
    throw new Error("المبلغ كبير بشكل غير منطقي");
  }
  if (currency !== "USD" && currency !== "IQD") {
    throw new Error(`${prefix}_currency must be USD or IQD`);
  }

  return toUsdCents({ amount, currency, exchangeRate });
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}$${whole.toLocaleString("en-US")}.${frac}`;
}

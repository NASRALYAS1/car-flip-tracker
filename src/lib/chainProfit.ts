import { getChainForCar, type ChainResult } from "./chain";
import { computeProfit, type ProfitResult } from "./profit";

// ---------------------------------------------------------------------------
// Carried cost, kept honest
// ---------------------------------------------------------------------------
//
// A trade copies cost forward: the incoming car's purchase price is set to the
// outgoing car's price + its expenses + whatever cash changed hands. That copy
// used to be taken once and never revisited, so an expense recorded on an
// earlier car after it had been traded away -- a repair bill that arrived late,
// or one entered by mistake and then deleted -- never reached the cars after
// it. The final car's profit, and with it the dashboard total, the sold list
// and every report, quietly kept the old number.
//
// This recomputes the whole chain forward from its root rather than nudging
// one car by a delta, so a chain that has already drifted is repaired by the
// next change to it instead of being carried wrong forever.

async function expenseTotalsFor(db: D1Database, carIds: number[]): Promise<Map<number, number>> {
  const totals = new Map<number, number>(carIds.map((id) => [id, 0]));
  if (!carIds.length) return totals;
  const placeholders = carIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT car_id, COALESCE(SUM(amount_usd_cents), 0) AS total
       FROM expenses WHERE car_id IN (${placeholders}) GROUP BY car_id`
    )
    .bind(...carIds)
    .all<{ car_id: number; total: number }>();
  for (const row of results ?? []) totals.set(row.car_id, row.total);
  return totals;
}

/**
 * The UPDATE statements that bring every car after the root back in line with
 * what the chain actually cost. `pendingDeltas` describes an expense change
 * that hasn't been committed yet (car id -> usd cents), so the caller batches
 * these alongside the expense write and both land or neither does.
 */
export async function chainCostUpdates(
  db: D1Database,
  carId: number,
  pendingDeltas: Map<number, number> = new Map()
): Promise<D1PreparedStatement[]> {
  const chain = await getChainForCar(db, carId);
  if (!chain.trades.length) return [];

  const carsById = new Map(chain.cars.map((car) => [car.id, car]));
  const totals = await expenseTotalsFor(db, chain.cars.map((car) => car.id));
  for (const [id, delta] of pendingDeltas) totals.set(id, (totals.get(id) ?? 0) + delta);

  // Looked up by id rather than by position: getChainForCar drops a car it
  // can't load, and pairing by index would then match every later trade to
  // the wrong car.
  const root = carsById.get(chain.trades[0].outgoing_car_id);
  if (!root) return [];
  const priceOf = new Map<number, number>([[root.id, root.purchase_price_usd_cents]]);

  const statements: D1PreparedStatement[] = [];
  for (const trade of chain.trades) {
    const fromPrice = priceOf.get(trade.outgoing_car_id);
    const to = carsById.get(trade.incoming_car_id);
    if (fromPrice === undefined || !to) break;

    const carried =
      fromPrice + (totals.get(trade.outgoing_car_id) ?? 0) + trade.cash_adjustment_usd_cents;
    priceOf.set(to.id, carried);

    if (carried !== to.purchase_price_usd_cents) {
      // A car that came out of a trade is always priced in USD cents -- that's
      // how trades.ts creates it, and its price isn't editable by hand.
      statements.push(
        db
          .prepare(
            `UPDATE cars SET purchase_price_amount = ?, purchase_price_currency = 'USD',
               purchase_price_exchange_rate = NULL, purchase_price_usd_cents = ?,
               updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(carried, carried, to.id)
      );
    }
  }
  return statements;
}

// ---------------------------------------------------------------------------
// What the whole chain made
// ---------------------------------------------------------------------------

export type ChainStep = {
  car_id: number;
  name: string;
  status: string;
  expenses_usd_cents: number;
  /** The trade that took this car out of the chain, if it was traded on. */
  traded_out: null | {
    cash_usd_cents: number; // positive: we paid on top, negative: we received
    trade_date: string;
    other_party_name: string | null;
  };
};

export type ChainProfit = {
  cars_count: number;
  root_purchase_usd_cents: number;
  total_expenses_usd_cents: number;
  cash_paid_usd_cents: number;
  cash_received_usd_cents: number;
  total_cost_usd_cents: number;
  final_car_id: number;
  final_car_name: string;
  final_status: string;
  steps: ChainStep[];
  sale: null | {
    sale_type: string;
    sale_date: string;
    sale_price_usd_cents: number;
    discount_usd_cents: number;
  };
  profit: ProfitResult | null;
};

/**
 * Profit for a whole chain, worked out from what actually happened rather than
 * read off the last car: the first purchase, every expense on every car, the
 * cash that changed hands at each trade, and the final sale. It goes through
 * computeProfit with the chain's combined cost, so an installment sale at the
 * end accrues exactly the way the dashboard total does -- a running figure
 * while payments are still coming in, the exact figure once the deal closes.
 */
export async function getChainProfit(db: D1Database, chain: ChainResult): Promise<ChainProfit | null> {
  if (chain.cars.length <= 1 || !chain.trades.length) return null;

  const carsById = new Map(chain.cars.map((car) => [car.id, car]));
  const root = carsById.get(chain.trades[0].outgoing_car_id);
  const final = carsById.get(chain.trades[chain.trades.length - 1].incoming_car_id);
  if (!root || !final) return null;

  const totals = await expenseTotalsFor(db, chain.cars.map((car) => car.id));
  const tradeOutOf = new Map(chain.trades.map((t) => [t.outgoing_car_id, t]));

  const steps: ChainStep[] = chain.cars.map((car) => {
    const t = tradeOutOf.get(car.id);
    return {
      car_id: car.id,
      name: car.name,
      status: car.status,
      expenses_usd_cents: totals.get(car.id) ?? 0,
      traded_out: t
        ? {
            cash_usd_cents: t.cash_adjustment_usd_cents,
            trade_date: t.trade_date,
            other_party_name: t.other_party_name,
          }
        : null,
    };
  });

  const totalExpenses = steps.reduce((s, step) => s + step.expenses_usd_cents, 0);
  const netCash = chain.trades.reduce((s, t) => s + t.cash_adjustment_usd_cents, 0);
  const cashPaid = chain.trades.reduce((s, t) => s + Math.max(0, t.cash_adjustment_usd_cents), 0);
  const cashReceived = chain.trades.reduce((s, t) => s + Math.max(0, -t.cash_adjustment_usd_cents), 0);
  // The purchase side of the chain: what the first car cost, adjusted by every
  // cash top-up paid or received along the way. Expenses stay separate so
  // computeProfit sees the same cost split it sees for a single car.
  const purchaseSide = root.purchase_price_usd_cents + netCash;

  const sale = await db
    .prepare(
      `SELECT id, sale_type, sale_date, sale_price_usd_cents, discount_usd_cents, down_payment_usd_cents
       FROM sales WHERE car_id = ?`
    )
    .bind(final.id)
    .first<{
      id: number;
      sale_type: string;
      sale_date: string;
      sale_price_usd_cents: number;
      discount_usd_cents: number | null;
      down_payment_usd_cents: number | null;
    }>();

  let profit: ProfitResult | null = null;
  if (sale) {
    const paid = await db
      .prepare(`SELECT COALESCE(SUM(amount_usd_cents), 0) AS total FROM installment_payments WHERE sale_id = ?`)
      .bind(sale.id)
      .first<{ total: number }>();
    profit = computeProfit({
      sale_type: sale.sale_type,
      sale_price_usd_cents: sale.sale_price_usd_cents,
      discount_usd_cents: sale.discount_usd_cents || 0,
      down_payment_usd_cents: sale.down_payment_usd_cents || 0,
      purchase_price_usd_cents: purchaseSide,
      total_expenses_usd_cents: totalExpenses,
      installments_paid_usd_cents: paid?.total ?? 0,
    });
  }

  return {
    cars_count: chain.cars.length,
    root_purchase_usd_cents: root.purchase_price_usd_cents,
    total_expenses_usd_cents: totalExpenses,
    cash_paid_usd_cents: cashPaid,
    cash_received_usd_cents: cashReceived,
    total_cost_usd_cents: purchaseSide + totalExpenses,
    final_car_id: final.id,
    final_car_name: final.name,
    final_status: final.status,
    steps,
    sale: sale
      ? {
          sale_type: sale.sale_type,
          sale_date: sale.sale_date,
          sale_price_usd_cents: sale.sale_price_usd_cents,
          discount_usd_cents: sale.discount_usd_cents || 0,
        }
      : null,
    profit,
  };
}

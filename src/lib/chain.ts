export type ChainCar = {
  id: number;
  make: string;
  model: string;
  year: number | null;
  status: string;
  purchase_price_usd_cents: number;
};

export type ChainTrade = {
  id: number;
  outgoing_car_id: number;
  incoming_car_id: number;
  cash_adjustment_usd_cents: number;
  trade_date: string;
  other_party_name: string | null;
};

export type ChainResult = {
  cars: ChainCar[];
  trades: ChainTrade[];
};

const MAX_CHAIN_HOPS = 25; // safety bound, real chains are ~5-10

/**
 * Walks the full trade chain a given car belongs to: backward to the
 * original cash-purchased car, then forward through every trade to the
 * current end of the chain (a car that's in stock, sold, or archived).
 */
export async function getChainForCar(db: D1Database, carId: number): Promise<ChainResult> {
  const carsById = new Map<number, ChainCar>();
  const trades: ChainTrade[] = [];

  async function loadCar(id: number): Promise<ChainCar | null> {
    if (carsById.has(id)) return carsById.get(id)!;
    const row = await db
      .prepare(
        `SELECT id, make, model, year, status, purchase_price_usd_cents FROM cars WHERE id = ?`
      )
      .bind(id)
      .first<ChainCar>();
    if (row) carsById.set(id, row);
    return row;
  }

  let current = await loadCar(carId);
  if (!current) return { cars: [], trades: [] };

  // walk backward to find the root of the chain
  let hops = 0;
  let rootId = carId;
  while (hops < MAX_CHAIN_HOPS) {
    const incomingTrade = await db
      .prepare(`SELECT * FROM trades WHERE incoming_car_id = ?`)
      .bind(rootId)
      .first<ChainTrade>();
    if (!incomingTrade) break;
    trades.push(incomingTrade);
    await loadCar(incomingTrade.outgoing_car_id);
    rootId = incomingTrade.outgoing_car_id;
    hops++;
  }

  // walk forward from the root through every subsequent trade
  let forwardId = rootId;
  hops = 0;
  while (hops < MAX_CHAIN_HOPS) {
    const outgoingTrade = await db
      .prepare(`SELECT * FROM trades WHERE outgoing_car_id = ?`)
      .bind(forwardId)
      .first<ChainTrade>();
    if (!outgoingTrade) break;
    if (!trades.find((t) => t.id === outgoingTrade.id)) trades.push(outgoingTrade);
    await loadCar(outgoingTrade.incoming_car_id);
    forwardId = outgoingTrade.incoming_car_id;
    hops++;
  }

  // Order by the actual outgoing -> incoming links, NOT by trade_date.
  // Dates here are user-entered and often don't run in chain order (a trade
  // recorded late and backdated, or two trades on the same day), and sorting
  // by them used to leave a link whose outgoing car wasn't the current tip —
  // that link got skipped and every car past it silently disappeared from
  // the chain. Topology is exact, so walk that instead.
  const tradeByOutgoing = new Map<number, ChainTrade>();
  for (const t of trades) tradeByOutgoing.set(t.outgoing_car_id, t);

  const orderedIds: number[] = [rootId];
  const orderedTrades: ChainTrade[] = [];
  const seen = new Set<number>([rootId]);
  let cursor = rootId;
  for (let i = 0; i < MAX_CHAIN_HOPS; i++) {
    const next = tradeByOutgoing.get(cursor);
    // the seen check is belt-and-braces against a cycle in bad data
    if (!next || seen.has(next.incoming_car_id)) break;
    orderedIds.push(next.incoming_car_id);
    orderedTrades.push(next);
    seen.add(next.incoming_car_id);
    cursor = next.incoming_car_id;
  }

  const orderedCars = orderedIds
    .map((id) => carsById.get(id))
    .filter((c): c is ChainCar => !!c);

  return { cars: orderedCars, trades: orderedTrades };
}

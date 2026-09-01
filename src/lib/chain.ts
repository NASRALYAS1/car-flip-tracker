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

  trades.sort((a, b) => a.trade_date.localeCompare(b.trade_date));

  // order cars by their position in the chain (root -> ... -> tip)
  const orderedIds: number[] = [rootId];
  for (const t of trades) {
    if (t.outgoing_car_id === orderedIds[orderedIds.length - 1]) {
      orderedIds.push(t.incoming_car_id);
    }
  }
  const orderedCars = orderedIds
    .map((id) => carsById.get(id))
    .filter((c): c is ChainCar => !!c);

  return { cars: orderedCars, trades };
}

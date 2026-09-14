-- One-time repair of carried cost along trade chains.
--
-- A trade copies cost forward: the incoming car's purchase price becomes the
-- outgoing car's price plus its expenses plus any cash that changed hands.
-- That copy used to be taken once, at the moment of the trade, and never
-- revisited -- so an expense added to, edited on, or deleted from an earlier
-- car after it had been traded away never reached the cars after it. The
-- final car's profit, and the dashboard total built from it, kept the old
-- number. The application now keeps chains in step on every expense change.
-- This brings any chain recorded before that fix back in line.
--
-- It recomputes every chain from its root (a car traded out, never traded
-- in) forward. A chain that is already correct gets the same values written
-- back, so this is a no-op for it. A car that came out of a trade is always
-- priced in USD cents, which is how trades.ts creates it, so currency and
-- rate are set to match rather than trusted.
--
-- Only cars actually reached from a root are touched (depth above 0), so a
-- trade row that somehow isn't connected to any root can never have its car's
-- price overwritten with NULL. Each car has at most one incoming trade (that
-- column is UNIQUE), so there is exactly one path to it and no car is reached
-- twice. The depth cap is a guard against bad data, not an expected limit.
WITH RECURSIVE carried(car_id, price, depth) AS (
  SELECT c.id, c.purchase_price_usd_cents, 0
  FROM cars c
  WHERE EXISTS (SELECT 1 FROM trades t WHERE t.outgoing_car_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM trades t WHERE t.incoming_car_id = c.id)
  UNION ALL
  SELECT t.incoming_car_id,
         carried.price
           + COALESCE((SELECT SUM(e.amount_usd_cents) FROM expenses e WHERE e.car_id = carried.car_id), 0)
           + t.cash_adjustment_usd_cents,
         carried.depth + 1
  FROM carried
  JOIN trades t ON t.outgoing_car_id = carried.car_id
  WHERE carried.depth < 50
)
UPDATE cars
SET purchase_price_usd_cents = (SELECT price FROM carried WHERE carried.car_id = cars.id AND carried.depth > 0),
    purchase_price_amount = (SELECT price FROM carried WHERE carried.car_id = cars.id AND carried.depth > 0),
    purchase_price_currency = 'USD',
    purchase_price_exchange_rate = NULL
WHERE id IN (SELECT car_id FROM carried WHERE depth > 0);

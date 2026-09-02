-- Tracks a discount forgiven when a buyer settles an installment plan
-- early for less than the technically-remaining balance. Separate from
-- the actual payment record (which stays an accurate cash log) so
-- "how much did we actually collect" and "how much did we forgive" both
-- stay visible instead of one silently swallowing the other.

ALTER TABLE sales ADD COLUMN discount_usd_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN discount_notes TEXT;
ALTER TABLE sales ADD COLUMN discount_date TEXT;

-- A discount is real forgone revenue, so it has to reduce recorded
-- profit the same way the sale price and expenses do.
DROP VIEW car_profit;
CREATE VIEW car_profit AS
SELECT
  c.id AS car_id,
  c.purchase_price_usd_cents,
  COALESCE(SUM(e.amount_usd_cents), 0) AS total_expenses_usd_cents,
  s.sale_price_usd_cents,
  CASE WHEN s.sale_price_usd_cents IS NOT NULL
    THEN s.sale_price_usd_cents - COALESCE(s.discount_usd_cents, 0)
         - c.purchase_price_usd_cents - COALESCE(SUM(e.amount_usd_cents), 0)
    ELSE NULL END AS profit_usd_cents
FROM cars c
LEFT JOIN expenses e ON e.car_id = c.id
LEFT JOIN sales s ON s.car_id = c.id
GROUP BY c.id;

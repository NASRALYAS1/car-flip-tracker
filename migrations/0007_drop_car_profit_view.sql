-- car_profit booked a sold car's full profit the instant it was sold, even
-- on a car still mid-installments where most of the sale price hasn't
-- actually been collected yet. Profit is now computed in application code
-- (src/lib/profit.ts) so it can accrue against installments actually
-- received instead of the full sale price up front. The view is unused now.
DROP VIEW IF EXISTS car_profit;

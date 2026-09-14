-- The business does not use archiving, so the feature has been removed from
-- the application. Any car that was archived before that is given back the
-- status it really has, worked out from what the database already knows about
-- it: a car with a sale is sold, a car that was traded away is traded, and any
-- other car is in stock. Nothing else about the car changes, and no car is
-- left in a status that no screen can show.
--
-- The status column's CHECK constraint from 0001 still lists 'archived' as an
-- allowed value. Taking a value out of a CHECK means rebuilding the cars table,
-- which sales, expenses, photos and trades all point at. That is not a risk
-- worth taking for a value nothing in the application can write any more.
UPDATE cars
SET status = CASE
      WHEN EXISTS (SELECT 1 FROM sales s WHERE s.car_id = cars.id) THEN 'sold'
      WHEN EXISTS (SELECT 1 FROM trades t WHERE t.outgoing_car_id = cars.id) THEN 'traded'
      ELSE 'in_stock'
    END,
    updated_at = datetime('now')
WHERE status = 'archived';

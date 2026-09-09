-- Splitting a car across "الماركة" and "الموديل" asked whoever was entering
-- it to decide where the boundary falls -- "لاندكروزر" is a model, but
-- "لاندكروزر برادو VXR" is most of a sentence, and half the entries ended up
-- with the whole thing in one box and the other left blank. Every screen in
-- the app already rendered them back as `make + " " + model`, so the split
-- bought nothing and cost a decision on every new car. One field.
--
-- Done with ADD/UPDATE/DROP COLUMN rather than rebuilding the table: cars is
-- referenced by expenses, sales, car_photos and trades, and rebuilding it
-- under D1 risks those references. Neither dropped column is indexed, and
-- the view that once read them was dropped in 0007, so DROP COLUMN is clean.
ALTER TABLE cars ADD COLUMN name TEXT NOT NULL DEFAULT '';

UPDATE cars SET name = TRIM(COALESCE(make, '') || ' ' || COALESCE(model, ''));

ALTER TABLE cars DROP COLUMN make;
ALTER TABLE cars DROP COLUMN model;

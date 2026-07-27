WITH duplicate_products AS (
  SELECT
    id,
    MIN(id) OVER (PARTITION BY ingredient_id, external_ref) AS canonical_id
  FROM products
  WHERE ingredient_id IS NOT NULL
    AND external_ref IS NOT NULL
),
products_to_merge AS (
  SELECT id, canonical_id
  FROM duplicate_products
  WHERE id <> canonical_id
)
UPDATE shopping_list_lines line
SET product_id = merge.canonical_id
FROM products_to_merge merge
WHERE line.product_id = merge.id;

WITH duplicate_products AS (
  SELECT
    id,
    MIN(id) OVER (PARTITION BY ingredient_id, external_ref) AS canonical_id
  FROM products
  WHERE ingredient_id IS NOT NULL
    AND external_ref IS NOT NULL
),
products_to_merge AS (
  SELECT id, canonical_id
  FROM duplicate_products
  WHERE id <> canonical_id
)
UPDATE household_product_preferences preference
SET product_id = merge.canonical_id
FROM products_to_merge merge
WHERE preference.product_id = merge.id;

WITH duplicate_products AS (
  SELECT
    id,
    MIN(id) OVER (PARTITION BY ingredient_id, external_ref) AS canonical_id
  FROM products
  WHERE ingredient_id IS NOT NULL
    AND external_ref IS NOT NULL
),
products_to_merge AS (
  SELECT id, canonical_id
  FROM duplicate_products
  WHERE id <> canonical_id
)
DELETE FROM rejected_product_matches rejected
USING products_to_merge merge
WHERE rejected.product_id = merge.id
  AND EXISTS (
    SELECT 1
    FROM rejected_product_matches existing
    WHERE existing.household_id = rejected.household_id
      AND existing.ingredient_id = rejected.ingredient_id
      AND existing.product_id = merge.canonical_id
  );

WITH duplicate_products AS (
  SELECT
    id,
    MIN(id) OVER (PARTITION BY ingredient_id, external_ref) AS canonical_id
  FROM products
  WHERE ingredient_id IS NOT NULL
    AND external_ref IS NOT NULL
),
products_to_merge AS (
  SELECT id, canonical_id
  FROM duplicate_products
  WHERE id <> canonical_id
)
UPDATE rejected_product_matches rejected
SET product_id = merge.canonical_id
FROM products_to_merge merge
WHERE rejected.product_id = merge.id;

WITH duplicate_products AS (
  SELECT
    id,
    MIN(id) OVER (PARTITION BY ingredient_id, external_ref) AS canonical_id
  FROM products
  WHERE ingredient_id IS NOT NULL
    AND external_ref IS NOT NULL
),
products_to_merge AS (
  SELECT id
  FROM duplicate_products
  WHERE id <> canonical_id
)
DELETE FROM products product
USING products_to_merge merge
WHERE product.id = merge.id;

CREATE UNIQUE INDEX "products_ingredient_id_external_ref_key"
  ON "products"("ingredient_id", "external_ref");

CREATE INDEX "shopping_list_lines_shopping_list_id_needs_review_idx"
  ON "shopping_list_lines"("shopping_list_id", "needs_review");

CREATE INDEX "shopping_list_lines_shopping_list_id_ingredient_id_source_idx"
  ON "shopping_list_lines"("shopping_list_id", "ingredient_id", "source");

CREATE INDEX "feedback_events_household_id_event_type_subject_type_subject_id_idx"
  ON "feedback_events"("household_id", "event_type", "subject_type", "subject_id");

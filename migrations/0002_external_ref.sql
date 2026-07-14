-- 0002 — external_ref: idempotency key for items captured from outside
-- surfaces (first consumer: Reader highlights, ref "reader-highlight:<id>").
-- NULL for items captured in-app. The partial unique index makes re-sends
-- of the same external object dedupe instead of duplicating.
ALTER TABLE taste_item ADD COLUMN external_ref TEXT;
CREATE UNIQUE INDEX idx_item_external_ref ON taste_item(external_ref) WHERE external_ref IS NOT NULL;

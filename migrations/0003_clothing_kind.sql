-- 0003 — clothing_kind: add 'clothing' to the taste_item.kind enum.
-- SQLite can't ALTER a CHECK constraint in place, so this rebuilds the
-- table: new table with the widened CHECK, copy every row (incl.
-- embedding + external_ref), drop the old table, rename, recreate indexes.
CREATE TABLE taste_item_new (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('quote','reference','music','art','clothing')),
  title        TEXT,
  body         TEXT NOT NULL,
  source_url   TEXT,
  creator      TEXT,
  note         TEXT,
  image_url    TEXT,
  status       TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','canon','archived')),
  wins         INTEGER NOT NULL DEFAULT 0,
  losses       INTEGER NOT NULL DEFAULT 0,
  promoted_via TEXT CHECK (promoted_via IN ('refine','manual')),
  embedding    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  external_ref TEXT
);

INSERT INTO taste_item_new
  (id, kind, title, body, source_url, creator, note, image_url, status, wins, losses, promoted_via, embedding, created_at, updated_at, external_ref)
SELECT
  id, kind, title, body, source_url, creator, note, image_url, status, wins, losses, promoted_via, embedding, created_at, updated_at, external_ref
FROM taste_item;

DROP TABLE taste_item;

ALTER TABLE taste_item_new RENAME TO taste_item;

CREATE INDEX idx_item_kind   ON taste_item(kind);
CREATE INDEX idx_item_status ON taste_item(status);
CREATE INDEX idx_item_created ON taste_item(created_at DESC);
CREATE UNIQUE INDEX idx_item_external_ref ON taste_item(external_ref) WHERE external_ref IS NOT NULL;

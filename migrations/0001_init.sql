CREATE TABLE taste_item (
  id           TEXT PRIMARY KEY,              -- crypto.randomUUID()
  kind         TEXT NOT NULL CHECK (kind IN ('quote','reference','music','art')),
  title        TEXT,                          -- short title / headline (nullable)
  body         TEXT NOT NULL,                 -- the quote text or short description
  source_url   TEXT,
  creator      TEXT,                          -- attribution / author / artist
  note         TEXT,                          -- Petter's "why it strikes me"
  image_url    TEXT,                          -- for art (and optional thumb elsewhere)
  status       TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','canon','archived')),
  wins         INTEGER NOT NULL DEFAULT 0,    -- refine-ritual score
  losses       INTEGER NOT NULL DEFAULT 0,    -- refine-ritual downside; drives auto-archive
  promoted_via TEXT CHECK (promoted_via IN ('refine','manual')),  -- NULL until canon; how it got there
  embedding    TEXT,                          -- JSON array of 1024 floats, or NULL if NIM failed
  created_at   TEXT NOT NULL,                 -- ISO8601
  updated_at   TEXT NOT NULL                  -- ISO8601
);
CREATE INDEX idx_item_kind   ON taste_item(kind);
CREATE INDEX idx_item_status ON taste_item(status);
CREATE INDEX idx_item_created ON taste_item(created_at DESC);

CREATE TABLE connection (
  id         TEXT PRIMARY KEY,                -- crypto.randomUUID()
  from_id    TEXT NOT NULL REFERENCES taste_item(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES taste_item(id) ON DELETE CASCADE,
  note       TEXT,                            -- optional one-line "why"
  created_at TEXT NOT NULL
);
CREATE INDEX idx_conn_from ON connection(from_id);
CREATE INDEX idx_conn_to   ON connection(to_id);
CREATE UNIQUE INDEX idx_conn_pair ON connection(from_id, to_id);

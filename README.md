# taste-maker

A single-user, writable **taste library**: capture the quotes, pop-culture
references, music, and visual art that strike you; browse and search them; see
embedding-based "related" neighbours across all kinds; draw explicit
connections; and run an A-vs-B **refine ritual** that promotes items from
`captured` to `canon` — the refined **palette**, the app's face.

It is Nuxt 3 on Cloudflare Workers, forked structurally from
[`do-web`](https://github.com/phareim/do-web). It reuses Reader's login and
Reader's warm-paper Tufte visual layer, but — unlike do-web/write-web, which
proxy a Sleeper backend — taste-maker is its **own system of record**: it owns a
second, writable D1 database with migrations and server routes that
INSERT/UPDATE.

Live: **https://taste.phareim.no**, behind Reader's login. (Deployed via
GitHub Actions on 2026-07-13; the `taste.phareim.no` custom domain was bound
by the CI Cloudflare token.)

## Why this is not "SFL with a skin"

1. **Heterogeneous media rendered as themselves.** Quotes are pull-quotes,
   art is an image, music carries an oEmbed thumbnail, references are typed
   index-card rows. No two kinds share a card treatment.
2. **An embedding-assisted *related* panel** plus a **refine-to-canon conviction
   ritual** with a visible end-state (the palette). Neither exists in SFL.

## Architecture

- **Frontend / runtime:** Nuxt 3 (`nitro.preset = 'cloudflare-module'`),
  deployed as a single Cloudflare Worker. Tailwind + a vendored Tufte preset
  (ET Book fonts, hairline rules, mono labels) for the warm-paper look.
- **Two D1 bindings coexist in the Worker:**
  - `DB` → `reader-service` (Reader's DB). **Read-only.** Used only to validate
    the `session_token` cookie against Reader's `session`/`User` tables.
  - `TASTE_DB` → `taste-maker` (this app's DB). **Read-write.** Owns the
    `taste_item` and `connection` tables (see `migrations/0001_init.sql`).
- **Auth:** copied byte-for-byte from do-web. A client-only global middleware
  bounces unauthenticated visits to `reader.phareim.no/login?redirect=<back>`;
  every server route calls `requireAllowedUser(event)`, which validates the
  session against `DB` and checks the email against `NUXT_ALLOWED_USER_EMAILS`
  (401 no session, 403 not allowlisted). The `session_token` cookie is scoped to
  `.phareim.no`, so **login only works on the custom domain**, not on
  `*.workers.dev`.
- **Embeddings (NVIDIA NIM, graceful degradation):** at item write time the app
  builds `embedText = [title, creator, body, note].join(' — ')` and POSTs it to
  NIM's `nv-embedqa-e5-v5` (1024-dim, `input_type: "passage"`), storing the
  vector as JSON text inline on the item row. The call is wrapped in a 10s
  timeout and try/catch: on **any** failure (missing `NVIDIA_API_KEY`, non-2xx,
  timeout, unexpected shape) it saves the item with `embedding = NULL` and never
  fails the write. The related panel is item-to-item cosine over stored vectors;
  if the target has no embedding it returns `[]` and the UI hides the panel.

### Data model (owned `taste-maker` D1)

Two tables — one `taste_item` shape for all four kinds (kind-specific rendering
is a UI concern), one `connection` edge table. Full DDL in
`migrations/0001_init.sql`.

- `taste_item`: `id, kind, title, body, source_url, creator, note, image_url,
  status, wins, losses, promoted_via, embedding, created_at, updated_at`.
  - `kind ∈ {quote, reference, music, art}`
  - `status ∈ {captured, canon, archived}` (default `captured`)
  - `promoted_via ∈ {refine, manual}`, NULL until canon
  - `embedding` is JSON text (or NULL); **never returned to the client** — routes
    select an explicit `ITEM_COLUMNS` list that excludes it.
- `connection`: undirected edge (`from_id`, `to_id`, `note`). Written in
  canonical order (smaller id first) so a UNIQUE index dedupes A↔B regardless of
  direction. Item delete **explicitly** removes edges first —
  D1/SQLite `ON DELETE CASCADE` is not reliably enforced.

### Route map

| Path | Purpose |
|---|---|
| `/` | Library: browse all, filter by kind + status, debounced search |
| `/capture` | Keyboard-friendly add form (`Cmd/Ctrl+Enter` submits) |
| `/item/[id]` | Full item + related panel + connections + connect + promote/demote/delete |
| `/refine` | A-vs-B compare ritual |
| `/palette` | Canon view grouped by kind — the app's face |

API (all gated by `requireAllowedUser`): `GET/POST /api/items`,
`GET/PATCH/DELETE /api/items/[id]`, `GET /api/items/[id]/related`,
`GET/POST /api/connections`, `DELETE /api/connections/[id]`,
`GET /api/refine/pair`, `POST /api/refine/pick`, `GET /api/auth/session`.

### Ingest (server-to-server, Bearer `TASTE_INGEST_KEY`)

Reader mirrors every highlight here as a `quote` item — the one-way funnel:
encounter in Reader, refine in taste-maker.

- `POST /api/ingest/highlight` — `{highlight_id, quote, note?, source_url?, source_title?}`.
  Idempotent on `external_ref = "reader-highlight:<id>"` (partial unique
  index, migration 0002): re-sends and the backfill script return the
  existing item (`created: false`) instead of duplicating. The article title
  lands in `title`, the highlight note in `note`; embedding is computed
  best-effort like any other capture.
- `DELETE /api/ingest/highlight/[id]` — the Reader-side undo. Deletes the
  mirrored item **only while untouched** (still `captured`, zero wins/losses,
  no connections); once refined or connected, the library owns it and the
  undo returns `{deleted: false, reason: 'touched'}`.
- `POST /api/ingest/capture` — `{kind, title?, body, source_url?, creator?,
  note?, image_url?}`. Same validation as `POST /api/items`. Used by the
  Chrome extension (`extension/`) to capture from any page without a
  browser session. Auth is `Authorization: Bearer <TASTE_EXTENSION_KEY>` —
  a separate secret from `TASTE_INGEST_KEY` (extension-held keys are a
  different trust boundary than Worker-held ones). CORS-scoped to the
  extension's own fixed origin (see `server/utils/cors.ts`); handles its own
  `OPTIONS` preflight.

Auth for `/api/ingest/highlight*`: `Authorization: Bearer <TASTE_INGEST_KEY>`
(Worker secret; host-side copy in `~/.config/taste/env`, shared with Reader
as `NUXT_TASTE_INGEST_KEY`). Auth for `/api/ingest/capture`:
`Authorization: Bearer <TASTE_EXTENSION_KEY>` (separate Worker secret, held
only by the Chrome extension). Both: 503 when the relevant secret is unset,
401 on mismatch. Reader's side of the highlight pipe (mirror-on-create,
undo-on-delete, backfill script) lives in the reader repo.

## The refine ritual

The heart of the app. `/refine` serves two `captured` items — **same kind by
default** (cross-kind is a deliberate "wildcard" mode, not an accident) — using
exposure weighting (`ORDER BY (wins + losses) ASC, RANDOM()`) so least-seen items
surface first and repeat pairings don't dominate a small pool. You pick A, pick
B, or skip (`←` / `→` / `space`).

Each pick increments the winner's `wins` and the loser's `losses`. Two named
thresholds (both first guesses, to be revisited with real usage — see
`server/utils/refine.ts`) drive the state machine:

- **`PROMOTE_THRESHOLD = 3`** — when a winner reaches `wins >= 3` while still
  `captured`, it auto-promotes to `canon` with `promoted_via = 'refine'`.
  Promotion is treated as an arrival, not a toast: the winner holds in the accent
  for a beat, then the ritual navigates to `/palette?highlight=<id>` where it
  settles into place.
- **`ARCHIVE_THRESHOLD = 4`** — when a loser reaches `losses - wins >= 4` while
  still `captured`, it auto-archives (a quiet "let go", recoverable from the
  library).

Manual fast-tracking exists too: `PATCH status=canon` from the item page sets
`promoted_via = 'manual'`, and the palette marks those items unobtrusively to
distinguish them from refine-earned ones.

**The loop closes:** refine promotes → the item's status becomes `canon` →
`/palette` (which queries `?status=canon`) shows it → the pair endpoint (which
only ever selects `status='captured'`) no longer serves it. Canon and archived
items never reappear in refine.

## Local development

Everything targets `--remote` D1; there is deliberately no `--local` seed story
in v1. Without `NVIDIA_API_KEY`, writes still succeed with `embedding = NULL`
(the intended graceful path).

```bash
npm install
npm run build      # produces .output/server/index.mjs
```

## Deploy

1. **Create the owned D1 and apply the migration** (once):
   ```bash
   npx wrangler d1 create taste-maker
   # copy the returned database_id into wrangler.toml's TASTE_DB block
   npx wrangler d1 migrations apply taste-maker --remote
   ```
2. **Set the NIM secret:**
   ```bash
   npx wrangler secret put NVIDIA_API_KEY   # paste $NVIDIA_API_KEY (in ~/.zshrc on Sleeper)
   ```
   `NUXT_ALLOWED_USER_EMAILS` is a plain `[vars]` entry, not a secret.
3. **Ship.** Push to `main` — GitHub Actions builds and runs `wrangler deploy`
   with the CI `CLOUDFLARE_API_TOKEN` (account `bb0db86d8a64a70337bb44f43d00e4e5`),
   which also creates the `custom_domain = true` route + DNS record for
   `taste.phareim.no`. The workflow runs `d1 migrations apply --remote` before
   deploy so schema stays current. `npx wrangler deploy` from this host also works
   for the Worker itself, but the local token historically lacks DNS-edit perms,
   so the custom-domain bind is best left to CI.

> **Domain is load-bearing, not cosmetic:** the `session_token` cookie is scoped
> to `.phareim.no`, so login only works once `taste.phareim.no` is bound. If the
> deploy token can't edit DNS, bind the domain via the Cloudflare dashboard
> (Workers & Pages → taste-maker → Settings → Domains & Routes → Add custom
> domain) — the same gotcha as wiki-reader and the phareim.md apex.

## V1 cut line

Shipped, and nothing beyond: auth fork, capture form, library browse/filter/
search, item view with related panel + explicit connections, refine ritual with
canon promotion, palette view, Reader-styled and mobile-friendly, deployed behind
Reader login at `taste.phareim.no`.

## Parked for v2 (explicitly out of v1)

- URL auto-extraction (title/metadata scraping on paste)
- Claude-written rationale for items or connections
- Active web discovery / search for new taste
- SFL / sleeper-articles integration
- Share-sheet / bookmarklet capture
- Graph visualization of the connection web
- R2 / file uploads (v1 hotlinks image URLs only)
- Local D1 dev seed + offline story
- Tuning the refine thresholds against real usage data

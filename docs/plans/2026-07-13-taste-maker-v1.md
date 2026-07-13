# taste-maker — V1 implementation plan

_2026-07-13. Executable plan. Implementers have no context beyond this file — every task names exact files, commands, and a verification step._

Binding scope decision: `/home/petter/council/runs/2026-07-13-2256-taste-library-webapp/frame/G1.md`.

---

## Overview

taste-maker is a single-user, writable, media-heterogeneous **taste library**: capture quotes / pop-culture references / music / visual art, browse & search them, see embedding-based "related" neighbours across all kinds, draw explicit connections, and run an A-vs-B **refine ritual** that promotes items from `captured` to `canon` — the refined **palette**, the app's face.

It is Nuxt 3 on Cloudflare Workers, forked structurally from `~/github/do-web`. It reuses Reader's login (session cookie validated read-only against Reader's D1) and Reader's warm-paper Tufte visual layer, but — unlike do-web/write-web, which proxy a Sleeper backend — taste-maker is its **own system of record**: it owns a second, writable D1 database (`taste-maker`) with migrations and server routes that INSERT/UPDATE. That writable store is the part the template does not demonstrate; it is planned explicitly below.

**Why this is not "SFL with a skin":** (a) heterogeneous media rendered as themselves (quote typography, art images, music/embed links) rather than uniform text rows, and (b) an embedding-assisted *related* panel plus a *refine-to-canon* conviction ritual with a visible end-state (the palette) — neither exists in SFL.

**V1 cut line (nothing beyond this):** auth fork, capture form, library browse/filter/search, item view with related panel + explicit connections, refine ritual with canon promotion, palette view, Reader-styled + mobile-friendly, deployed behind Reader login at `taste.phareim.no`.

**Explicitly OUT (v2, do not build):** URL auto-extraction, Claude-written rationale, active web discovery/search, SFL/sleeper-articles integration, share-sheet/bookmarklet, graph visualization, R2/file uploads (image URLs only, hotlinked).

### Verified facts (copied from disk — do not re-derive)

| Fact | Value | Source |
|---|---|---|
| Cloudflare account_id | `bb0db86d8a64a70337bb44f43d00e4e5` | `~/.wrangler/cache/pages.json` |
| Reader D1 (session validation, read-only) binding `DB` | `database_name = "reader-service"`, `database_id = "2ccea3e6-cd78-45f5-9395-1094f964b273"` | `do-web/wrangler.toml`, `write-web/wrangler.toml` |
| Reader session table schema | `"session"(token TEXT UNIQUE, user_id TEXT, expires_at TEXT)` JOIN `"User"(id, email, name)`; validate `WHERE s.token=? AND s.expires_at > <ISO now>` | `reader/database/migrations/003-better-auth-tables.sql`, `do-web/server/utils/readerSession.ts` |
| Session cookie | `session_token`, domain `.phareim.no` | `readerSession.ts` |
| Reader login bounce | `https://reader.phareim.no/login?redirect=<url-encoded back>` | `do-web/composables/useAuth.ts` |
| Nuxt version | `nuxt ^3.17.7`, module `@nuxtjs/tailwindcss ^6.14.0` | `do-web/package.json` |
| Nitro preset | `cloudflare-module`; wrangler `compatibility_date=2024-09-23`, `compatibility_flags=["nodejs_compat_v2"]` | `do-web/nuxt.config.ts`, `do-web/wrangler.toml` |
| Custom domain binding | `[[routes]] pattern=<host> zone_name="phareim.no" custom_domain=true` — do.phareim.no resolves via Cloudflare, so this mechanism worked for the sibling apps' CI token | `do-web/wrangler.toml`; `getent hosts do.phareim.no` → Cloudflare IPs |
| NIM embeddings | `POST https://integrate.api.nvidia.com/v1/embeddings`, `Authorization: Bearer $NVIDIA_API_KEY`, body `{model:"nvidia/nv-embedqa-e5-v5", input:[...], input_type:"passage"\|"query", truncate:"END"}`, 1024-dim, `data.data[i].embedding` by `.index` | `~/thoughts/sync/build-semantic-related.cjs:63-86` |

`NVIDIA_API_KEY` is exported in `~/.zshrc` on this host (Sleeper) for manual `wrangler secret put`.

---

## Architecture

### Data model (owned `taste-maker` D1)

Two tables. One `taste_item` shape for all four kinds (kind-specific rendering is a UI concern), one `connection` edge table. Embedding stored inline as JSON text on the item row (1024 floats; ~15KB; fine at personal scale). `wins` powers the refine ritual score.

**`migrations/0001_init.sql`** (exact DDL — implementers copy this verbatim):

```sql
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
```

Connections are logically undirected: when reading an item's connections, query **both** `from_id = ?` OR `to_id = ?` and present the *other* endpoint. Enforce a canonical order on write (sort the two ids, smaller first) so the unique index dedupes A↔B regardless of direction.

**FK enforcement warning:** SQLite/D1 do NOT reliably enforce `ON DELETE CASCADE` (per-connection pragma, version-dependent). The CASCADE clauses above are documentation; the item delete route MUST explicitly `DELETE FROM connection WHERE from_id=?1 OR to_id=?1` before deleting the item (Task 10).

**Refine ritual constants** (one shared module, `server/utils/refine.ts` or inline in the pick route): `PROMOTE_THRESHOLD = 3` (wins → canon) and `ARCHIVE_THRESHOLD = 4` (`losses - wins >= 4` → archived). Both are named constants with a comment saying they're first guesses to revisit with real usage.

**Local-dev note:** everything targets `--remote` D1; there is deliberately no `--local` seed/migration story in v1. Without `NVIDIA_API_KEY`, writes still succeed with `embedding=NULL` (the intended graceful path) — do not burn time making `nuxt dev` fully work against local D1.

### Route map (pages)

| Path | Page file | Purpose |
|---|---|---|
| `/` | `pages/index.vue` | Library: browse all, filter by kind + status, search box |
| `/capture` | `pages/capture.vue` | Manual add form (keyboard-friendly) |
| `/item/[id]` | `pages/item/[id].vue` | Full item + related panel + connections + connect UI + promote |
| `/refine` | `pages/refine.vue` | A-vs-B compare ritual |
| `/palette` | `pages/palette.vue` | Canon view grouped by kind |

Global nav (a slim Tufte header) links: Library · Capture · Refine · Palette.

### API endpoints (server routes, all gated by `requireAllowedUser`)

| Method + path | File | Behaviour |
|---|---|---|
| GET `/api/auth/session` | `server/api/auth/session.get.ts` | `{ user }` (copied from do-web) |
| GET `/api/items` | `server/api/items/index.get.ts` | List; query `?kind=&status=&q=` (D1 `LIKE` over title/body/creator/note). Never returns `embedding`. |
| POST `/api/items` | `server/api/items/index.post.ts` | Insert item; compute embedding (best-effort); return created row (no embedding) |
| GET `/api/items/[id]` | `server/api/items/[id].get.ts` | Single item (no embedding) + its connections (resolved to the other endpoint) |
| PATCH `/api/items/[id]` | `server/api/items/[id].patch.ts` | Update mutable fields; re-embed if `body`/`title`/`note` changed; `status` promote/demote |
| DELETE `/api/items/[id]` | `server/api/items/[id].delete.ts` | Delete (cascades connections) |
| GET `/api/items/[id]/related` | `server/api/items/[id]/related.get.ts` | Top-5 cosine neighbours across all kinds; `[]` if item has no embedding |
| GET `/api/connections` | `server/api/connections/index.get.ts` | All edges (personal scale; no filters in v1) — powers the palette's "in dialogue with" lines |
| POST `/api/connections` | `server/api/connections/index.post.ts` | Create edge `{from_id, to_id, note?}`; canonical-order dedupe |
| DELETE `/api/connections/[id]` | `server/api/connections/[id].delete.ts` | Remove edge |
| GET `/api/refine/pair` | `server/api/refine/pair.get.ts` | Two `captured` items, **same kind by default**; `?kind=` pins a kind; `?mix=true` is the deliberate cross-kind "wildcard" mode. Least-exposed items surface first. |
| POST `/api/refine/pick` | `server/api/refine/pick.post.ts` | `{winner_id, loser_id}` → winner `wins += 1`, loser `losses += 1`; auto-promote winner to `canon` (`promoted_via='refine'`) at `PROMOTE_THRESHOLD`; auto-archive loser at `ARCHIVE_THRESHOLD` |

**Response contract:** `embedding` is stripped from every response (select explicit columns; never `SELECT *` to the client). All write routes set `updated_at`.

### Auth flow (copied byte-for-byte from do-web)

1. `middleware/auth.global.ts` (client-only): on navigation, `useAuth().fetchSession()`; if no user, `window.location.href = loginUrl()` (Reader login with redirect back), `abortNavigation()`.
2. Every server route calls `requireAllowedUser(event)` first → `getReaderUser` validates `session_token` against the read-only Reader D1 (`DB` binding), then checks `email ∈ NUXT_ALLOWED_USER_EMAILS`. 401 no session, 403 not allowlisted.
3. Two D1 bindings coexist in the Worker: `DB` (reader-service, read-only, session) and `TASTE_DB` (taste-maker, read-write, app data).

### Embedding flow

At item write time (POST, and PATCH when text changed): build `embedText = [title, creator, body, note].filter(Boolean).join(' — ')`, POST to NIM with `input_type:"passage"`, store `JSON.stringify(embedding)` in `taste_item.embedding`. **Graceful degradation:** wrap in try/catch with a 10s timeout; on any failure save the item with `embedding = NULL` and continue (never fail the write). Related panel: load candidate rows with non-null embeddings, `JSON.parse`, cosine vs the target, sort desc, take 5. If the target has no embedding, return `[]` and the UI hides the panel. (No query-vector re-embed needed — related is item-to-item over stored passage vectors.)

---

## Phases

- **Phase A — Scaffold + auth** (Tasks 1–5): the app boots, is Reader-gated, wears the Tufte skin. No app data yet.
- **Phase B — Data layer + API** (Tasks 6–11): owned D1, migration, embedding util, all server routes. Parallelizable with Phase C once Task 6 lands.
- **Phase C — Pages / UI** (Tasks 12–17): the five pages + nav + shared composable, against the Phase B API.
- **Phase D — Embeddings + refine wiring** (Tasks 18–19): related panel and refine ritual end-to-end (depend on B + C).
- **Phase E — Deploy + domain + smoke test** (Tasks 20–22).

Within a phase, tasks touching disjoint files may run in parallel. Cross-phase: B and C can overlap after Task 6; D needs both; E is last.

---

## Phase A — Scaffold + auth

### Task 1 — Copy the do-web skeleton into taste-maker
**Depends on:** none.
**Goal:** stand up an identical Nuxt+Worker skeleton in the empty taste-maker repo, minus do-web's tasks-specific code.
**Files/commands:**
- Work in `/home/petter/github/taste-maker`. Preserve existing `README.md` and `.git`.
- Copy from `~/github/do-web`: `package.json`, `package-lock.json`, `nuxt.config.ts`, `tailwind.config.js`, `.gitignore`, `app.vue`, `config/tufte.preset.cjs`, `assets/css/tufte.css`, `assets/css/main.css`, `public/tufte/` (fonts, whole dir), `components/tufte/` (all four: CardFrame, MonoLabel, HairlineRule, ActionLabel), `server/utils/readerSession.ts`, `server/utils/cloudflare.ts`, `server/api/auth/session.get.ts`, `composables/useAuth.ts`, `composables/useToast.ts`, `components/AppToast.vue`, `middleware/auth.global.ts`.
- While copying `composables/useAuth.ts`: change `loginUrl()`'s SSR fallback string `https://do.phareim.no/` → `https://taste.phareim.no/` (harmless in practice but a wrong hostname otherwise ships in the fork).
- Do **NOT** copy: `server/api/tasks/**`, `server/utils/tasksApi.ts`, `server/utils/taskId.ts`, `composables/useTasks.ts`, `composables/useTaskEvents.ts`, `utils/taskSort.ts`, `utils/sseParse.ts`, `types/task.ts`, `pages/**`, `components/TaskRow.vue`, `components/StatusPicker.vue`, `components/CommentList.vue`, `jest.config.js`, `__tests__/`, `.github/`, `wrangler.toml` (all rewritten below).
- Edit `package.json`: set `"name": "taste-maker"`, `"description": "A personal taste library — capture, connect, and refine a palette of quotes, references, music, and art"`, update `repository.url` to `git+https://github.com/phareim/taste-maker.git`, remove the jest devDeps and `test`/`test:watch` scripts (no test framework in v1).
**Verify:** `ls server/utils/readerSession.ts assets/css/tufte.css public/tufte/fonts/et-book-roman.woff components/tufte/CardFrame.vue` all exist; `grep -q '"name": "taste-maker"' package.json`.

### Task 2 — Rewrite `nuxt.config.ts` for taste-maker
**Depends on:** 1.
**Goal:** app metadata + runtimeConfig for taste-maker (drop tasks vars, keep allowlist, add nothing the Worker doesn't read via bindings).
**Files:** `nuxt.config.ts`.
**Key content:** keep `compatibilityDate`, `css` array, `modules`, `nitro.preset='cloudflare-module'`, `typescript` block, and the `components.dirs` block (tufte primitives auto-imported without prefix) **exactly as do-web**. (Note: `nuxt.config.ts` `compatibilityDate: '2024-04-03'` vs wrangler `compatibility_date = "2024-09-23"` is intentional — Nuxt feature-date vs Workers runtime-date; do NOT "unify" them.) Change `app.head.title` to `'taste-maker'` and description to `'A personal taste library'`; keep `theme-color '#fbf9f4'` and the viewport meta. Replace `runtimeConfig` with only `{ allowedUserEmails: '' }` (NIM key and D1 come from Worker bindings/secrets, not runtimeConfig — read them off `event.context.cloudflare.env`).
**Verify:** `grep -q "cloudflare-module" nuxt.config.ts && grep -q "allowedUserEmails" nuxt.config.ts && ! grep -q "tasksApi" nuxt.config.ts`.

### Task 3 — Write `wrangler.toml` with BOTH D1 bindings
**Depends on:** 1.
**Goal:** declare the read-only Reader D1 (`DB`) and the writable owned D1 (`TASTE_DB`, id filled in Task 20), the custom domain route, and vars.
**Files:** `wrangler.toml`.
**Key content:**
```toml
name = "taste-maker"
main = ".output/server/index.mjs"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat_v2"]

[site]
bucket = ".output/public"

# Reader's DB — read-only session validation. Reader owns the schema.
[[d1_databases]]
binding = "DB"
database_name = "reader-service"
database_id = "2ccea3e6-cd78-45f5-9395-1094f964b273"

# taste-maker's OWN writable DB. database_id filled after `wrangler d1 create` (Task 20).
[[d1_databases]]
binding = "TASTE_DB"
database_name = "taste-maker"
database_id = "TODO_FILL_AFTER_D1_CREATE"
migrations_dir = "migrations"

[[routes]]
pattern = "taste.phareim.no"
zone_name = "phareim.no"
custom_domain = true

[vars]
NUXT_ALLOWED_USER_EMAILS = "phareim@gmail.com"

# Secret (wrangler secret put): NVIDIA_API_KEY — NIM embeddings bearer.
```
**Verify:** `grep -c "d1_databases" wrangler.toml` returns `2`; `grep -q 'binding = "TASTE_DB"' wrangler.toml`.

### Task 4 — Extend `cloudflare.ts` with the writable-D1 accessor
**Depends on:** 1.
**Goal:** a `getTasteDb(event)` helper alongside the vendored `getD1` (which stays pointed at `DB` for sessions).
**Files:** `server/utils/cloudflare.ts`.
**Key content:** keep `getD1` returning `env.DB`. Add `export const getTasteDb = (event) => { ... env.TASTE_DB ... }` mirroring `getD1`'s error-throw shape (500 if binding missing). Extend the `CloudflareEnv` type with `TASTE_DB?: any` and `NVIDIA_API_KEY?: string`.
**Verify:** `grep -q "getTasteDb" server/utils/cloudflare.ts && grep -q "env.TASTE_DB" server/utils/cloudflare.ts`.

### Task 5 — `npm install` + typecheck the skeleton boots
**Depends on:** 1, 2, 3, 4.
**Goal:** confirm the fork builds before adding features.
**Commands:** `cd /home/petter/github/taste-maker && npm install && npm run build`.
**Verify:** `npm run build` exits 0 and produces `.output/server/index.mjs`. (Build failure here means the copy/config is wrong — fix before proceeding.)

---

## Phase B — Data layer + API

### Task 6 — Migration file + local-DB helper
**Depends on:** 3.
**Goal:** the `migrations/` dir with `0001_init.sql` (DDL from Architecture, verbatim) so `wrangler d1 migrations apply` works locally and in deploy.
**Files:** create `migrations/0001_init.sql` with the exact DDL above (both tables + all indexes).
**Verify:** `test -f migrations/0001_init.sql && grep -q "CREATE TABLE taste_item" migrations/0001_init.sql && grep -q "CREATE TABLE connection" migrations/0001_init.sql`. (Applying against a real D1 happens in Task 20; locally the implementer may `wrangler d1 migrations apply taste-maker --local` once the DB is created, but that is not required to write the routes.)

### Task 7 — Shared types + item DB helpers
**Depends on:** 4, 6.
**Goal:** one TS contract for items/connections and a thin query helper module so routes stay small.
**Files:** create `types/taste.ts` and `server/utils/tasteDb.ts`.
**Key content:**
- `types/taste.ts`: `export type Kind = 'quote'|'reference'|'music'|'art'`; `export type Status = 'captured'|'canon'|'archived'`; `export interface TasteItem { id; kind: Kind; title: string|null; body: string; source_url: string|null; creator: string|null; note: string|null; image_url: string|null; status: Status; wins: number; losses: number; promoted_via: 'refine'|'manual'|null; created_at: string; updated_at: string }` (note: **no `embedding` field** on the client-facing type); `export interface Connection { id; from_id; to_id; note: string|null; created_at: string }`; `export interface RelatedItem extends TasteItem { similarity: number }`.
- `server/utils/tasteDb.ts`: constant `ITEM_COLUMNS = 'id,kind,title,body,source_url,creator,note,image_url,status,wins,losses,promoted_via,created_at,updated_at'` (embedding deliberately excluded) and small helpers, e.g. `getItem(db,id)`, `orderedPair(a,b)` returning `[min,max]` string-sorted for connection dedupe. Keep logic minimal; routes can also inline SQL.
**Verify:** `npx tsc --noEmit` (or `npm run build`) passes; `grep -q "ITEM_COLUMNS" server/utils/tasteDb.ts` and confirm `embedding` is NOT in `ITEM_COLUMNS`.

### Task 8 — Embedding util (NIM, graceful)
**Depends on:** 4.
**Goal:** `embedText(env, text): Promise<number[]|null>` and `cosine(a,b): number`, isolated so routes call one function.
**Files:** create `server/utils/embedding.ts`.
**Key content:** `POST https://integrate.api.nvidia.com/v1/embeddings`, `Authorization: Bearer ${env.NVIDIA_API_KEY}`, body `{ model:'nvidia/nv-embedqa-e5-v5', input:[text.slice(0,8000) || ' '], input_type:'passage', truncate:'END' }`, `AbortSignal.timeout(10_000)`. On `!env.NVIDIA_API_KEY`, non-2xx, thrown error, or unexpected shape → `return null` (log to console, never throw). Return `data.data[0].embedding`. `cosine(a,b)` = standard dot / (‖a‖‖b‖), guard zero-norm → 0.
**Verify:** `npm run build` passes; code has no `throw` on the NIM failure path (grep the catch returns null).

### Task 9 — Items: list + create routes
**Depends on:** 7, 8.
**Goal:** `GET /api/items` (filter/search) and `POST /api/items` (insert + best-effort embed).
**Files:** `server/api/items/index.get.ts`, `server/api/items/index.post.ts`.
**Key content:**
- GET: `await requireAllowedUser(event)`; read `kind`,`status`,`q` from query; build `SELECT ${ITEM_COLUMNS} FROM taste_item` with `WHERE` clauses. **Param binding: use all-anonymous `?` placeholders only** (never mix `?` and `?N` — SQLite mis-binds). For `q`, push the same `%q%` value onto the bind array four times in clause order: `(title LIKE ? OR body LIKE ? OR creator LIKE ? OR note LIKE ?)`. `ORDER BY created_at DESC`; `.bind(...params).all()`; return `results`.
- POST: `requireAllowedUser`; `readBody`; validate `kind ∈ Kind` and non-empty `body` (400 otherwise); `id = crypto.randomUUID()`, `now = new Date().toISOString()`; `embedding = await embedText(env, [title,creator,body,note].filter(Boolean).join(' — '))`; `INSERT INTO taste_item (...) VALUES (...)` with `status='captured'`, `wins=0`, `embedding = embedding ? JSON.stringify(embedding) : null`; return the created row via `ITEM_COLUMNS` select.
**Verify:** `npm run build` passes. Manual (after deploy/local): `POST /api/items` returns the row with an `id`; response JSON has no `embedding` key.

### Task 10 — Items: get / patch / delete + related
**Depends on:** 7, 8.
**Goal:** single-item read (with connections), update (re-embed on text change), delete, and the related-neighbours route.
**Files:** `server/api/items/[id].get.ts`, `server/api/items/[id].patch.ts`, `server/api/items/[id].delete.ts`, `server/api/items/[id]/related.get.ts`.
**Key content:**
- `[id].get.ts`: item via `ITEM_COLUMNS` (404 if missing); connections via `SELECT * FROM connection WHERE from_id=?1 OR to_id=?1`; for each, resolve the *other* endpoint id and fetch that item's summary; return `{ item, connections: [{ id, note, created_at, other: <item> }] }`.
- `[id].patch.ts`: `requireAllowedUser`; allow updating `title,body,source_url,creator,note,image_url,status` (validate `status ∈ Status`); when a PATCH sets `status='canon'` from a non-canon state, also set `promoted_via='manual'` (the fast-track marker); when demoting away from canon, null `promoted_via`; if `body`/`title`/`note`/`creator` changed, recompute embedding (best-effort, may set null); always set `updated_at`; return updated row.
- `[id].delete.ts`: **explicitly** `DELETE FROM connection WHERE from_id=?1 OR to_id=?1` first, then `DELETE FROM taste_item WHERE id=?1` (do NOT rely on CASCADE — D1/SQLite FK enforcement is not guaranteed; orphaned edges break item pages); return `{ ok: true }`.
- `[id]/related.get.ts`: load target `embedding` (raw, server-only); if null → return `[]`. Load `SELECT ${ITEM_COLUMNS}, embedding FROM taste_item WHERE id != ? AND embedding IS NOT NULL`; parse each, `cosine`, sort desc, take 5, attach `similarity` rounded to 3 decimals, strip `embedding` before returning. (Known ceiling: this loads all vectors per request — fine at personal scale, but a few thousand items × ~15KB approaches D1/Worker response limits; v2 concern, leave a one-line comment in the route.)
**Verify:** `npm run build` passes. Manual: `GET /api/items/<id>/related` on a 2-item corpus returns ≤1 neighbour with a `similarity` number; on an item whose embedding is null returns `[]`.

### Task 11 — Connections + refine routes
**Depends on:** 7.
**Goal:** explicit-connection create/delete and the refine pair/pick endpoints.
**Files:** `server/api/connections/index.get.ts`, `server/api/connections/index.post.ts`, `server/api/connections/[id].delete.ts`, `server/api/refine/pair.get.ts`, `server/api/refine/pick.post.ts`.
**Key content:**
- connections GET: `SELECT * FROM connection ORDER BY created_at DESC` — all edges, no filters (personal scale; the palette joins client-side).
- connections POST: `{from_id,to_id,note?}`; 400 if equal or either missing; `[a,b]=orderedPair(from_id,to_id)`; `INSERT ... ON CONFLICT(from_id,to_id) DO NOTHING`. **`DO NOTHING` returns zero rows on duplicate** — after the insert, always `SELECT * FROM connection WHERE from_id=? AND to_id=?` and return that row (never return `undefined` on the dedupe path); `id=crypto.randomUUID()`, `created_at=now`.
- connections DELETE: by `id`, `{ ok:true }`.
- refine pair GET: **same-kind by default** (cross-kind comparison is a different question, offered deliberately, not by accident). Params: `?kind=` pins a kind; `?mix=true` enables the cross-kind wildcard mode. Default path: pick an eligible kind at random — `SELECT kind FROM taste_item WHERE status='captured' GROUP BY kind HAVING COUNT(*) >= 2 ORDER BY RANDOM() LIMIT 1` — then select the pair within it. Pair selection (all modes) uses **exposure weighting**, not bare RANDOM(): `ORDER BY (wins + losses) ASC, RANDOM() LIMIT 2` so least-seen items surface first and repeat pairings don't dominate a small pool. Return `{ a, b, mix: boolean }` or `{ a:null, b:null }` if no eligible pair.
- refine pick POST: `{ winner_id, loser_id }` (loser required; a skip sends no request). Winner: `UPDATE taste_item SET wins = wins + 1, updated_at=? WHERE id=?`; read back; if `wins >= PROMOTE_THRESHOLD` (3) and status still `captured` → `UPDATE ... SET status='canon', promoted_via='refine'`. Loser: `UPDATE taste_item SET losses = losses + 1, updated_at=? WHERE id=?`; read back; if `losses - wins >= ARCHIVE_THRESHOLD` (4) and status still `captured` → `UPDATE ... SET status='archived'` (the "let go" moment — surfaced in the UI, Task 16). Return `{ winner: item, loser: item, promoted: boolean, archived: boolean }`.
**Verify:** `npm run build` passes. Manual: two POSTs of the same pair (A,B) then (B,A) yield a single connection row AND both return the row (dedupe + fallback-select work); `POST /api/refine/pick` three times with one id as winner flips it to `canon` with `promoted_via='refine'`; four straight losses on a 0-win item flips it to `archived`.

---

## Phase C — Pages / UI

_All pages use the tufte primitives (`<MonoLabel>`, `<CardFrame>`, `<HairlineRule>`, `<ActionLabel>`) and `.tufte-input`. Mobile-first: `max-w-2xl mx-auto px-5`. Model page structure on `do-web/pages/index.vue` (already inspected: MonoLabel dash header, HairlineRule, filter row of mono-label buttons)._

### Task 12 — App shell + nav + item store composable
**Depends on:** 5, 7.
**Goal:** a shared nav header and a `useItems()` composable so pages don't re-implement fetch.
**Files:** create `components/AppNav.vue`, `composables/useItems.ts`; edit `app.vue` to render `<AppNav/>` above `<NuxtPage/>` (keep the existing `bg-paper text-ink font-serif` wrapper and `<AppToast/>`).
**Key content:**
- `AppNav.vue`: slim header, brand `<MonoLabel dash>taste-maker</MonoLabel>`, links to `/`, `/capture`, `/refine`, `/palette` using `<NuxtLink>`, active link in accent. `HairlineRule` under it.
- `useItems.ts`: `list(params)`, `get(id)`, `create(body)`, `patch(id,body)`, `remove(id)`, `related(id)`, `refinePair(opts?: {kind?, mix?})`, `refinePick(winnerId, loserId)`, `connections()`, `connect(from,to,note)`, `disconnect(id)` — thin `$fetch` wrappers over the API. Model on `do-web/composables/useTasks.ts` shape (useState store optional; simple per-page fetch is acceptable at this scale).
**Verify:** `npm run build` passes; nav renders (checked in Task 21 smoke test).

### Task 13 — Capture page
**Depends on:** 12.
**Goal:** fast, keyboard-friendly add form.
**Files:** `pages/capture.vue`.
**Key content:** kind selector (four mono-label toggle buttons quote/reference/music/art), `.tufte-input` fields: title, body (textarea — the quote/description, required), source_url, creator, note ("why it strikes me"), image_url (show only when kind==='art', but allow always). Submit via `useItems().create`; `Cmd/Ctrl+Enter` submits; on success toast + reset + keep focus for rapid entry; optionally redirect to `/item/[id]`. Disable submit when body empty.
**Verify:** `npm run build` passes. Manual: submitting creates an item and it appears in `/`.

### Task 14 — Library page
**Depends on:** 12.
**Goal:** browse all + filter by kind & status + search.
**Files:** `pages/index.vue`.
**Key content:** header (`<MonoLabel dash>Library</MonoLabel>` + count), a kind filter row and a status filter row (mono-label buttons like do-web's `FILTERS`), a `.tufte-input` search box (debounced, drives `?q=`). Results as a list/grid of item cards (`<CardFrame>`). **All four kinds render as themselves — no two kinds may share an identical card treatment** (this is the plan's stated differentiator):
- quote → large serif body + creator, pull-quote feel;
- art → `image_url` thumbnail dominant;
- music → oEmbed thumbnail (client-side fetch against Spotify/YouTube's public no-auth oEmbed endpoints using the `source_url` the user typed; graceful fallback to a music-glyph card if oEmbed fails — this is NOT URL auto-extraction, just a thumbnail lookup) + title + creator + a small play glyph;
- reference → text/link card with its own distinct type treatment (kind mono-label + different label weight) so it never reads as a music card.
Extract a shared `components/ItemCard.vue` doing the kind dispatch — Task 15's item page and Task 17's palette reuse the same kind-true rendering (larger variants). Each card links to `/item/[id]`. Empty state in muted italic.
**Verify:** `npm run build` passes. Manual: filters and search narrow the list; clicking a card opens the item.

### Task 15 — Item view page
**Depends on:** 12.
**Goal:** full item + related panel + connections + connect UI + promote/demote.
**Files:** `pages/item/[id].vue`.
**Key content:** render the item kind-appropriately via `ItemCard`'s large variant (art shows image, quote shows big serif body, music shows oEmbed thumb, all show creator/source/note). A faint mono **refine-standing indicator** when status is `captured` (e.g. `2/3` toward canon — `wins`/`PROMOTE_THRESHOLD`; omit when untouched). A **Related** section (Task 18 wires data) listing up to 5 neighbours with subtle similarity (e.g. a faint mono `0.82`), each linking to its item and offering a one-click "connect" (calls `connect`). An **explicit connections** section listing `connections[].other` with the optional note, each removable. A **promote** control: `<ActionLabel accent>` "Fast-track to palette" (PATCH status→canon; server marks `promoted_via='manual'`) — deliberately named as the bypass it is, distinct from refine-earned promotion; plus demote back to captured, and un-archive for archived items. A delete control (confirm).
**Verify:** `npm run build` passes. Manual: promote flips the item into `/palette`; adding a connection shows it on both endpoints' item pages.

### Task 16 — Refine page
**Depends on:** 12.
**Goal:** the A-vs-B ritual.
**Files:** `pages/refine.vue`.
**Key content:** same-kind pairing is the default; a deliberately named **"wildcard"** toggle enables cross-kind pairs (`?mix=true`) framed as an intentional provocation, and a kind pin is available. Fetch a pair via `refinePair`; render A and B side-by-side (stack on mobile) as kind-true `ItemCard`s, each with its faint `wins/3` progress marks. Three actions: pick A, pick B, skip. Pick → `refinePick(winnerId, loserId)`, then:
- **Promotion is a moment, not a toast**: when `promoted`, hold the winner for a beat (~600ms of stillness, its card gaining the accent), then navigate to `/palette?highlight=<id>` where the item arrives visibly (Task 17 handles the highlight-and-settle). Do not just toast-and-next.
- **Archival is a "let go", not a delete**: when `archived`, show a quiet one-line farewell on the loser's card ("let go — it can be recalled from the library") before the next pair loads.
- Otherwise load the next pair with a subtle session streak count (picks this sitting) in faint mono.
Keyboard: `←`/`→` pick, `space` skip. Empty/insufficient state ("Capture a couple more before refining") when no eligible pair. Deliberate, calm, ritual-feeling spacing.
**Verify:** `npm run build` passes. Manual: picking repeatedly promotes a winner to canon and it leaves the captured pool.

### Task 17 — Palette page
**Depends on:** 12.
**Goal:** the canon view — the app's face.
**Files:** `pages/palette.vue`.
**Key content:** query `?status=canon`, group by kind into four sections (Quotes / References / Music / Art), each with a `<MonoLabel dash>` heading and `HairlineRule`, **ordered `wins DESC, created_at DESC` within each group** — the most fought-for items lead. Render each kind as itself via `ItemCard`'s palette variant (quotes as pull-quotes, art as an image grid, music with oEmbed thumbs, references as elegant typed rows). **The palette reads as a constellation, not a grid**: for each canon item, show a quiet "in dialogue with: <Title>" line naming its connected canon items (from `connection` rows — fetch all canon-to-canon edges in one query and join client-side). Manually fast-tracked items (`promoted_via='manual'`) carry a small unobtrusive marker distinguishing them from refine-earned ones. Support `?highlight=<id>`: scroll to that item and give it a one-time larger/accented state that settles into place after a few hundred ms (the promotion arrival, Task 16). Empty state invites refining. This is the most designed page — generous whitespace, warm paper, one accent.
**Verify:** `npm run build` passes. Manual: promoted items appear here grouped by kind.

---

## Phase D — Embeddings + refine wiring

### Task 18 — Wire the related panel end-to-end
**Depends on:** 10, 15.
**Goal:** the item page's Related section reads live cosine neighbours and degrades silently.
**Files:** `pages/item/[id].vue` (+ `useItems().related`).
**Key content:** on mount, `related(id)`; if `[]`, hide the panel entirely (no "no matches" noise when the corpus is small — a bare hidden section is calmer). Show similarity subtly. One-click connect from a related row calls `connect` then refreshes connections.
**Verify:** Manual: create 3+ text-similar items with `NVIDIA_API_KEY` set → related panel shows neighbours ordered by similarity. Unset the key locally (or simulate NIM failure) → items still save, related panel is hidden, no error toast.

### Task 19 — Confirm refine promotion + palette reflect each other
**Depends on:** 11, 16, 17.
**Goal:** the loop closes: refine promotes → palette shows it → captured pool shrinks.
**Files:** none new (integration check across `pages/refine.vue`, `pages/palette.vue`, refine routes).
**Verify:** Manual end-to-end: with ≥4 captured items, run refine until one crosses threshold; confirm it appears in `/palette` and no longer surfaces in refine pairs (status no longer `captured`).

---

## Phase E — Deploy + domain + smoke test

### Task 20 — Create the owned D1, run migration, set secrets, wire CI
**Depends on:** 3, 6.
**Goal:** provision `taste-maker` D1, apply the migration, set Worker secrets + CI secrets, add the deploy workflow.
**Commands (run on Sleeper, where `NVIDIA_API_KEY` is in `~/.zshrc` and wrangler is authed):**
1. `cd /home/petter/github/taste-maker && npx wrangler d1 create taste-maker` → copy the returned `database_id` into `wrangler.toml`'s `TASTE_DB` block (replace `TODO_FILL_AFTER_D1_CREATE`).
2. `npx wrangler d1 migrations apply taste-maker --remote` → applies `0001_init.sql` to the production D1.
3. `npx wrangler secret put NVIDIA_API_KEY` → paste `$NVIDIA_API_KEY` (from `~/.zshrc`). (`NUXT_ALLOWED_USER_EMAILS` is a plain `[vars]`, not a secret.)
4. Create `.github/workflows/deploy.yml` — copy do-web's verbatim (checkout → setup-node 20 → `npm install` → `npm run build` → `cloudflare/wrangler-action@v3` with `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`, `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`, `command: deploy`). Then add a step **before** deploy that runs migrations against remote so CI keeps schema current: `command: d1 migrations apply taste-maker --remote` as a second `wrangler-action` step (or a `run: npx wrangler d1 migrations apply taste-maker --remote` step with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` env).
5. The new `phareim/taste-maker` GitHub repo needs repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (account_id = `bb0db86d8a64a70337bb44f43d00e4e5`). The local `gh` PAT may lack repo-secret-write; if `gh secret set` fails, note it as a manual dashboard step.
**Verify:** `npx wrangler d1 execute taste-maker --remote --command "SELECT name FROM sqlite_master WHERE type='table'"` lists `taste_item` and `connection`; `wrangler.toml` has a real UUID in the `TASTE_DB` block (no `TODO`).

### Task 21 — First deploy + custom domain binding
**Depends on:** 5, 20, and Phase C complete.
**Goal:** ship the Worker and bind `taste.phareim.no`.
**Commands (ordered by proven mechanism — the CI token bound do/write.phareim.no; the LOCAL token historically lacks DNS-edit perms, so a local deploy is the path most likely to fail on the domain step):**
1. **Primary: push to main and let CI deploy.** With Task 20's workflow + repo secrets in place, `git push origin main` → GitHub Actions builds and runs `wrangler deploy` with the CI `CLOUDFLARE_API_TOKEN`, which creates the `custom_domain=true` route + DNS record (this exact mechanism bound do.phareim.no and write.phareim.no on 2026-07-09). Watch the run with `gh run watch`.
2. Optional local smoke-check ONLY (before or instead of waiting on CI): temporarily comment out the `[[routes]]` block and `npm run build && npx wrangler deploy` to `*.workers.dev` — never attempt the domain bind from the local token. Restore the block before committing.
3. If the CI deploy fails on the custom-domain/DNS step, fall back to manual: Cloudflare dashboard (Workers & Pages → taste-maker → Settings → Domains & Routes → Add custom domain → `taste.phareim.no`), OR via API:
   `curl -X PUT "https://api.cloudflare.com/client/v4/accounts/bb0db86d8a64a70337bb44f43d00e4e5/workers/domains/records" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" -d '{"zone_name":"phareim.no","hostname":"taste.phareim.no","service":"taste-maker","environment":"production"}'`.
**Verify:** `getent hosts taste.phareim.no` resolves to Cloudflare IPs; `curl -sI https://taste.phareim.no/` returns a 200/302 from the Worker (not an SSL/hostname error).

### Task 22 — Smoke test (auth gate + core flow) + commit/push
**Depends on:** 21.
**Goal:** prove the login gate and the write path, then commit and push.
**Commands:**
1. **Unauthenticated bounce:** `curl -sI "https://taste.phareim.no/api/items"` → expect `401` (server route rejects no session). The page `/` served to a browser without the cookie redirects to `reader.phareim.no/login` via client middleware — verify the middleware is present (`grep -q "reader.phareim.no/login" composables/useAuth.ts`), since curl can't run client JS.
2. **Authenticated write** (with a valid `session_token` cookie for phareim@gmail.com): `curl -s -X POST https://taste.phareim.no/api/items -H "Cookie: session_token=<TOKEN>" -H "Content-Type: application/json" -d '{"kind":"quote","body":"Test quote","creator":"Anon"}'` → returns the created item with an `id`, no `embedding` field. Then `GET /api/items` includes it.
3. **Health of related/degradation:** create a second similar item, `GET /api/items/<id>/related` returns a neighbour with `similarity` (if `NVIDIA_API_KEY` set) or `[]` (graceful).
4. Update `README.md` (architecture summary, the two D1 bindings, deploy steps, V1 cut line). `git add -A && git commit` (Co-Authored-By trailer per repo convention) `&& git push origin main`.
**Verify:** unauth `curl` → 401; authed POST → item JSON with `id` and no `embedding`; `git status` clean and `git log origin/main` shows the push. If the custom domain is still pending (Task 21 fallback), file that as the one open follow-up in the README and commit anyway.

---

## Open follow-up (only if Task 21 fallback triggers)
`taste.phareim.no` custom-domain binding may require a manual Cloudflare dashboard step if the deploy token lacks DNS-edit perms (same gotcha as wiki-reader / phareim.md apex). The app is fully functional on `*.workers.dev` but **login only works on the custom domain** (the `session_token` cookie is scoped to `.phareim.no`), so the domain bind is load-bearing, not cosmetic — resolve it before calling V1 done.

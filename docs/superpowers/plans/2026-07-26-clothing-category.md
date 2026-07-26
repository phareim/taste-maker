# Clothing Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `clothing` as a fifth first-class `Kind` (alongside quote/reference/music/art) with its own bespoke card treatment, and move the existing "Adidas Gazelle" item into it.

**Architecture:** `Kind` is a closed string union mirrored between `types/taste.ts` and a SQLite `CHECK` constraint on `taste_item.kind`. Every kind has its own rendering branch in `ItemCard.vue` and its own entry in four kind-selector lists (`capture.vue`, `index.vue`, `palette.vue`, `refine.vue`). This plan widens the enum everywhere it appears, adds a new "Tag Card" rendering branch for clothing, and moves one specific row.

**Tech Stack:** Nuxt 3 (Vue 3 `<script setup>`), Tailwind, Cloudflare Workers + D1 (nitro `cloudflare-module` preset), `wrangler` CLI.

## Global Constraints

- **No test framework exists in this repo** (no vitest/jest/etc. in `package.json`). Per-task verification uses `npm run build` (catches Vue/TS compile errors) and, for the migration, a fully offline dry-run against a scratch SQLite file via the `sqlite3` CLI — not an automated test suite.
- **There is deliberately no local D1 seed story** (README: "Everything targets `--remote` D1; there is deliberately no `--local` seed story in v1"). All schema/data verification against real data happens via `wrangler d1 execute taste-maker --remote`.
- **Auth is domain-bound**: the session cookie is scoped to `.phareim.no`, so the only place to visually verify the running app is the deployed `taste.phareim.no` site, logged in as the allowed user. There is no way to load the full app locally with a real session.
- **Deploy is push-to-`main`-triggered**: `.github/workflows/deploy.yml` runs `npm run build` → `wrangler d1 migrations apply taste-maker --remote` → `wrangler deploy` on every push to `main`. Pushing to `main` and running `wrangler d1 execute --remote` are both actions visible to / affecting the live production app — **confirm with the user before running either**, even though this plan documents the exact commands.
- Follow existing code conventions: minimal comments (only for non-obvious "why"), Tailwind utility classes backed by the CSS custom-property tokens in `assets/css/tufte.css` (`bg-paper-raised`, `text-ink`, `text-mute`, `border-rule-strong`, etc. — these already handle dark mode), square corners (`border-radius: 0` aesthetic, no `rounded-*` classes), "kind-true rendering" (no kind shares a card template with another).
- New kind is **appended** at the end of every ordered list (`Quote / Reference / Music / Art / Clothing`) — the existing order is curated, not alphabetical.

---

### Task 1: Widen the `Kind` enum — types, migration, server validation

**Files:**
- Modify: `types/taste.ts:5`
- Create: `migrations/0003_clothing_kind.sql`
- Modify: `server/api/ingest/capture.post.ts:6`, `server/api/ingest/capture.post.ts:25`
- Modify: `server/api/items/index.post.ts:5`, `server/api/items/index.post.ts:15`

**Interfaces:**
- Produces: `Kind = 'quote' | 'reference' | 'music' | 'art' | 'clothing'` (consumed by every later task and by `ItemCard.vue`, `capture.vue`, `index.vue`, `palette.vue`, `refine.vue`). Produces `migrations/0003_clothing_kind.sql`, applied in Task 2.

- [ ] **Step 1: Widen the `Kind` type**

Edit `types/taste.ts:5`:

```ts
export type Kind = 'quote' | 'reference' | 'music' | 'art' | 'clothing'
```

- [ ] **Step 2: Write the migration**

Create `migrations/0003_clothing_kind.sql`:

```sql
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
```

- [ ] **Step 3: Dry-run the migration offline (no D1, no network)**

```bash
rm -f /tmp/taste_scratch.db
sqlite3 /tmp/taste_scratch.db < migrations/0001_init.sql
sqlite3 /tmp/taste_scratch.db < migrations/0002_external_ref.sql
sqlite3 /tmp/taste_scratch.db < migrations/0003_clothing_kind.sql
sqlite3 /tmp/taste_scratch.db "INSERT INTO taste_item (id, kind, body, status, wins, losses, created_at, updated_at) VALUES ('t1','clothing','test','captured',0,0,'2026-01-01','2026-01-01');"
sqlite3 /tmp/taste_scratch.db "SELECT kind FROM taste_item WHERE id='t1';"
sqlite3 /tmp/taste_scratch.db "INSERT INTO taste_item (id, kind, body, status, wins, losses, created_at, updated_at) VALUES ('t2','shoes','test','captured',0,0,'2026-01-01','2026-01-01');" ; echo "exit code: $?"
rm -f /tmp/taste_scratch.db
```

Expected:
- The three migration files run with no errors.
- `SELECT kind FROM taste_item WHERE id='t1'` prints `clothing`.
- The `id='t2'` insert (`kind='shoes'`) fails with `CHECK constraint failed: taste_item` and a non-zero exit code — this proves the widened CHECK still rejects invalid kinds.

- [ ] **Step 4: Update server-side kind validation**

Edit `server/api/ingest/capture.post.ts:6`:

```ts
const VALID_KINDS: Kind[] = ['quote', 'reference', 'music', 'art', 'clothing']
```

Edit `server/api/ingest/capture.post.ts:25`:

```ts
    throw createError({ statusCode: 400, statusMessage: 'kind (quote|reference|music|art|clothing) and non-empty body are required' })
```

Edit `server/api/items/index.post.ts:5`:

```ts
const VALID_KINDS: Kind[] = ['quote', 'reference', 'music', 'art', 'clothing']
```

Edit `server/api/items/index.post.ts:15`:

```ts
    throw createError({ statusCode: 400, statusMessage: 'kind (quote|reference|music|art|clothing) and non-empty body are required' })
```

- [ ] **Step 5: Build check**

```bash
npm run build
```

Expected: build succeeds with no TypeScript/Vue errors.

- [ ] **Step 6: Commit**

```bash
git add types/taste.ts migrations/0003_clothing_kind.sql server/api/ingest/capture.post.ts server/api/items/index.post.ts
git commit -m "feat: add clothing to the Kind enum"
```

---

### Task 2: Apply the migration to remote D1 and move the Adidas Gazelle item

**⚠️ This task mutates the production database. Confirm with the user before running these commands.**

**Files:** none (remote D1 only)

**Interfaces:**
- Consumes: `migrations/0003_clothing_kind.sql` from Task 1.
- Produces: live `taste_item.kind` CHECK constraint including `'clothing'`; the row `id = '5081209b-dab3-4739-945a-1ebb78323746'` (title "Adidas Gazelle") now has `kind = 'clothing'`.

- [ ] **Step 1: Apply the migration to remote D1**

```bash
npx wrangler d1 migrations apply taste-maker --remote
```

Expected: wrangler reports `0003_clothing_kind.sql` applied successfully (exit code 0).

- [ ] **Step 2: Verify the live schema accepts `clothing`**

```bash
npx wrangler d1 execute taste-maker --remote --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='taste_item'"
```

Expected: the returned `CREATE TABLE` text contains `'clothing'` in the `kind` CHECK constraint.

- [ ] **Step 3: Move the Adidas Gazelle item to `clothing`**

```bash
npx wrangler d1 execute taste-maker --remote --command "UPDATE taste_item SET kind = 'clothing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = '5081209b-dab3-4739-945a-1ebb78323746'"
```

Expected: `"changes": 1` in the result meta.

- [ ] **Step 4: Verify the move**

```bash
npx wrangler d1 execute taste-maker --remote --command "SELECT id, kind, title FROM taste_item WHERE id = '5081209b-dab3-4739-945a-1ebb78323746'"
```

Expected: one row, `"kind": "clothing"`, `"title": "Adidas Gazelle"`.

No commit — this task has no local file changes.

---

### Task 3: ItemCard.vue — clothing "Tag Card" rendering

**Files:**
- Modify: `components/ItemCard.vue:95-97` (insert new branch between the MUSIC block's closing `</div>` on line 95 and the REFERENCE comment on line 97)

**Interfaces:**
- Consumes: `TasteItem.kind === 'clothing'`, `TasteItem.image_url`, `TasteItem.title`, `TasteItem.body`, `TasteItem.creator`, `TasteItem.note`; the component-local `imgFailed` ref, and `isCard`/`isLarge`/`isPalette` computed refs already defined in this file.
- Produces: nothing consumed elsewhere — this is a leaf rendering branch.

- [ ] **Step 1: Insert the CLOTHING branch**

In `components/ItemCard.vue`, insert this block immediately after the MUSIC block's closing `</div>` (currently line 95) and before the `<!-- REFERENCE ... -->` comment (currently line 97):

```html
    <!-- CLOTHING — portrait product shot; brand pinned as a tag on the
         image corner (like a garment size tag), title as headline below. -->
    <div v-else-if="item.kind === 'clothing'">
      <div class="relative bg-paper-sunk overflow-hidden aspect-[3/4]">
        <img
          v-if="item.image_url && !imgFailed"
          :src="item.image_url"
          :alt="item.title || item.body"
          class="w-full h-full object-cover"
          loading="lazy"
          @error="imgFailed = true"
        />
        <div v-else class="w-full h-full flex items-center justify-center text-faint" style="font-size: 2rem;" aria-hidden="true">&#9638;</div>
        <span
          v-if="item.creator"
          class="absolute top-2 left-2 bg-paper-raised/90 border border-rule-strong px-1.5 py-0.5 font-mono uppercase text-mute"
          style="font-size: 9px; letter-spacing: 0.14em;"
        >{{ item.creator }}</span>
      </div>
      <div :class="isPalette ? 'pt-2' : 'p-4 sm:p-5'">
        <p v-if="item.title" class="text-ink" :class="isLarge ? 'text-xl' : ''">{{ item.title }}</p>
        <p v-else class="text-body" :class="isCard ? 'line-clamp-2' : ''">{{ item.body }}</p>
        <p v-if="item.title" class="mt-1 text-body" :class="isCard ? 'line-clamp-2' : ''">{{ item.body }}</p>
        <p v-if="isLarge && item.note" class="mt-3 text-body italic">{{ item.note }}</p>
      </div>
    </div>

```

Note: this must be `v-else-if`, positioned before the final `v-else` (REFERENCE) block, so `kind === 'clothing'` doesn't fall through to the reference treatment.

- [ ] **Step 2: Build check**

```bash
npm run build
```

Expected: build succeeds with no Vue template errors (unclosed tags, bad bindings, etc.).

- [ ] **Step 3: Commit**

```bash
git add components/ItemCard.vue
git commit -m "feat: add clothing card treatment to ItemCard"
```

---

### Task 4: capture.vue — clothing in the kind selector and form behavior

**Files:**
- Modify: `pages/capture.vue:44-47` (Image URL promotion, top position)
- Modify: `pages/capture.vue:54-57` (Creator/Brand field)
- Modify: `pages/capture.vue:59-62` (Image URL, bottom position)
- Modify: `pages/capture.vue:80-85` (`KINDS` list)
- Modify: `pages/capture.vue:100-108` (`bodyLabel`, `bodyPlaceholder`)

**Interfaces:**
- Consumes: `Kind` from Task 1.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add "Clothing" to the kind selector**

Edit `pages/capture.vue:80-85`:

```ts
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'quote', label: 'Quote' },
  { value: 'reference', label: 'Reference' },
  { value: 'music', label: 'Music' },
  { value: 'art', label: 'Art' },
  { value: 'clothing', label: 'Clothing' },
]
```

- [ ] **Step 2: Extend `bodyLabel` and `bodyPlaceholder` for clothing**

Edit `pages/capture.vue:100`:

```ts
const bodyLabel = computed(() => (kind.value === 'quote' ? 'Quote' : (kind.value === 'art' || kind.value === 'clothing') ? 'Description' : kind.value === 'music' ? 'Track' : 'Body'))
```

Edit `pages/capture.vue:101-108`:

```ts
const bodyPlaceholder = computed(() => {
  switch (kind.value) {
    case 'quote': return 'The words themselves — required'
    case 'art': return 'What it is, in a sentence — required'
    case 'clothing': return 'What it is, in a sentence — required'
    case 'music': return 'Track / album — required'
    default: return 'Short description — required'
  }
})
```

- [ ] **Step 3: Promote Image URL to the top for clothing too**

Edit `pages/capture.vue:44`:

```html
      <div v-if="kind === 'art' || kind === 'clothing'">
```

Edit `pages/capture.vue:59`:

```html
      <div v-if="kind !== 'art' && kind !== 'clothing'">
```

- [ ] **Step 4: Relabel Creator → Brand for clothing**

Edit `pages/capture.vue:54-57` from:

```html
      <div>
        <MonoLabel>Creator</MonoLabel>
        <input v-model="creator" type="text" class="tufte-input mt-1" placeholder="Author / artist / attribution" />
      </div>
```

to:

```html
      <div>
        <MonoLabel>{{ creatorLabel }}</MonoLabel>
        <input v-model="creator" type="text" class="tufte-input mt-1" placeholder="Author / artist / attribution" />
      </div>
```

Then add the `creatorLabel` computed next to `bodyLabel` (after `pages/capture.vue:100`, the `bodyLabel` line):

```ts
const creatorLabel = computed(() => (kind.value === 'clothing' ? 'Brand' : 'Creator'))
```

- [ ] **Step 5: Build check**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add pages/capture.vue
git commit -m "feat: add clothing to the capture form"
```

---

### Task 5: index.vue — clothing filter chip

**Files:**
- Modify: `pages/index.vue:73-79`

**Interfaces:**
- Consumes: `Kind` from Task 1.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add the filter**

Edit `pages/index.vue:73-79`:

```ts
const KIND_FILTERS: Array<{ key: KindFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'quote', label: 'Quote' },
  { key: 'reference', label: 'Reference' },
  { key: 'music', label: 'Music' },
  { key: 'art', label: 'Art' },
  { key: 'clothing', label: 'Clothing' },
]
```

- [ ] **Step 2: Build check**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add pages/index.vue
git commit -m "feat: add clothing filter to the library page"
```

---

### Task 6: palette.vue — clothing ordering, label, and grid layout

**Files:**
- Modify: `pages/palette.vue:68-74` (`KIND_ORDER`, `KIND_LABELS`)
- Modify: `pages/palette.vue:121-137` (`groupContainerClass`)

**Interfaces:**
- Consumes: `Kind` from Task 1.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Append clothing to the order and labels**

Edit `pages/palette.vue:68-74`:

```ts
const KIND_ORDER: Kind[] = ['quote', 'reference', 'music', 'art', 'clothing']
const KIND_LABELS: Record<Kind, string> = {
  quote: 'Quotes',
  reference: 'References',
  music: 'Music',
  art: 'Art',
  clothing: 'Clothing',
}
```

- [ ] **Step 2: Give clothing the same image-grid layout as art**

Edit `pages/palette.vue:121-137`:

```ts
function groupContainerClass(kind: Kind): string {
  switch (kind) {
    case 'quote':
      // Pull-quotes, stacked, generous breathing room between them.
      return 'mt-8 flex flex-col gap-14'
    case 'art':
    case 'clothing':
      // An image grid — the one place the palette reads as a wall, not a list.
      return 'mt-8 grid grid-cols-2 sm:grid-cols-3 gap-6'
    case 'music':
      return 'mt-8 flex flex-col gap-6'
    case 'reference':
    default:
      // Elegant typed rows — ItemCard's palette variant already sets the
      // per-row hairline, so the container itself needs no extra gap.
      return 'mt-6 flex flex-col'
  }
}
```

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add pages/palette.vue
git commit -m "feat: add clothing section to the palette page"
```

---

### Task 7: refine.vue — clothing kind-pin option

**Files:**
- Modify: `pages/refine.vue:131-137`

**Interfaces:**
- Consumes: `Kind` from Task 1.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add the pin option**

Edit `pages/refine.vue:131-137`:

```ts
const KIND_PIN_OPTIONS: Array<{ value: Kind | null; label: string }> = [
  { value: null, label: 'Any' },
  { value: 'quote', label: 'Quote' },
  { value: 'reference', label: 'Reference' },
  { value: 'music', label: 'Music' },
  { value: 'art', label: 'Art' },
  { value: 'clothing', label: 'Clothing' },
]
```

- [ ] **Step 2: Build check**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add pages/refine.vue
git commit -m "feat: add clothing to the refine kind pin"
```

---

### Task 8: Final build, deploy, and live verification

**⚠️ This task pushes to `main`, which triggers a production deploy. Confirm with the user before pushing.**

**Files:** none

**Interfaces:**
- Consumes: everything from Tasks 1–7 (all committed locally on `main`), plus the remote DB state from Task 2.

- [ ] **Step 1: Full local build**

```bash
npm run build
```

Expected: succeeds with no errors — this is the last local gate before shipping.

- [ ] **Step 2: Push to `main`**

```bash
git push
```

Expected: push succeeds; GitHub Actions (`.github/workflows/deploy.yml`) runs build → `d1 migrations apply --remote` (no-op, already applied in Task 2) → `wrangler deploy`.

- [ ] **Step 3: Watch the deploy**

```bash
gh run watch
```

Expected: the `Deploy to Cloudflare Workers` run completes successfully.

- [ ] **Step 4: Manually verify on the live site**

Open `https://taste.phareim.no` (log in as the allowed user if prompted) and check:
- `/` (Library): a "Clothing" filter chip appears; filtering by it shows the "Adidas Gazelle" item rendered as a Tag Card (portrait image, "ADIDAS" tag in the corner, title, description).
- `/palette`: a "Clothing" section appears after "Art", laid out as an image grid, containing the Adidas Gazelle item.
- `/capture`: a "Clothing" kind button exists; selecting it moves Image URL to the top, shows "Description" as the body label, and shows "Brand" as the creator field label.
- `/refine`: the kind-pin dropdown/selector includes a "Clothing" option.

No commit — this task is verification only.

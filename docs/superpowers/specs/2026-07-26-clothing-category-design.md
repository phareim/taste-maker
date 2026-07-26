# Clothing category — design

## Context

`taste_item.kind` is a closed enum: `quote | reference | music | art`, enforced by a SQLite `CHECK` constraint and mirrored in `types/taste.ts`. Every kind gets its own bespoke rendering in `ItemCard.vue` ("kind-true rendering" — no two kinds share a card treatment) and its own entries in the kind selector/filter/pin lists across `capture.vue`, `index.vue`, `palette.vue`, `refine.vue`.

The DB currently holds 17 items: 16 `quote`, 1 `art` — the "Adidas Gazelle" item (`id 5081209b-dab3-4739-945a-1ebb78323746`, title "Adidas Gazelle", body "Black Adidas Gazelle Shoes", creator "Adidas", has an image). This item is miscategorized as `art` and should become the first `clothing` item.

## Goal

Add `clothing` as a fifth first-class kind, with its own card treatment, and move the Adidas Gazelle item into it.

## Data model

### `types/taste.ts`
```ts
export type Kind = 'quote' | 'reference' | 'music' | 'art' | 'clothing'
```

### Migration `migrations/0003_clothing_kind.sql`
SQLite can't `ALTER` a `CHECK` constraint in place, so this is a table rebuild:
1. Create `taste_item_new` with the same shape as `taste_item`, but `kind CHECK (kind IN ('quote','reference','music','art','clothing'))`.
2. `INSERT INTO taste_item_new SELECT * FROM taste_item;` — copies all columns including `embedding`.
3. `DROP TABLE taste_item;`
4. `ALTER TABLE taste_item_new RENAME TO taste_item;`
5. Recreate the three indexes (`idx_item_kind`, `idx_item_status`, `idx_item_created`) and the `external_ref` unique index from migration `0002`.

Applied to remote D1 with `wrangler d1 migrations apply taste-maker --remote`.

### Server validation
`VALID_KINDS` arrays in `server/api/ingest/capture.post.ts` and `server/api/items/index.post.ts` both get `'clothing'` appended.

### Data move
After the migration lands:
```sql
UPDATE taste_item SET kind = 'clothing', updated_at = <now> WHERE id = '5081209b-dab3-4739-945a-1ebb78323746';
```
Run once, directly against remote D1 (`wrangler d1 execute taste-maker --remote --command "..."`), not via a migration file — this is a one-time data correction for one specific row, not a schema change.

## Card treatment — ItemCard.vue

New "Tag Card" branch, added as a new `v-else-if="item.kind === 'clothing'"` block before the final `v-else` (reference) fallback:

- Portrait image (`aspect-[3/4]`), `object-cover`, same lazy-load / broken-image fallback glyph pattern as ART and MUSIC.
- A small mono brand tag overlaid on the image's top-left corner: `item.creator`, uppercase, on a backdrop chip (reuses the visual language of `MonoLabel accent`, positioned `absolute` over the image). Hidden if `item.creator` is empty.
- Below the image: `item.title` as headline (or `item.body` if no title, matching ART's fallback), then `item.body` as muted description when a title is present.
- `item.note` shown in the `isLarge` variant only, same as the other three kinds.
- Sizing follows the existing `isCard` / `isLarge` / `isPalette` variant pattern already used by ART/MUSIC/QUOTE.

## Ordering

Appended at the end everywhere: `Quote / Reference / Music / Art / Clothing`. The existing order isn't alphabetical — it reads as a deliberately curated sequence (per `palette.vue`'s comment: "Section order per the plan") — so a new kind gets tacked on rather than triggering a reorder.

## Touch points

- **`pages/capture.vue`**
  - `KINDS` list: add `{ value: 'clothing', label: 'Clothing' }` at the end.
  - `bodyLabel`: `'clothing'` → `'Description'` (mirrors `'art'`).
  - `bodyPlaceholder`: `'clothing'` → `'What it is, in a sentence — required'` (mirrors `'art'`).
  - Image URL promotion: the `v-if="kind === 'art'"` / `v-if="kind !== 'art'"` pair both extend to include `'clothing'`, so Image URL is promoted to the top for clothing too.
  - Creator field label: "Brand" when `kind === 'clothing'`, "Creator" otherwise (same ternary pattern as `bodyLabel`).

- **`pages/index.vue`** — `KIND_FILTERS`: add `{ key: 'clothing', label: 'Clothing' }` at the end.

- **`pages/palette.vue`**
  - `KIND_ORDER`: append `'clothing'`.
  - `KIND_LABELS`: add `clothing: 'Clothing'`.
  - `groupContainerClass('clothing')`: same case as `'art'` — `'mt-8 grid grid-cols-2 sm:grid-cols-3 gap-6'` (equally image-forward, reads as a wall not a list).

- **`pages/refine.vue`** — `KIND_PIN_OPTIONS`: append `{ value: 'clothing', label: 'Clothing' }`.

## Out of scope

- No new DB columns (size, material, etc.) — clothing items use the existing `title`/`body`/`creator`/`image_url`/`note` shape, same as every other kind.
- No bulk re-categorization tooling — this is a single hand-run `UPDATE` for one known row.
- No changes to `/refine` pairing logic, connections, or embeddings beyond what falls out of the enum change.

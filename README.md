# taste-maker

A single-user, writable **taste library**: capture the quotes, pop-culture
references, music, visual art, and clothing that strike you; browse and search
them; see
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

Two tables — one `taste_item` shape for all five kinds (kind-specific rendering
is a UI concern), one `connection` edge table. Full DDL in
`migrations/0001_init.sql`; the `kind` CHECK is widened in
`migrations/0003_clothing_kind.sql`.

- `taste_item`: `id, kind, title, body, source_url, creator, note, image_url,
  status, wins, losses, promoted_via, embedding, created_at, updated_at`.
  - `kind ∈ {quote, reference, music, art, clothing}`
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
  Chrome extension (`extension/`) **and** the iOS Share Extension (`ios/`) to
  capture without a browser session. Auth is `Authorization: Bearer` with
  **either `TASTE_EXTENSION_KEY` or `TASTE_IOS_KEY`** — two secrets, one door,
  so either client can be rotated without touching the other. Both are separate
  from `TASTE_INGEST_KEY` (client-held keys are a different trust boundary than
  Worker-held ones). CORS-scoped to the Chrome extension's fixed origin (see
  `server/utils/cors.ts`); handles its own `OPTIONS` preflight.
- `POST /api/ingest/capture-image` — raw image bytes (`image/jpeg|png|heic|webp`),
  max 8MB or `413`. Stores the object in the `taste-maker-images` R2 bucket
  (binding `TASTE_IMAGES`) and returns `{url}` for the caller to pass back as a
  normal `image_url`. Exists because iOS Share Sheet photos are bytes with no
  URL, unlike Chrome's right-click-on-image — this keeps `/api/ingest/capture`'s
  JSON contract untouched. Auth `Bearer <TASTE_IOS_KEY>`; no CORS (native only).
- `GET /api/images/[key]` — serves those objects back. **No auth**: the same
  visibility as every other `image_url` in the library, which are arbitrary
  public URLs. Keys are UUIDs and objects are never overwritten, so responses
  are `immutable`-cached for a year.
- `POST /api/ingest/enrich` — `{url?, shared_text?, has_image?, page?}` →
  `{kind, kind_confidence, kind_reason, title, creator, creator_source,
  image_url, source_url}`. Suggests a kind and a creator for something the iOS
  Share Extension is about to capture; see "Capture enrichment" below. Auth
  `Bearer <TASTE_IOS_KEY>`; no CORS. **Never fails loudly** — every error path
  returns 200 with null fields, because the client already has its own local
  guess and enrichment must never block a capture.

Auth for `/api/ingest/highlight*`: `Authorization: Bearer <TASTE_INGEST_KEY>`
(Worker secret; host-side copy in `~/.config/taste/env`, shared with Reader
as `NUXT_TASTE_INGEST_KEY`). Auth for `/api/ingest/capture`:
`Authorization: Bearer <TASTE_EXTENSION_KEY>` (separate Worker secret, held
only by the Chrome extension). Auth for `/api/ingest/capture-image` and
`/api/ingest/enrich`: `Authorization: Bearer <TASTE_IOS_KEY>` (third Worker
secret, held only in the iOS app's Keychain). All three: 503 when the relevant
secret is unset, 401 on mismatch. Reader's side of the highlight pipe
(mirror-on-create, undo-on-delete, backfill script) lives in the reader repo.

## Chrome extension (`extension/`)

A personal, unpublished Manifest V3 extension — load unpacked via
`chrome://extensions` → Developer mode → Load unpacked → select `extension/`.
Captures from any page without a browser session, via
`POST /api/ingest/capture` (see above) rather than the session-gated
`/api/items`.

- **Toolbar icon** — opens a popup prefilled from the active tab: a text
  selection on the page defaults to `kind=quote` with that selection as the
  body; no selection defaults to `kind=reference`.
- **Right-click a selection** → "Capture to taste library" → same popup,
  `kind=quote`, prefilled with the selection.
- **Right-click an image** → "Capture to taste library" → same popup,
  `kind=art`, prefilled with the image URL.
- **Setup**: open the extension's options page and paste the
  `TASTE_EXTENSION_KEY` value (generated via `openssl rand -hex 32`, set on
  the Worker via `wrangler secret put TASTE_EXTENSION_KEY`) — stored in
  `chrome.storage.sync`.

## iOS Share Extension (`ios/`)

A personal, unpublished app installed via Xcode onto your own device. Capture
from any app's Share Sheet without opening Safari.

Three targets, generated by `xcodegen` from `ios/project.yml`:

- **TasteCapture** (`no.phareim.tastecapture`) — host app, one screen: paste the
  `TASTE_IOS_KEY`. Exists only because an extension can't present settings of
  its own; the extension deep-links here via `tastecapture://settings`.
- **TasteCaptureShare** (`no.phareim.tastecapture.share`) — the capture form.
- **TasteCaptureKit** — shared Swift package: `CaptureClient`, `EnrichClient`,
  `LocalRouter`, `KeychainStore`. The only part with automated tests
  (`cd ios/TasteCaptureKit && swift test`).

The two binaries are separate processes; they share the key through one
keychain-access-group and an App Group (`group.no.phareim.tastecapture`).

**Kind routing.** iOS gives a share extension **no way to learn which app
invoked it** — there is no public API for the host app's bundle ID. So routing
is driven by the shared URL's host instead. Every music and clothing app worth
capturing from shares a URL, so the result is the same in practice. `LocalRouter`
holds a small offline subset for an instant guess; `server/utils/enrich/` is
authoritative and refines it a moment later. **The two lists will drift, and
that's fine** — keeping the real table server-side is what lets it be tuned with
a deploy rather than a reinstall.

Precedence: a text selection always wins and becomes a `quote`; then the host
match; then a bare photo becomes `art`. An unrecognized source leaves **no kind
selected and Save disabled** — deliberately unlike the Chrome extension, which
quietly defaults to `reference`.

**Editing the project:** `ios/project.yml` is the only thing you edit; run
`cd ios && xcodegen generate` afterwards and commit the result. The
`.xcodeproj`, the shared scheme and the generated `Info.plist`/`.entitlements`
files **are tracked** — Xcode Cloud clones the repo and can't run xcodegen, so
it needs them to exist. Regeneration is byte-stable, so this doesn't churn.
Never hand-edit any of them; xcodegen overwrites them on every run.

### Build & deploy

Two paths, neither needing the Xcode GUI. Same rig as `sfl` and `sleeper-chat`
— see `docs/superpowers/specs/2026-07-31-xcode-cloud-testflight-design.md`.

**1. Direct to a plugged-in device (~1 min)**

```bash
ios/scripts/deploy-to-phone.sh          # first paired iPhone
ios/scripts/deploy-to-phone.sh <udid>   # a specific device
```

Regenerates the project, then wraps `xcodebuild` + `xcrun devicectl`. This is a
paid developer account, so dev builds last until the signing certificate
expires, not 7 days. List devices with `xcrun devicectl list devices`.

**2. TestFlight, over the air (~10–15 min)**

Xcode Cloud → TestFlight internal testing. Everything mechanical is done and
verified — bundle IDs registered, and a real signed App Store `.ipa` exports
cleanly. **Two account-side steps remain**, both GUI-only: create the App Store
Connect *app record*, then create the Xcode Cloud workflow. See the spec above.
Once done: push to `main`, then App Store Connect → Xcode Cloud → Builds →
**Start Build**.

**3. TestFlight without Xcode Cloud (~5 min) — this is the working path**

```bash
source ~/.config/taste/asc-env && ios/scripts/testflight.sh
```

Archives, exports, validates and uploads. Credentials are already set up:
the API key is in `~/.appstoreconnect/private_keys/` (altool finds it there)
and the key/issuer IDs are in `~/.config/taste/asc-env`, both `600`.

The App Store listing is **Bowerbird** (Apple ID `6796821103`) — a bird that
collects beautiful objects and arranges them to its own taste, which is the
app. The home-screen name stays `taste-maker`, matching the T icon. Build 1.0
(1) shipped 2026-07-31 to the `Internal` group.

Bump `CFBundleVersion` in `project.yml` before each upload — App Store Connect
rejects a build number it has already seen.

> Beware: the `.p8` in `~/Downloads/2026` is sleeper-chat's **APNs** key, not
> an ASC key. It looks identical and will always 401 against the ASC API.

> Assume the push auto-trigger does **not** work. It has never worked for
> `sleeper-chat` (Xcode Cloud is never notified of pushes; the GitHub App,
> its permissions and the path rule were all ruled out), so press Start Build.

TestFlight builds expire after **90 days**.

**Setup on the phone:** open the app once and paste the `TASTE_IOS_KEY`.

### Gotchas

- **The `TasteCapture` scheme must stay shared** (committed under
  `TasteCapture.xcodeproj/xcshareddata/xcschemes/`). Xcode Cloud only builds
  shared schemes and pins the app target by UUID. xcodegen's UUIDs are derived
  from target names, so they survive regeneration — but renaming a target will
  break cloud builds until the scheme is regenerated.
- **`INFOPLIST_KEY_*` build settings do nothing here.** They only apply with
  `GENERATE_INFOPLIST_FILE = YES`; these targets have an explicit `info.path`,
  so such keys must go in `project.yml`'s `info.properties`. The build gives no
  warning — it silently drops them.
- **`SKIP_INSTALL: YES` on the extension is load-bearing** and xcodegen won't
  add it. Without it the `.appex` archives as a top-level product and the
  TestFlight upload is rejected.
- **`exportArchive` exit code 70** with everything else green is a transient
  Apple managed-signing fault — rebuild.
- **`ITMS-90129`** means the display name is taken on the App Store; change
  `CFBundleDisplayName` in `project.yml`.

## Capture enrichment (`server/utils/enrich/`)

Powers `POST /api/ingest/enrich`: given a shared URL, work out **which kind**
the item is and **who made it**, so a capture is ideally zero typing.

Four files, all pure functions except the route itself:

- `domains.ts` — the kind-routing table. `open.spotify.com` → `music`,
  `cos.com` → `clothing`, `artsy.net` → `art`, and so on. **This is the file
  meant to be appended to**; adding a host is one line and a deploy.
- `metadata.ts` — normalizes a page's head into `{title, meta, jsonLd}`, from
  either a Worker-side fetch (parsed with `HTMLRewriter`, native to the Workers
  runtime, so no HTML-parsing dependency) or from metadata the iOS extension's
  JS preprocessor already scraped out of the live DOM.
- `classify.ts` — kind + a confidence. Precedence: a text selection → `quote`
  (beats everything — selecting a lyric on a Spotify page is a quote, not a
  music item), then the domain table, then schema.org types (`Product` →
  clothing, which is what catches *unlisted* retailers; `Article` → reference),
  then a bare photo → art. **Only `high` confidence auto-selects a kind**;
  anything less is offered as a suggestion and the user still picks.
- `creator.ts` — the inference ladder, first rung to produce a usable value
  wins, and each carries a provenance string shown under the field:
  1. kind-aware JSON-LD (`MusicAlbum.byArtist`, `Product.brand`,
     `VisualArtwork.creator`, `Article.author`)
  2. Open Graph music vertical (`music:musician`)
  3. plain author meta — and, when that meta is a *profile URL* rather than a
     name, the author slug in its path (`/profile/dalya-alberge` → "Dalya Alberge")
  4. per-host extractors (Spotify's `·`-delimited `og:description`, Apple
     Music's "X by Y", a Bandcamp artist subdomain, SoundCloud, GitHub, Medium,
     Substack, Instagram)
  5. title patterns — `"X by Y"`, and a trailing `—`/`|`/`:` segment, **but
     only when that segment isn't the site's own name**, or every article would
     be attributed to its masthead
  6. the Share Sheet's own text ("Dreams by Fleetwood Mac")
  7. nothing — leave it blank

  There is deliberately **no model in this path**. It is all deterministic
  rules, and every result is normalized (entities decoded, `®`/`™` and legal
  suffixes stripped, YouTube's `- Topic` removed) then rejected if it is over
  80 chars, a URL, or identical to the title. A blank `creator` beats a
  confident wrong one, because a wrong one gets silently committed to the
  library.

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

Two entries left this list with the iOS Share Extension: **URL auto-extraction**
(now `server/utils/enrich/`, though only on the ingest path — pasting a URL into
`/capture` still scrapes nothing) and **R2 / file uploads** (now
`/api/ingest/capture-image`, though only for iOS photo shares — the web form
still hotlinks image URLs only).

- Claude-written rationale for items or connections
- Active web discovery / search for new taste
- SFL / sleeper-articles integration
- Graph visualization of the connection web
- Local D1 dev seed + offline story
- Tuning the refine thresholds against real usage data

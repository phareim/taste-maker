# iOS Share Extension for taste-maker capture

Design spec. Companion to `docs/superpowers/specs/2026-07-14-chrome-extension-design.md`
(the Chrome extension) — same job, different platform: capture a quote,
reference, music, or art item into taste-maker from iOS's native Share
Sheet, without opening Safari and navigating to `/capture`. Personal,
unpublished, single-user — installed via Xcode onto your own device (paid
Apple Developer account available; TestFlight is an option later, not part
of this plan).

## Goal

From any iOS app that can share text, a link, or a photo (Safari, Notes,
Photos, Music, etc.), invoke the Share Sheet and capture directly into
taste-maker.

## Non-goals (explicitly out of scope)

- App Store submission. Installed via Xcode ("Run" onto a device) or,
  later, TestFlight — neither is part of this plan's scope.
- Android.
- Offline queueing/retry — a failed request shows an error; retry is
  manual.
- Editing or deleting existing items from the extension — capture only,
  matching `/capture`'s own scope.
- Batch/multi-item sharing — one text, URL, or image at a time, same as
  Chrome's single-selection/single-image context menu.
- Any change to the existing web app's `/capture` page, `/api/items`, or
  the Chrome extension's routes/contracts.

## Architecture

Two pieces, alongside the Chrome extension work:

1. **Backend** (this repo): a third Bearer-authed ingest secret
   (`TASTE_IOS_KEY`), reusing the existing `POST /api/ingest/capture` route
   as-is for item creation, plus two small new routes and a new R2 bucket
   for photo uploads (see below).
2. **iOS**: a new Xcode project (`ios/`) with three targets — a minimal
   **host app** (`TasteCapture`, key entry only), a **Share Extension**
   (`TasteCaptureShare`, the actual capture UI), and a shared Swift package
   (`TasteCaptureKit`) holding the networking client and Keychain helper so
   logic isn't duplicated between the two binaries.

### Why a third secret instead of reusing `TASTE_EXTENSION_KEY`

Following the precedent already set between `TASTE_INGEST_KEY` (Reader,
Worker-held) and `TASTE_EXTENSION_KEY` (Chrome, Chrome-sync-held): a key
living in iOS Keychain (shared via an App Group access group between two
process) is its own trust boundary, distinct from Chrome sync storage or a
Worker's config. Independently rotatable, same `requireIngestKey` gate.

### Why raw photo upload needs new backend surface

Unlike Chrome's right-click-on-image (which always has a `src` URL to hand
over directly), iOS Share Sheet photos are usually raw image data with no
URL — e.g. sharing from the Photos app. `image_url` is a plain string
column; there's no image storage in this codebase today. Rather than
bolting upload support onto `/api/ingest/capture`'s JSON contract, a
dedicated upload route hands back a URL, and the existing capture route is
called normally with it — two small requests, no contract change to the
route the Chrome extension already depends on.

When the share payload *does* include a URL alongside the image (common
when long-pressing an image in Safari), the extension skips the upload
entirely and uses that URL directly — same as Chrome.

## Backend changes

### New secret: `TASTE_IOS_KEY`

- `requireIngestKey`'s `envKey` parameter type grows a third member:
  `'TASTE_INGEST_KEY' | 'TASTE_EXTENSION_KEY' | 'TASTE_IOS_KEY'`. No other
  change to the function's behavior.
- Set via `wrangler secret put TASTE_IOS_KEY`, documented in README
  alongside the other two.

### New R2 bucket: `taste-maker-images`

- `wrangler r2 bucket create taste-maker-images` (one-time, run at
  deploy/setup time, not part of a migration).
- New binding in `wrangler.toml`:
  ```toml
  [[r2_buckets]]
  binding = "TASTE_IMAGES"
  bucket_name = "taste-maker-images"
  ```

### `POST /api/ingest/capture-image`

New file: `server/api/ingest/capture-image.post.ts`.

- **Auth**: `Authorization: Bearer <TASTE_IOS_KEY>` via
  `requireIngestKey(event, 'TASTE_IOS_KEY')`.
- **Body**: raw image bytes, `Content-Type: image/jpeg`. Reject bodies over
  8MB with `413` before touching R2 — plenty of headroom for a
  extension-downscaled photo (see iOS section), keeps Worker/R2 usage
  bounded.
- **Behavior**: generate `` `${crypto.randomUUID()}.jpg` `` as the object
  key, `env.TASTE_IMAGES.put(key, bytes, { httpMetadata: { contentType:
  'image/jpeg' } })`.
- **Response**: `{ url: "https://taste.phareim.no/api/images/<key>" }`.
- **CORS**: none needed. This route is only ever called from the native
  app via `URLSession`, never a browser — no preflight is issued, unlike
  the Chrome extension's `capture` route.

### `GET /api/images/[key]`

New file: `server/api/images/[key].get.ts`.

- **Auth**: none. Same visibility as any other `image_url` already
  rendered in the library UI today (those are already arbitrary public
  URLs) — this just adds one more source for that column.
- **Behavior**: `env.TASTE_IMAGES.get(key)`; `404` if missing. Streams the
  object body, sets `Content-Type` from the stored metadata, and a long
  `Cache-Control: public, max-age=31536000, immutable` (keys are UUIDs,
  objects are never overwritten).

### New secret + README

Both `TASTE_IOS_KEY` and the R2 bucket documented in README's ingest
section, alongside `TASTE_INGEST_KEY` and `TASTE_EXTENSION_KEY`.

## iOS project (`ios/`)

### Targets

- **TasteCapture** (host app) — bundle ID `no.phareim.tastecapture`.
- **TasteCaptureShare** (Share Extension) — bundle ID
  `no.phareim.tastecapture.share`.
- **TasteCaptureKit** (shared Swift package, imported by both) —
  `CaptureClient` (POSTs to `/api/ingest/capture` and
  `/api/ingest/capture-image`) and a Keychain helper (read/write the
  ingest key).

### Sharing state across the process boundary

Host app and extension run as separate processes. Both targets are
entitled with:
- App Group `group.no.phareim.tastecapture`.
- A shared Keychain access group — the ingest key is written here by the
  host app, read here by the extension.

### Share Extension activation

`NSExtensionActivationRule` (Info.plist): accepts exactly one text item,
one URL, or one image at a time (`MaxCount = 1` per type) — single-item
capture only.

### Prefill logic

A JS preprocessing file (`SharePreprocessor.js`, wired via
`NSExtensionJavaScriptPreprocessingFile` — the standard mechanism Safari
share extensions use to read page context) returns `{title: document.title,
url: document.URL, selection: window.getSelection().toString()}`. This is
the iOS analog of the Chrome popup's `window.getSelection().toString()`
injection.

1. Selection text present → `kind = quote`, `body` = selection,
   `title`/`source_url` from the page.
2. No selection, URL present → `kind = reference`, `source_url`/`title`
   from the page.
3. Image attachment present, URL also present in the payload (e.g.
   long-press an image in Safari) → `kind = art`, `image_url` = that URL
   directly, no upload.
4. Image attachment present, no URL (e.g. shared from Photos) → `kind =
   art`, image held in memory; on submit, downscaled (max 1600px longest
   side, JPEG ~0.8 quality — well under the extension's ~120MB memory
   ceiling and the backend's 8MB cap) and uploaded via `capture-image`,
   then the returned URL is used as `image_url`.

### UI

SwiftUI form hosted in the extension's `UIViewController`. Same field set
and layout logic as the Chrome popup: kind pills (Quote/Reference/Music/
Art), title, body, source URL, image URL (shown only when `kind = art`),
creator, note. Hardware-keyboard `Cmd+Return` submits, matching the web
form and Chrome popup convention.

**Submit**: read the key from the shared Keychain group.
- Missing key → inline prompt; tapping it calls
  `extensionContext.open(url:)` with a custom URL scheme
  (`tastecapture://settings`) to deep-link into the host app (extensions
  can't present their own settings UI) — no request attempted.
- 401 → inline "check your key in the app" message.
- 400 → inline message, form stays populated.
- 413 (image too large after downscale) → inline "image too large"
  message.
- Network failure / 5xx → generic inline error, form stays populated.
- Success → `extensionContext.completeRequest(returningItems: nil)`
  dismisses the share sheet.
- Cancel button always available via
  `extensionContext.cancelRequest(withError:)`.

### Host app (`TasteCapture`)

Single SwiftUI screen: secure text field for the ingest key, Save button,
writes to the shared Keychain group. No other functionality — mirrors the
Chrome extension's options page exactly. Registers the `tastecapture://`
URL scheme (`CFBundleURLTypes` in its Info.plist) so the extension's
`tastecapture://settings` deep link opens this screen directly; the app
ignores the path beyond routing to the one screen it has.

## Error handling summary

| Condition | Behavior |
|---|---|
| No key saved | Inline prompt, deep-links to host app; no request attempted |
| 401 (bad/rotated key) | Inline "check your key in the app" message |
| 400 (validation, e.g. empty body) | Inline message, form stays populated |
| 413 (image too large after downscale) | Inline "image too large" message |
| Network failure / 5xx | Generic inline error, form stays populated |

## Testing

Manual only, matching this project's existing convention (no test
framework in the repo, no local D1 seed — verified against the deployed
remote Worker):

1. Deploy the backend changes (new routes, R2 bucket, `TASTE_IOS_KEY`
   secret).
2. Build and run `TasteCapture` + `TasteCaptureShare` onto a device from
   Xcode. Set the ingest key via the host app.
3. Select text in Safari → Share → confirm `kind=quote`, body = selection,
   source_url = page URL; submit; confirm the item appears in the library.
4. Share a link with no selection → confirm `kind=reference`.
5. Long-press an image in Safari → Share → confirm `kind=art`, `image_url`
   prefilled directly, no upload triggered.
6. Share a photo from the Photos app → confirm `kind=art`, image
   downscaled and uploaded via `capture-image`, item created with the
   returned `image_url`, and the image renders correctly when fetched from
   `GET /api/images/[key]`.
7. Clear the saved key on the host app → confirm the extension's "no key"
   prompt appears and deep-links back to the host app; no request fires.
8. Set an intentionally wrong key → confirm the 401 path is distinguished
   from a generic failure.
9. Attempt to share an oversized photo (or lower the size cap temporarily
   for the test) → confirm the 413 path.

## Out of scope (explicit)

App Store submission, Android, offline queueing/retry, editing/deleting
existing items from the extension, batch/multi-item sharing, any change to
`/capture`, `/api/items`, or the Chrome extension's routes/contracts.

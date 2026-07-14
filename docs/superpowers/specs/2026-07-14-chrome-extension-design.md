# Chrome extension for taste-maker capture

Design spec. Companion to `docs/plans/2026-07-13-taste-maker-v1.md`, which
explicitly parked "share-sheet / bookmarklet capture" for v2 — this is that
parked feature, built as a Manifest V3 Chrome extension instead of a
bookmarklet.

## Goal

Capture a quote, reference, music, or art item into taste-maker from any web
page, without switching to a `taste.phareim.no` tab first. Personal,
unpublished, single-user extension — not a Chrome Web Store listing.

## Non-goals (explicitly out of scope)

- Chrome Web Store publishing, or any distribution beyond loading unpacked
  locally.
- Firefox / Safari ports.
- Drag-and-drop capture, multi-image capture, offline queueing/retry.
- Any change to the existing web app's `/capture` page or its session-based
  `/api/items` auth.

## Architecture

Two pieces, in the existing repo:

1. **Backend**: one new server-to-server-style ingest route, following the
   existing `/api/ingest/*` pattern (`server/api/ingest/highlight.post.ts`)
   rather than touching the session-gated `/api/items` route.
2. **Extension**: a new top-level `extension/` directory in this repo — kept
   here rather than a separate repo because it's tightly coupled to this
   backend's API contract, and this is a personal single-user tool where
   repo-splitting overhead isn't worth it.

### Why a new ingest route instead of reusing `/api/items`

`/api/items` is gated by `requireAllowedUser` (Reader session cookie).
Cross-site cookie delivery from an extension-initiated fetch is unreliable
(SameSite policy treats `chrome-extension://` as a different site), so the
extension can't reliably ride the existing browser session. The codebase
already has a precedent for this exact problem — Reader's highlight mirror
authenticates via a Bearer secret instead of a session
(`server/utils/cloudflare.ts: requireIngestKey`). The extension follows the
same pattern with its own dedicated route and secret, keeping `/api/items`'s
existing session-only contract untouched and keeping all Bearer-auth routes
under the `/api/ingest/*` namespace.

Some INSERT logic will be duplicated between `items/index.post.ts` and the
new route, mirroring the duplication that already exists between
`items/index.post.ts` and `highlight.post.ts` — consistent with, not a
deviation from, the current codebase.

## Backend changes

### `POST /api/ingest/capture`

New file: `server/api/ingest/capture.post.ts`.

- **Auth**: `Authorization: Bearer <TASTE_EXTENSION_KEY>` — a **new, dedicated
  secret**, separate from `TASTE_INGEST_KEY`. Rationale: a key that lives in
  browser extension storage is more exposed than one living in a Worker's
  config (e.g. a Chrome-sync compromise), so it should be independently
  rotatable without touching the Reader↔taste-maker pipe.
  - `requireIngestKey` in `server/utils/cloudflare.ts` gets a second
    parameter for the env var name (default `'TASTE_INGEST_KEY'`), so both
    routes share the same 503-if-unset / 401-if-mismatch logic:
    `requireIngestKey(event, 'TASTE_EXTENSION_KEY')`.
- **Body**: `{kind, title?, body, source_url?, creator?, note?, image_url?}`.
  Same validation as `POST /api/items`: `kind` must be one of
  `quote|reference|music|art`, `body` must be a non-empty trimmed string
  (400 otherwise).
- **Behavior**: same shape as `items/index.post.ts` — generate `id`/`now`,
  compute the embedding best-effort via `embedText` (NULL on any failure,
  never blocks the write), INSERT with `status = 'captured'`,
  `promoted_via = NULL`, no `external_ref` (this is a one-shot user action
  from a popup form, not a resendable webhook sync — unlike the highlight
  mirror, idempotency isn't needed here).
- **Response**: the created row (same `ITEM_COLUMNS` shape returned by
  `POST /api/items`).
- **CORS**: the one real difference from the existing ingest route.
  `highlight.post.ts` is called Worker-to-Worker — no browser, no CORS. This
  route is called from the extension's popup, a `chrome-extension://<id>`
  origin, so it needs:
  - An `OPTIONS` preflight handler (required because `Authorization` is a
    non-simple header).
  - `Access-Control-Allow-Origin` scoped to the extension's own
    `chrome-extension://<id>` origin (not `*`), plus
    `Access-Control-Allow-Methods: POST, OPTIONS` and
    `Access-Control-Allow-Headers: Authorization, Content-Type` on both the
    preflight and the actual response.

### New secret

`TASTE_EXTENSION_KEY`, set via `wrangler secret put TASTE_EXTENSION_KEY`,
same mechanism as `NVIDIA_API_KEY`/`TASTE_INGEST_KEY`. Documented in
`README.md`'s ingest section alongside the existing key.

## Extension (`extension/`)

### Manifest

Manifest V3. `permissions: ["storage", "contextMenus", "activeTab",
"scripting"]`. `host_permissions: ["https://taste.phareim.no/*"]` (needed for
the popup's fetch to the API). `action.default_popup` points at
`popup.html`.

### Triggers

1. **Toolbar icon click** → opens the default popup. `popup.js`, on load,
   queries the active tab for title/URL and injects a one-line
   `chrome.scripting.executeScript` call to read
   `window.getSelection().toString()`.
   - Selection present → `kind = 'quote'`, `body` = selection.
   - No selection → `kind = 'reference'`, `body` empty, `title`/`source_url`
     from the tab.
2. **Right-click on selected text** → context menu item "Capture to taste
   library" (registered in `background.js` on install, scoped to
   `contexts: ["selection"]`). The background service worker writes
   `{kind: 'quote', body: selection, title: tab.title, source_url: tab.url}`
   to `chrome.storage.session`, then opens a small popup window
   (`chrome.windows.create({type: 'popup', ...})` loading `popup.html`).
3. **Right-click on an image** → context menu item scoped to
   `contexts: ["image"]`. Same path, with
   `{kind: 'art', image_url: info.srcUrl, source_url: tab.url}`.

`popup.js` distinguishes "opened as the default toolbar popup" (do the
live tab/selection lookup) from "opened as a context-menu popup window"
(read the pending payload from `chrome.storage.session` instead, then clear
it).

### Popup UI

Plain hand-written HTML/CSS — no build step for something this small.
Visually consistent with the web app: colors and fonts copied as static CSS
values from `assets/css/tufte.css`'s light-mode tokens (warm paper `#fbf9f4`,
crimson accent `#c1351d`, ET Book / mono), not a shared build artifact.

Fields, mirroring `pages/capture.vue`: kind pills (Quote/Reference/Music/Art),
title, body (autofocus, prefilled per the trigger logic above), source URL
(prefilled from the tab, editable), image URL (shown prominently when
`kind === 'art'`, otherwise present lower in the form — same conditional
positioning as the web form), creator, note. `Cmd/Ctrl+Enter` submits, same
convention as the web form.

**Submit**: reads the key from `chrome.storage.sync`; if absent, shows an
inline prompt linking to `chrome.runtime.openOptionsPage()` instead of
attempting the request. Otherwise POSTs JSON to
`https://taste.phareim.no/api/ingest/capture` with the Bearer header.

**On success**: reset the form (clear title/body/note/image_url; keep kind
and source_url) and refocus the body field — mirrors `capture.vue`'s
`resetForm()` + refocus, since a single page visit may produce more than one
capture. The popup does **not** auto-close.

**On failure**: form stays populated (nothing typed is lost). Distinguish
401 ("check your key in options," links to options page) from other
failures (generic inline error, network/5xx).

### Options page

`options.html`/`options.js`: a single text field for the ingest key, a Save
button, persisted to `chrome.storage.sync` (per your call — follows the key
across Chrome installs signed into the same Google account, at the cost of
the key living in Google's sync infrastructure rather than only on-device).

### Icons

Simple crimson monogram on warm paper, matching the site's palette, exported
at 16/48/128px.

## Error handling summary

| Condition | Behavior |
|---|---|
| No key saved | Inline prompt → options page, no request attempted |
| 401 (bad/rotated key) | Inline "check your key in options" message |
| 400 (validation, e.g. empty body) | Inline message, form stays populated |
| Network failure / 5xx | Generic inline error, form stays populated |
| 503 (`TASTE_EXTENSION_KEY` unset server-side) | Same as generic error — indistinguishable from the extension's side, acceptable since this is a self-inflicted deploy-config gap the user (who also controls the server) would immediately recognize |

## Testing

Manual only, matching this project's existing no-local-D1-seed,
test-against-remote convention (`docs/plans/2026-07-13-taste-maker-v1.md`):

1. `npx wrangler d1 ...` not needed — no schema change. Deploy the backend
   change, set `TASTE_EXTENSION_KEY`.
2. Load `extension/` unpacked in Chrome, set the key via the options page.
3. Toolbar icon with a text selection on an arbitrary page → confirm popup
   prefills `kind=quote`, body = selection, source_url = page URL; submit;
   confirm the item appears in the library with the right kind/fields.
4. Toolbar icon with no selection → confirm `kind=reference` default.
5. Right-click a text selection → context menu → confirm popup window opens
   prefilled the same as (3).
6. Right-click an image → confirm `kind=art`, `image_url` prefilled.
7. Clear the saved key → confirm the inline "set your key" prompt appears
   and no request fires.
8. Set an intentionally wrong key → confirm the 401 path is distinguished
   from a generic failure.
9. Confirm the CORS preflight succeeds (no console CORS error) and the
   popup doesn't rely on any session cookie.

## Out of scope (explicit)

Chrome Web Store publishing, Firefox/Safari ports, drag-drop capture,
multi-image capture, offline queueing/retry, any change to `/capture` or
`/api/items`.

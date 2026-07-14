# Chrome Extension Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Manifest V3 Chrome extension that captures a quote/reference/music/art item into taste-maker from any page, via a new Bearer-authed backend route, without the extension ever needing the Reader session cookie.

**Architecture:** One new server-to-server-style ingest route (`POST /api/ingest/capture`, gated by a new `TASTE_EXTENSION_KEY` Bearer secret, CORS-scoped to the extension's own fixed origin) alongside a new `extension/` directory holding a popup (toolbar-icon + two context-menu entry points), a background service worker (context menus), and an options page (key entry).

**Tech Stack:** Nuxt 3 / Nitro (`cloudflare-module`) + h3 for the backend, matching the existing `server/api/ingest/highlight.post.ts` pattern. Plain HTML/CSS/JS for the extension (Manifest V3), no build step, no framework — this is a ~6-file surface, a bundler would be pure overhead.

## Global Constraints

- No test framework exists in this repo (`package.json` has no test runner). Verification is `npm run build` (typecheck/build) for backend changes, plus manual curl / manual browser interaction — the same convention used throughout `docs/plans/2026-07-13-taste-maker-v1.md`. Do not invent a test framework for this plan.
- No local D1/dev-seed story — backend behavior is verified against the deployed remote Worker, not a local server.
- The new secret is `TASTE_EXTENSION_KEY`, **distinct** from the existing `TASTE_INGEST_KEY` (per the approved design — separate trust boundary, independently rotatable).
- CORS on the new route is scoped to the extension's own fixed `chrome-extension://` origin, never `*`.
- The extension stores its key in `chrome.storage.sync` (per the approved design).
- Extension is unpublished, personal, loaded-unpacked only — no Chrome Web Store packaging in this plan.
- Deploying (pushing to `main`, which triggers the GitHub Actions build+deploy) and running `wrangler secret put` against the production Worker are the two irreversible/production-affecting actions in this plan. Both happen only in Task 7, and only with your explicit go-ahead at execution time.

### Precomputed values (generated once, reused verbatim below — do not regenerate)

A fixed RSA keypair was generated to pin the extension's ID (Chrome derives the ID from the manifest's public key when loading unpacked; without a fixed `key` field the ID would change on every reinstall/relocate, breaking the hardcoded CORS allow-list). Only the public key is needed going forward; the private key was discarded after deriving these two values:

```
EXTENSION_ID = odjnpodgcgeofokemcjnnokedkdikcan
MANIFEST_KEY_B64 = MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoOq9D1qs3WyMzYJ1/AwvQdBAYFW/C+tkE7DUR4C93BMqiQx1e3hAHPiGE0R7Y9m1CXGODyL0Il5YfsLGxtQQbuH2ZX9/O3ZcZ9/d/m1GtxJe3Aft0G776wadu7eEvNuRBDoESIsEhlplE7zXBPoX0AgIVyFBvgKWnZZiz50UkPnjUWH8Ut5VEUzOATI9pA1CRtbXmskEIML7wHAXo7n17951oHTOZ2WrpAe4t1xuaTS/CXH2OXKCl1jg7PJ0SESrGIbgyjIUbLcH8dqItFMtimD7mmZGRFxQSyNC64gx7YAVO2VoAW4OvuAmCrB7Ykn8WIPfAFn8ue5aK0HG0oH6awIDAQAB
```

`EXTENSION_ID` is used to build `chrome-extension://odjnpodgcgeofokemcjnnokedkdikcan` for the server's CORS allow-list (Task 2). `MANIFEST_KEY_B64` goes verbatim into `extension/manifest.json`'s `"key"` field (Task 3). These two values encode the same keypair — using them both is what keeps the ID stable and the CORS check meaningful.

---

## Task 1: Generalize `requireIngestKey` for a named secret

**Files:**
- Modify: `server/utils/cloudflare.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `requireIngestKey(event, envKey?: 'TASTE_INGEST_KEY' | 'TASTE_EXTENSION_KEY')` — `envKey` defaults to `'TASTE_INGEST_KEY'`, so every existing call site (`highlight.post.ts`, `highlight/[id].delete.ts`) keeps working unchanged. Task 2 calls this with `'TASTE_EXTENSION_KEY'`.

- [ ] **Step 1: Add the new env var to the `CloudflareEnv` type and generalize the function**

In `server/utils/cloudflare.ts`, replace the `CloudflareEnv` type and `requireIngestKey`:

```ts
type CloudflareEnv = {
  DB?: any
  TASTE_DB?: any
  NVIDIA_API_KEY?: string
  TASTE_INGEST_KEY?: string
  TASTE_EXTENSION_KEY?: string
}

// Bearer gate for the server-to-server / extension ingest routes. Session
// auth doesn't apply there — the caller is a Worker or a browser extension,
// not a browser holding a Reader cookie. `envKey` selects which secret to
// check: Reader's highlight mirror uses TASTE_INGEST_KEY, the Chrome
// extension uses its own TASTE_EXTENSION_KEY (separate trust boundary —
// a key living in browser extension storage is more exposed than one in a
// Worker's config, so it's independently rotatable). 503 when the selected
// key is unset (feature off), 401 on mismatch.
export const requireIngestKey = (
  event: any,
  envKey: 'TASTE_INGEST_KEY' | 'TASTE_EXTENSION_KEY' = 'TASTE_INGEST_KEY'
) => {
  const env = event?.context?.cloudflare?.env as CloudflareEnv | undefined
  const key = env?.[envKey]
  if (!key) {
    throw createError({ statusCode: 503, statusMessage: 'Ingest is not configured.' })
  }
  const header = event?.node?.req?.headers?.authorization ?? ''
  if (header !== `Bearer ${key}`) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid ingest key.' })
  }
}
```

- [ ] **Step 2: Verify existing call sites still compile**

Run: `grep -n "requireIngestKey(event)" server/api/ingest/highlight.post.ts server/api/ingest/highlight/\[id\].delete.ts`
Expected: both files still call `requireIngestKey(event)` with no second argument (unchanged) — confirming the default parameter preserves their behavior.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add server/utils/cloudflare.ts
git commit -m "$(cat <<'EOF'
Generalize requireIngestKey to accept a named secret

Prep for the Chrome extension's ingest route, which authenticates
with its own TASTE_EXTENSION_KEY instead of Reader's TASTE_INGEST_KEY.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add the `/api/ingest/capture` route (CORS + Bearer auth + insert)

**Files:**
- Create: `server/utils/cors.ts`
- Create: `server/api/ingest/capture.post.ts`
- Create: `server/api/ingest/capture.options.ts`
- Modify: `README.md` (Ingest section)

**Interfaces:**
- Consumes: `requireIngestKey(event, 'TASTE_EXTENSION_KEY')` from Task 1; `ITEM_COLUMNS` from `server/utils/tasteDb.ts`; `embedText` from `server/utils/embedding.ts`; `getTasteDb` (bare, auto-imported from `server/utils/`, same as every other route in this codebase).
- Produces: `setCaptureCorsHeaders(event)` from `server/utils/cors.ts`, consumed by both new route files. `POST /api/ingest/capture` — request `{kind, title?, body, source_url?, creator?, note?, image_url?}`, response is the created row (same shape as `POST /api/items`). No task after this depends on new exported symbols beyond `setCaptureCorsHeaders`.

- [ ] **Step 1: Write the shared CORS helper**

Create `server/utils/cors.ts`:

```ts
// Shared CORS handling for the extension-facing ingest route. The Chrome
// extension calls this route from a chrome-extension:// origin (a real
// browser context, unlike the Worker-to-Worker highlight ingest route) — so
// unlike server/api/ingest/highlight.post.ts, this route needs an explicit
// CORS allow so the extension's popup can read the response. There are no
// cookies/credentials in play (auth is a manually-attached Bearer header),
// so scoping to the extension's own fixed origin — rather than a wildcard —
// costs nothing and keeps the intent explicit: only this extension's popup
// should read the response.
import { H3Event, setResponseHeaders } from 'h3'

export const EXTENSION_ORIGIN = 'chrome-extension://odjnpodgcgeofokemcjnnokedkdikcan'

export function setCaptureCorsHeaders(event: H3Event) {
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': EXTENSION_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  })
}
```

- [ ] **Step 2: Write the OPTIONS preflight handler**

Create `server/api/ingest/capture.options.ts`:

```ts
import { setResponseStatus } from 'h3'
import { setCaptureCorsHeaders } from '~/server/utils/cors'

// CORS preflight for POST /api/ingest/capture. Browsers send this
// automatically before the real POST because Authorization is a
// non-simple header — no auth check here, preflights never carry it.
export default defineEventHandler((event) => {
  setCaptureCorsHeaders(event)
  setResponseStatus(event, 204)
  return null
})
```

- [ ] **Step 3: Write the POST handler**

Create `server/api/ingest/capture.post.ts`:

```ts
import { ITEM_COLUMNS } from '~/server/utils/tasteDb'
import { embedText } from '~/server/utils/embedding'
import { setCaptureCorsHeaders } from '~/server/utils/cors'
import type { Kind } from '~/types/taste'

const VALID_KINDS: Kind[] = ['quote', 'reference', 'music', 'art']

/**
 * Chrome extension capture: the extension's popup posts here directly from
 * a chrome-extension:// origin, so it authenticates with
 * TASTE_EXTENSION_KEY (Bearer) instead of the Reader session cookie
 * /api/items relies on. Same insert shape as /api/items; no external_ref —
 * each capture is a one-shot user action from the popup, not a resendable
 * sync like the Reader highlight mirror.
 */
export default defineEventHandler(async (event) => {
  setCaptureCorsHeaders(event)
  requireIngestKey(event, 'TASTE_EXTENSION_KEY')
  const db = getTasteDb(event)
  const body = await readBody(event)

  const kind = body?.kind
  const text = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!VALID_KINDS.includes(kind) || !text) {
    throw createError({ statusCode: 400, statusMessage: 'kind (quote|reference|music|art) and non-empty body are required' })
  }

  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : null
  const source_url = typeof body?.source_url === 'string' && body.source_url.trim() ? body.source_url.trim() : null
  const creator = typeof body?.creator === 'string' && body.creator.trim() ? body.creator.trim() : null
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null
  const image_url = typeof body?.image_url === 'string' && body.image_url.trim() ? body.image_url.trim() : null

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const env = event?.context?.cloudflare?.env
  const embedInput = [title, creator, text, note].filter(Boolean).join(' — ')
  const embedding = await embedText(env, embedInput)

  await db
    .prepare(
      `INSERT INTO taste_item
        (id, kind, title, body, source_url, creator, note, image_url, status, wins, losses, promoted_via, embedding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', 0, 0, NULL, ?, ?, ?)`
    )
    .bind(
      id,
      kind,
      title,
      text,
      source_url,
      creator,
      note,
      image_url,
      embedding ? JSON.stringify(embedding) : null,
      now,
      now
    )
    .run()

  const row = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`).bind(id).first()
  return row
})
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Document the route in README**

In `README.md`, find the "Ingest (server-to-server, Bearer `TASTE_INGEST_KEY`)" section (the one describing `POST /api/ingest/highlight`). Add a new paragraph immediately after the `DELETE /api/ingest/highlight/[id]` bullet and before the "Auth:" line:

```markdown
- `POST /api/ingest/capture` — `{kind, title?, body, source_url?, creator?,
  note?, image_url?}`. Same validation as `POST /api/items`. Used by the
  Chrome extension (`extension/`) to capture from any page without a
  browser session. Auth is `Authorization: Bearer <TASTE_EXTENSION_KEY>` —
  a separate secret from `TASTE_INGEST_KEY` (extension-held keys are a
  different trust boundary than Worker-held ones). CORS-scoped to the
  extension's own fixed origin (see `server/utils/cors.ts`); handles its own
  `OPTIONS` preflight.
```

Then update the "Auth:" line right after it to mention both keys — replace:

```markdown
Auth: `Authorization: Bearer <TASTE_INGEST_KEY>` (Worker secret; host-side
copy in `~/.config/taste/env`, shared with Reader as `NUXT_TASTE_INGEST_KEY`).
503 when the secret is unset, 401 on mismatch. Reader's side of the pipe
(mirror-on-create, undo-on-delete, backfill script) lives in the reader repo.
```

with:

```markdown
Auth for `/api/ingest/highlight*`: `Authorization: Bearer <TASTE_INGEST_KEY>`
(Worker secret; host-side copy in `~/.config/taste/env`, shared with Reader
as `NUXT_TASTE_INGEST_KEY`). Auth for `/api/ingest/capture`:
`Authorization: Bearer <TASTE_EXTENSION_KEY>` (separate Worker secret, held
only by the Chrome extension). Both: 503 when the relevant secret is unset,
401 on mismatch. Reader's side of the highlight pipe (mirror-on-create,
undo-on-delete, backfill script) lives in the reader repo.
```

- [ ] **Step 6: Commit**

```bash
git add server/utils/cors.ts server/api/ingest/capture.post.ts server/api/ingest/capture.options.ts README.md
git commit -m "$(cat <<'EOF'
Add POST /api/ingest/capture for the Chrome extension

Bearer-authed (TASTE_EXTENSION_KEY) and CORS-scoped to the extension's
own fixed origin, alongside the existing highlight ingest route. Live
end-to-end verification (deploy + real key + real POST) happens once
the extension exists, in a later task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extension scaffold — manifest, icons, popup markup

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/icons/icon16.png`, `extension/icons/icon48.png`, `extension/icons/icon128.png`
- Create: `extension/popup.html`
- Create: `extension/popup.css`

**Interfaces:**
- Consumes: `MANIFEST_KEY_B64` from the "Precomputed values" section above.
- Produces: the DOM element IDs/classes `popup.js` (Task 4) binds to: `.kind-btn[data-kind]`, `#body-label`, `#image-field`, `#title`, `#body`, `#image_url`, `#source_url`, `#creator`, `#note`, `#status`, `#submit-btn`, `#capture-form`.

- [ ] **Step 1: Generate the three icon PNGs**

Run:

```bash
mkdir -p extension/icons
python3 - <<'EOF'
from PIL import Image, ImageDraw, ImageFont

BG = (193, 53, 29)     # --tufte-accent
FG = (251, 249, 244)   # --paper
FONT_PATH = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"

def make_icon(size, path):
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_PATH, int(size * 0.62))
    text = "t"
    bbox = draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, font=font, fill=FG)
    img.save(path)

for size in (16, 48, 128):
    make_icon(size, f"extension/icons/icon{size}.png")
EOF
```

Expected: no output, exit 0.

- [ ] **Step 2: Verify the icons**

Run: `python3 -c "from PIL import Image; [print(s, Image.open(f'extension/icons/icon{s}.png').size) for s in (16,48,128)]"`
Expected:
```
16 (16, 16)
48 (48, 48)
128 (128, 128)
```

- [ ] **Step 3: Write the manifest**

Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "taste-maker capture",
  "version": "1.0.0",
  "description": "Capture quotes, references, music, and art to taste.phareim.no without leaving the page.",
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoOq9D1qs3WyMzYJ1/AwvQdBAYFW/C+tkE7DUR4C93BMqiQx1e3hAHPiGE0R7Y9m1CXGODyL0Il5YfsLGxtQQbuH2ZX9/O3ZcZ9/d/m1GtxJe3Aft0G776wadu7eEvNuRBDoESIsEhlplE7zXBPoX0AgIVyFBvgKWnZZiz50UkPnjUWH8Ut5VEUzOATI9pA1CRtbXmskEIML7wHAXo7n17951oHTOZ2WrpAe4t1xuaTS/CXH2OXKCl1jg7PJ0SESrGIbgyjIUbLcH8dqItFMtimD7mmZGRFxQSyNC64gx7YAVO2VoAW4OvuAmCrB7Ykn8WIPfAFn8ue5aK0HG0oH6awIDAQAB",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "options_page": "options.html",
  "permissions": ["storage", "contextMenus", "activeTab", "scripting"],
  "host_permissions": ["https://taste.phareim.no/*"]
}
```

- [ ] **Step 4: Write the popup markup**

Create `extension/popup.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Capture</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <header>
    <span class="label">Capture</span>
  </header>

  <div class="kinds" role="radiogroup" aria-label="Kind">
    <button type="button" class="kind-btn" data-kind="quote">Quote</button>
    <button type="button" class="kind-btn" data-kind="reference">Reference</button>
    <button type="button" class="kind-btn" data-kind="music">Music</button>
    <button type="button" class="kind-btn" data-kind="art">Art</button>
  </div>

  <form id="capture-form">
    <label class="field">
      <span class="label">Title</span>
      <input type="text" id="title" placeholder="Optional short title" />
    </label>

    <label class="field">
      <span class="label" id="body-label">Body</span>
      <textarea id="body" rows="4" placeholder="Required"></textarea>
    </label>

    <label class="field" id="image-field">
      <span class="label">Image URL</span>
      <input type="url" id="image_url" placeholder="https://…" />
    </label>

    <label class="field">
      <span class="label">Source URL</span>
      <input type="url" id="source_url" placeholder="https://…" />
    </label>

    <label class="field">
      <span class="label">Creator</span>
      <input type="text" id="creator" placeholder="Author / artist / attribution" />
    </label>

    <label class="field">
      <span class="label">Note</span>
      <textarea id="note" rows="2" placeholder="Why it strikes me"></textarea>
    </label>

    <p id="status" class="status" hidden></p>

    <footer>
      <span class="hint">⌘⏎ to submit</span>
      <button type="submit" id="submit-btn">Capture</button>
    </footer>
  </form>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 5: Write the popup stylesheet**

Create `extension/popup.css`:

```css
:root {
  --paper: #fbf9f4;
  --paper-raised: #ffffff;
  --ink: #111111;
  --ink-soft: #4a473f;
  --ink-quiet: #6b675d;
  --rule: #e7e2d8;
  --rule-strong: #d6cfc0;
  --accent: #c1351d;
  --accent-ink: #9a2a17;
  --accent-wash: #f3ddd6;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #14130f;
    --paper-raised: #1d1b16;
    --ink: #ececec;
    --ink-soft: #cfcabe;
    --ink-quiet: #9b968a;
    --rule: #322f29;
    --rule-strong: #43403a;
    --accent: #ff6b4a;
    --accent-ink: #ff8a6e;
    --accent-wash: #2a1a14;
  }
}

* { box-sizing: border-box; }

body {
  width: 360px;
  margin: 0;
  padding: 16px;
  background: var(--paper);
  color: var(--ink-soft);
  font: 13px/1.5 Georgia, 'Times New Roman', serif;
}

header .label,
.field .label {
  display: block;
  font: 700 10px/1 'SF Mono', Menlo, Consolas, monospace;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-quiet);
  margin-bottom: 4px;
}

header {
  margin-bottom: 10px;
}

.kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}

.kind-btn {
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink-quiet);
  font: 700 10px/1 'SF Mono', Menlo, Consolas, monospace;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 5px 10px;
  cursor: pointer;
}

.kind-btn:hover {
  border-color: var(--rule-strong);
  color: var(--ink);
}

.kind-btn.active {
  border-color: var(--accent);
  color: var(--accent-ink);
}

.field {
  display: block;
  margin-bottom: 10px;
}

input, textarea {
  width: 100%;
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink);
  font: 13px/1.4 Georgia, serif;
  padding: 6px 8px;
  resize: none;
}

input:focus, textarea:focus {
  outline: none;
  border-color: var(--accent);
}

#image-field.hidden {
  display: none;
}

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.hint {
  font: 10px/1 'SF Mono', Menlo, Consolas, monospace;
  color: var(--ink-quiet);
}

#submit-btn {
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent-ink);
  font: 700 11px/1 'SF Mono', Menlo, Consolas, monospace;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 7px 14px;
  cursor: pointer;
}

#submit-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.status {
  font: 12px/1.4 Georgia, serif;
  margin: 0 0 10px;
  padding: 6px 8px;
  border: 1px solid var(--rule);
}

.status.success {
  border-color: var(--accent);
  color: var(--accent-ink);
  background: var(--accent-wash);
}

.status.error {
  border-color: var(--accent);
  color: var(--accent-ink);
}
```

- [ ] **Step 6: Create a placeholder popup.js so the popup doesn't 404 its own script**

Task 4 replaces this. For now, create `extension/popup.js` with just:

```js
// Prefill and submit logic lands in Task 4.
```

- [ ] **Step 7: Create a placeholder background.js so the manifest loads**

Task 5 replaces this. For now, create `extension/background.js` with just:

```js
// Context menus are registered in Task 5.
```

- [ ] **Step 8: Create a placeholder options.html so the manifest loads**

Task 6 replaces this. For now, create `extension/options.html` with just:

```html
<!doctype html>
<html><body>Options — see Task 6.</body></html>
```

- [ ] **Step 9: Load the extension unpacked and verify**

In Chrome: open `chrome://extensions`, enable Developer mode, "Load unpacked", select the `extension/` directory.

Expected:
- No manifest errors, no 404s in the extension's service worker or popup console.
- The extension's ID (shown on its card) reads exactly `odjnpodgcgeofokemcjnnokedkdikcan`, confirming the `key` field pinned it correctly.
- Clicking the toolbar icon opens a popup showing the Capture header, four kind buttons, and all the fields from Step 4 — unstyled logic (buttons don't switch active state yet, that's Task 4), but the Tufte-toned layout (warm paper background, crimson accent on focus) should already be visible.

- [ ] **Step 10: Commit**

```bash
git add extension/
git commit -m "$(cat <<'EOF'
Scaffold the Chrome extension: manifest, icons, popup markup

Manifest key pins the extension ID to
chrome-extension://odjnpodgcgeofokemcjnnokedkdikcan, matching the
origin the backend's CORS allow-list expects. Popup logic and the
background/options scripts land in the next tasks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `popup.js` — toolbar-icon prefill + submit

**Files:**
- Modify: `extension/popup.js` (placeholder created in Task 3)

**Interfaces:**
- Consumes: DOM structure from Task 3 (`.kind-btn[data-kind]`, `#body-label`, `#image-field`, `#title`, `#body`, `#image_url`, `#source_url`, `#creator`, `#note`, `#status`, `#submit-btn`, `#capture-form`); `POST https://taste.phareim.no/api/ingest/capture` from Task 2.
- Produces: `chrome.storage.session.get('pendingCapture')` read (consumed by, and written by, Task 5's `background.js`) — Task 4 reads this key defensively even before Task 5 writes it, so the toolbar-icon path (which never sets `pendingCapture`) and the future context-menu path share one `init()`. `chrome.storage.sync.get('extensionKey')` read (written by Task 6's `options.js`).

- [ ] **Step 1: Write `popup.js`**

Create `extension/popup.js`:

```js
const API_URL = 'https://taste.phareim.no/api/ingest/capture'

const state = { kind: 'quote' }

const els = {
  kindBtns: Array.from(document.querySelectorAll('.kind-btn')),
  bodyLabel: document.getElementById('body-label'),
  imageField: document.getElementById('image-field'),
  title: document.getElementById('title'),
  body: document.getElementById('body'),
  imageUrl: document.getElementById('image_url'),
  sourceUrl: document.getElementById('source_url'),
  creator: document.getElementById('creator'),
  note: document.getElementById('note'),
  status: document.getElementById('status'),
  submitBtn: document.getElementById('submit-btn'),
  form: document.getElementById('capture-form'),
}

function setKind(kind) {
  state.kind = kind
  els.kindBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.kind === kind))
  els.bodyLabel.textContent =
    kind === 'quote' ? 'Quote' : kind === 'art' ? 'Description' : kind === 'music' ? 'Track' : 'Body'
  els.imageField.classList.toggle('hidden', kind !== 'art')
}

els.kindBtns.forEach((btn) => btn.addEventListener('click', () => setKind(btn.dataset.kind)))

function showStatus(message, kind) {
  els.status.textContent = message
  els.status.hidden = false
  els.status.className = `status ${kind}`
}

function clearStatus() {
  els.status.hidden = true
  els.status.textContent = ''
  els.status.className = 'status'
  els.status.onclick = null
  els.status.style.cursor = ''
}

async function prefillFromPending() {
  const { pendingCapture } = await chrome.storage.session.get('pendingCapture')
  if (!pendingCapture) return false

  await chrome.storage.session.remove('pendingCapture')
  setKind(pendingCapture.kind)
  els.body.value = pendingCapture.body || ''
  els.title.value = pendingCapture.title || ''
  els.sourceUrl.value = pendingCapture.source_url || ''
  els.imageUrl.value = pendingCapture.image_url || ''
  return true
}

async function prefillFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab) return

  els.title.value = tab.title || ''
  els.sourceUrl.value = tab.url || ''

  let selection = ''
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString(),
    })
    selection = result || ''
  } catch {
    selection = ''
  }

  if (selection) {
    setKind('quote')
    els.body.value = selection
  } else {
    setKind('reference')
  }
}

async function init() {
  setKind('quote')
  const usedPending = await prefillFromPending()
  if (!usedPending) await prefillFromActiveTab()
  els.body.focus()
}

async function submit(event) {
  event.preventDefault()
  const body = els.body.value.trim()
  if (!body) return

  const { extensionKey } = await chrome.storage.sync.get('extensionKey')
  if (!extensionKey) {
    showStatus('No ingest key set — click to add one.', 'error')
    els.status.style.cursor = 'pointer'
    els.status.onclick = () => chrome.runtime.openOptionsPage()
    return
  }

  els.submitBtn.disabled = true
  clearStatus()

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${extensionKey}`,
      },
      body: JSON.stringify({
        kind: state.kind,
        body,
        title: els.title.value.trim() || null,
        source_url: els.sourceUrl.value.trim() || null,
        creator: els.creator.value.trim() || null,
        note: els.note.value.trim() || null,
        image_url: els.imageUrl.value.trim() || null,
      }),
    })

    if (res.status === 401) {
      showStatus('Key rejected — check it in options.', 'error')
      return
    }
    if (!res.ok) {
      showStatus('Could not save the item.', 'error')
      return
    }

    showStatus('Captured.', 'success')
    els.title.value = ''
    els.body.value = ''
    els.note.value = ''
    els.imageUrl.value = ''
    els.body.focus()
  } catch {
    showStatus('Network error — could not reach taste-maker.', 'error')
  } finally {
    els.submitBtn.disabled = false
  }
}

els.form.addEventListener('submit', submit)
els.form.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e)
})

init()
```

- [ ] **Step 2: Reload the extension and verify prefill logic**

In `chrome://extensions`, click the reload icon on the extension's card. Open any article page, select a sentence of text, then click the toolbar icon.

Expected: popup opens with the Quote button active, the body textarea containing the selected text, title = page title, source URL = page URL.

- [ ] **Step 3: Verify the no-selection default**

Click elsewhere to clear the selection, click the toolbar icon again.

Expected: Reference button active, body empty, title/source URL still populated from the tab.

- [ ] **Step 4: Verify the missing-key path**

With no key saved yet (Task 6 not built), type something in the body field and press `Cmd+Enter` (or click Capture).

Expected: inline status "No ingest key set — click to add one." appears; no network request is attempted (check the extension's popup console via right-click → Inspect → Network tab: no request to `taste.phareim.no`).

- [ ] **Step 5: Commit**

```bash
git add extension/popup.js
git commit -m "$(cat <<'EOF'
Add popup.js: toolbar-icon prefill and submit to the capture API

Selection present on the page -> kind=quote with the selection as
body; no selection -> kind=reference. Submits via Bearer auth read
from chrome.storage.sync; missing/rejected key surfaces inline
instead of failing silently.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `background.js` — context menus + popup handoff

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `extension/manifest.json`'s `contextMenus`/`scripting` permissions from Task 3.
- Produces: writes `chrome.storage.session.set({ pendingCapture })` with shape `{kind, body, title, source_url, image_url?}`, consumed by `popup.js`'s `prefillFromPending()` (Task 4, already written to read this key).

- [ ] **Step 1: Write `background.js`**

Replace the placeholder `extension/background.js` with:

```js
const MENU_SELECTION_ID = 'taste-capture-selection'
const MENU_IMAGE_ID = 'taste-capture-image'

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SELECTION_ID,
    title: 'Capture to taste library',
    contexts: ['selection'],
  })
  chrome.contextMenus.create({
    id: MENU_IMAGE_ID,
    title: 'Capture to taste library',
    contexts: ['image'],
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return

  let pending
  if (info.menuItemId === MENU_SELECTION_ID) {
    pending = {
      kind: 'quote',
      body: info.selectionText || '',
      title: tab.title || '',
      source_url: tab.url || '',
    }
  } else if (info.menuItemId === MENU_IMAGE_ID) {
    pending = {
      kind: 'art',
      body: '',
      image_url: info.srcUrl || '',
      title: tab.title || '',
      source_url: tab.url || '',
    }
  } else {
    return
  }

  await chrome.storage.session.set({ pendingCapture: pending })
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 420,
    height: 640,
  })
})
```

- [ ] **Step 2: Reload and verify the selection path**

In `chrome://extensions`, reload the extension. On any page, select a sentence, right-click.

Expected: a "Capture to taste library" context menu item appears. Clicking it opens a new small popup window with the Quote button active and the body prefilled with the exact selected text (not the live-tab lookup path — `pendingCapture` takes priority).

- [ ] **Step 3: Verify the image path**

Right-click an `<img>` on any page.

Expected: "Capture to taste library" appears; clicking it opens the popup with the Art button active and the Image URL field populated with that image's URL.

- [ ] **Step 4: Commit**

```bash
git add extension/background.js
git commit -m "$(cat <<'EOF'
Add context menus for selection and image capture

Right-click a selection or an image -> stash a pendingCapture payload
in chrome.storage.session and open the popup in a standalone window;
popup.js's prefillFromPending() (already written) picks it up.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Options page — ingest key storage

**Files:**
- Modify: `extension/options.html`
- Create: `extension/options.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `chrome.storage.sync` key `extensionKey`, consumed by `popup.js`'s `submit()` (Task 4, already written to read this key).

- [ ] **Step 1: Write the options markup**

Replace the placeholder `extension/options.html` with:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>taste-maker capture — options</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body style="width: 320px;">
  <header>
    <span class="label">Options</span>
  </header>
  <label class="field">
    <span class="label">Ingest key</span>
    <input type="password" id="key" placeholder="Paste your TASTE_EXTENSION_KEY" />
  </label>
  <footer>
    <span class="hint" id="saved-hint" style="visibility: hidden;">Saved.</span>
    <button type="button" id="save-btn">Save</button>
  </footer>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `options.js`**

Create `extension/options.js`:

```js
const keyInput = document.getElementById('key')
const saveBtn = document.getElementById('save-btn')
const savedHint = document.getElementById('saved-hint')

async function init() {
  const { extensionKey } = await chrome.storage.sync.get('extensionKey')
  if (extensionKey) keyInput.value = extensionKey
}

saveBtn.addEventListener('click', async () => {
  await chrome.storage.sync.set({ extensionKey: keyInput.value.trim() })
  savedHint.style.visibility = 'visible'
  setTimeout(() => {
    savedHint.style.visibility = 'hidden'
  }, 1500)
})

init()
```

- [ ] **Step 3: Reload and verify persistence**

Reload the extension in `chrome://extensions`. Right-click the toolbar icon → Options (or `chrome.runtime.openOptionsPage()` link from Task 4's missing-key status message). Paste any placeholder string (e.g. `test-key-123`), click Save, close the options tab, reopen it.

Expected: "Saved." hint flashes on click; the field shows `test-key-123` again after reopening (confirms `chrome.storage.sync` persisted it).

- [ ] **Step 4: Commit**

```bash
git add extension/options.html extension/options.js
git commit -m "$(cat <<'EOF'
Add options page for the ingest key

Single field, persisted to chrome.storage.sync, read by popup.js's
submit() (already written in Task 4).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Deploy the backend, set the real key, end-to-end verification

**Files:**
- Modify: `README.md` (Parked-for-v2 list, new Chrome-extension section)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing further (terminal task).

This task pushes to `main` (triggers the GitHub Actions deploy) and sets a real secret on the production Worker. **Both are production-affecting — confirm with the user before running the push and the `wrangler secret put` step**, per this session's standing git/deploy safety rules, even though the plan lists them as steps.

- [ ] **Step 1: Generate the real secret**

Run: `openssl rand -hex 32`
Save the output somewhere durable (e.g. `~/.config/taste/env`, matching the existing `TASTE_INGEST_KEY` convention mentioned in the README) — this value is never committed to git.

- [ ] **Step 2: Confirm with the user, then push to `main`**

After explicit user go-ahead:

```bash
git push
```

Expected: GitHub Actions runs build + `wrangler deploy` (see `.github/workflows/deploy.yml`). Wait for the workflow to succeed (`gh run watch` or check the Actions tab) before continuing — the new route won't exist on the remote Worker until this completes.

- [ ] **Step 3: Confirm with the user, then set the secret on the deployed Worker**

```bash
npx wrangler secret put TASTE_EXTENSION_KEY
```

Paste the value generated in Step 1 when prompted.

- [ ] **Step 4: Verify CORS preflight**

```bash
curl -sD - -o /dev/null -X OPTIONS https://taste.phareim.no/api/ingest/capture \
  -H "Origin: chrome-extension://odjnpodgcgeofokemcjnnokedkdikcan" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

Expected: `204`, with `access-control-allow-origin: chrome-extension://odjnpodgcgeofokemcjnnokedkdikcan` in the response headers.

- [ ] **Step 5: Verify the unauthenticated and wrong-key paths**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://taste.phareim.no/api/ingest/capture \
  -H "Content-Type: application/json" -d '{"kind":"quote","body":"test"}'
```
Expected: `401` (no `Authorization` header).

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://taste.phareim.no/api/ingest/capture \
  -H "Authorization: Bearer wrong-key" \
  -H "Content-Type: application/json" -d '{"kind":"quote","body":"test"}'
```
Expected: `401`.

- [ ] **Step 6: Verify a real authenticated capture**

```bash
curl -s -X POST https://taste.phareim.no/api/ingest/capture \
  -H "Authorization: Bearer <the real key from Step 1>" \
  -H "Content-Type: application/json" \
  -d '{"kind":"quote","body":"Curl smoke test for the extension route","source_url":"https://example.com"}'
```

Expected: JSON response with an `id`, `kind: "quote"`, `body` matching, no `embedding` key. Then confirm it shows up in the library at `https://taste.phareim.no/` (or `GET /api/items` with a valid session cookie).

- [ ] **Step 7: Paste the real key into the extension and do a full manual pass**

Open the extension's options page, paste the real key from Step 1, save. Then exercise all three triggers end-to-end against production:
- Toolbar icon with a selection → submit → confirm the item appears in the library.
- Toolbar icon with no selection → submit → confirm it lands as `reference`.
- Right-click a selection → context menu capture → submit → confirm it lands as `quote`.
- Right-click an image → context menu capture → submit → confirm it lands as `art` with the image URL set.
- Deliberately clear the key in options and try to submit → confirm the inline "no key" prompt, not a crash.

- [ ] **Step 8: Update README**

In `README.md`'s "Parked for v2 (explicitly out of v1)" list, remove the line `- Share-sheet / bookmarklet capture` (it's now shipped, as the Chrome extension rather than a bookmarklet).

Add a new section after the "## Ingest (server-to-server, Bearer `TASTE_INGEST_KEY`)" section:

```markdown
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
```

- [ ] **Step 9: Commit and push the README update**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
README: document the Chrome extension, un-park bookmarklet capture

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Confirm with the user before pushing this final commit too.

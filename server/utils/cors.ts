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

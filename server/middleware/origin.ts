/**
 * Cross-site write guard for the session-gated API. A browser attaches the
 * Reader cookie (domain .phareim.no) to a form post from any page, and a
 * form post needs no CORS preflight, so a session alone does not prove the
 * request came from this app. Browsers send `Origin` on every POST, PATCH,
 * PUT and DELETE they make; when it names another site, refuse.
 *
 * Left alone: reads; requests without an Origin (native clients such as the
 * iOS app, server-to-server calls); and /api/ingest/*, which authenticate
 * with their own Bearer keys and serve the Chrome extension's pinned origin.
 */
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

export default defineEventHandler((event) => {
  if (!WRITE_METHODS.has(event.method)) return
  const path = event.path || ''
  if (!path.startsWith('/api/') || path.startsWith('/api/ingest/')) return

  const origin = getRequestHeader(event, 'origin')
  if (origin === undefined) return

  // Compared by host: on the Worker the request's scheme is not reliable
  // (see composables/useAuth.ts), and this app is only served over https.
  let originHost: string | null = null
  try {
    originHost = new URL(origin).host
  } catch {
    originHost = null // "null" (sandboxed or privacy-stripped) is not this app
  }
  if (!originHost || originHost !== getRequestHost(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request refused' })
  }
})

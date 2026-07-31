/**
 * Suggests a kind and a creator for something the iOS Share Extension is
 * about to capture.
 *
 * The extension has already made its own instant offline guess before calling
 * this — so this route is a refinement, never a prerequisite. That shapes two
 * things: it is allowed to be slow-ish (the form is already on screen), and it
 * must NEVER fail loudly. Every error path returns 200 with null fields; the
 * local guess simply stands. The user must not see an error for a field they
 * did not ask to be filled.
 *
 * Living server-side is the point: the routing table and the inference ladder
 * can be tuned with a deploy instead of an Xcode rebuild and reinstall.
 *
 * No CORS: native-only, called via URLSession, so no preflight is ever issued
 * (contrast capture.post.ts, which a browser extension calls).
 */
import { classifyKind } from '~/server/utils/enrich/classify'
import { inferCreator, oembedCreator } from '~/server/utils/enrich/creator'
import {
  emptyMetadata,
  metadataFromPage,
  metadataFromResponse,
  metaOf,
  titleOf,
  type PageMetadata,
} from '~/server/utils/enrich/metadata'

const FETCH_TIMEOUT_MS = 5000
const MAX_HTML_BYTES = 512 * 1024

// Identify honestly as a link-unfurling bot rather than impersonating a
// browser. This is not just politeness — it is what actually works: verified
// against the live sites, Spotify and Apple Music serve a JS shell with NO
// og: tags to a plain Chrome UA, and only emit their metadata to a
// crawler-shaped agent. Same posture as any social-card unfurler.
const UA = 'Mozilla/5.0 (compatible; taste-maker/1.0; +https://taste.phareim.no)'

/**
 * This route fetches a URL chosen by the caller. The caller is Bearer-gated
 * and single-user, and the body is parsed rather than proxied back — but keep
 * the surface narrow anyway: public http(s) hosts only.
 */
function isFetchableUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false
  if (/^\[?::1\]?$/.test(host)) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return false
    if (a === 169 && b === 254) return false
  }
  return true
}

/**
 * Never throws. A failed fetch must cost us only the page's metadata — the
 * signals the caller already handed over (the host, the Share Sheet's own
 * text) still have to reach the ladder.
 */
async function fetchMetadata(url: string): Promise<PageMetadata> {
  try {
    return await fetchMetadataOrThrow(url)
  } catch {
    return emptyMetadata()
  }
}

async function fetchMetadataOrThrow(url: string): Promise<PageMetadata> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
  })
  if (!res.ok || !res.body) return emptyMetadata()

  const contentType = res.headers.get('content-type') || ''
  if (!/text\/html|application\/xhtml/i.test(contentType)) return emptyMetadata()

  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > MAX_HTML_BYTES * 8) return emptyMetadata()

  // Everything we need is in <head>, so cap the read rather than buffering a
  // multi-megabyte page.
  const capped = new Response(res.body.pipeThrough(takeAtMost(MAX_HTML_BYTES)), {
    headers: { 'content-type': 'text/html' },
  })
  return await metadataFromResponse(capped)
}

function takeAtMost(limit: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0
  return new TransformStream({
    transform(chunk, controller) {
      if (seen >= limit) return
      const room = limit - seen
      controller.enqueue(chunk.length > room ? chunk.subarray(0, room) : chunk)
      seen += chunk.length
      if (seen >= limit) controller.terminate()
    },
  })
}

const nullResult = (sourceUrl: string | null) => ({
  kind: null,
  kind_confidence: 'low' as const,
  kind_reason: 'unrecognized source',
  title: null,
  creator: null,
  creator_source: null,
  image_url: null,
  source_url: sourceUrl,
})

export default defineEventHandler(async (event) => {
  requireIngestKey(event, 'TASTE_IOS_KEY')
  const body = await readBody(event)

  const sharedText = typeof body?.shared_text === 'string' && body.shared_text.trim() ? body.shared_text.trim() : null
  const hasImage = body?.has_image === true
  const page = body?.page && typeof body.page === 'object' ? body.page : null

  const rawUrl = typeof body?.url === 'string' && body.url.trim() ? body.url.trim() : null
  const pageUrl = typeof page?.url === 'string' && page.url.trim() ? page.url.trim() : null
  const sourceUrl = rawUrl || pageUrl

  const hasSelection = typeof page?.selection === 'string' && page.selection.trim().length > 0

  try {
    // When the extension's JS preprocessor already scraped the live DOM
    // (a Safari share), classify from that and skip the outbound fetch
    // entirely — it is both faster and more accurate than refetching.
    let metadata: PageMetadata
    if (page) {
      metadata = metadataFromPage(page)
    } else if (sourceUrl && isFetchableUrl(sourceUrl)) {
      metadata = await fetchMetadata(sourceUrl)
    } else {
      metadata = emptyMetadata()
    }

    const kindGuess = classifyKind({ sourceUrl, metadata, hasSelection, hasImage })

    let creator = inferCreator(metadata, sourceUrl, kindGuess.kind, sharedText)
    if (!creator && sourceUrl) {
      creator = await oembedCreator(sourceUrl)
    }

    return {
      kind: kindGuess.kind,
      kind_confidence: kindGuess.confidence,
      kind_reason: kindGuess.reason,
      title: titleOf(metadata),
      creator: creator?.value ?? null,
      creator_source: creator?.source ?? null,
      image_url: metaOf(metadata, 'og:image', 'twitter:image', 'og:image:secure_url'),
      source_url: sourceUrl,
    }
  } catch {
    // Enrichment is an enhancement, never a blocker — degrade to silence.
    return nullResult(sourceUrl)
  }
})

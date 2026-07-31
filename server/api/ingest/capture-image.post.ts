/**
 * iOS Share Extension photo upload. Raw Share Sheet photos (e.g. shared from
 * Photos) are image bytes with no URL to hand over, unlike Chrome's
 * right-click-on-image which always has a `src`. Rather than bolting
 * multipart support onto /api/ingest/capture's JSON contract — the route the
 * Chrome extension already depends on — this hands back a URL that the
 * caller then passes to that route as a normal `image_url`.
 *
 * No CORS: only ever called from the native app via URLSession, never from a
 * browser, so no preflight is ever issued (contrast capture.post.ts).
 */
import { setResponseStatus } from 'h3'

// Generous headroom for an extension-downscaled photo (1600px longest side,
// JPEG q0.8 lands well under 1MB in practice), while keeping Worker memory
// and R2 usage bounded.
const MAX_BYTES = 8 * 1024 * 1024

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
}

export default defineEventHandler(async (event) => {
  requireIngestKey(event, 'TASTE_IOS_KEY')

  const env = event?.context?.cloudflare?.env
  const bucket = env?.TASTE_IMAGES
  if (!bucket) {
    throw createError({ statusCode: 500, statusMessage: 'R2 binding (TASTE_IMAGES) is not configured.' })
  }

  const contentType = (getRequestHeader(event, 'content-type') || 'image/jpeg').split(';')[0].trim()
  const ext = EXT_BY_TYPE[contentType]
  if (!ext) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported image type.' })
  }

  // Check the declared length first so an oversized upload is rejected
  // before it is buffered, then re-check the actual bytes — Content-Length
  // is a claim, not a guarantee.
  const declared = Number(getRequestHeader(event, 'content-length') || 0)
  if (declared > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Image too large.' })
  }

  const bytes = await readRawBody(event, false)
  if (!bytes || !bytes.length) {
    throw createError({ statusCode: 400, statusMessage: 'Empty image body.' })
  }
  if (bytes.length > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Image too large.' })
  }

  const key = `${crypto.randomUUID()}.${ext}`
  await bucket.put(key, bytes, { httpMetadata: { contentType } })

  setResponseStatus(event, 201)
  return { url: `https://taste.phareim.no/api/images/${key}` }
})

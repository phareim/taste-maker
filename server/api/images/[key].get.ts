/**
 * Serves an image uploaded by the iOS Share Extension out of R2.
 *
 * No auth: this is the same visibility as any other `image_url` already
 * rendered in the library UI, which are arbitrary public URLs hotlinked from
 * elsewhere. This just adds one more source for that column. Keys are UUIDs
 * and objects are never overwritten, so the response is immutable-cacheable.
 */
import { setResponseHeaders, setResponseStatus } from 'h3'

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') || ''
  // Keys are always `<uuid>.<ext>` as minted by capture-image.post.ts —
  // anything else can't exist, so reject it without touching R2.
  if (!/^[0-9a-f-]{36}\.(jpg|png|heic|webp)$/i.test(key)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  }

  const bucket = event?.context?.cloudflare?.env?.TASTE_IMAGES
  if (!bucket) {
    throw createError({ statusCode: 500, statusMessage: 'R2 binding (TASTE_IMAGES) is not configured.' })
  }

  const object = await bucket.get(key)
  if (!object) {
    throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  }

  setResponseStatus(event, 200)
  setResponseHeaders(event, {
    'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: object.httpEtag,
  })
  return object.body
})

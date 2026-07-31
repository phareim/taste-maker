// Vendored from reader/server/utils/cloudflare.ts (D1 only).
import { createError } from 'h3'

type CloudflareEnv = {
  DB?: any
  TASTE_DB?: any
  NVIDIA_API_KEY?: string
  TASTE_INGEST_KEY?: string
  TASTE_EXTENSION_KEY?: string
  TASTE_IOS_KEY?: string
  TASTE_IMAGES?: any
}

// Bearer gate for the server-to-server / extension ingest routes. Session
// auth doesn't apply there — the caller is a Worker or a browser extension,
// not a browser holding a Reader cookie. `envKey` selects which secret to
// check: Reader's highlight mirror uses TASTE_INGEST_KEY, the Chrome
// extension uses its own TASTE_EXTENSION_KEY, and the iOS Share Extension
// its own TASTE_IOS_KEY (each is a separate trust boundary — a key living
// in browser extension storage or an iOS Keychain is more exposed than one
// in a Worker's config, so each is independently rotatable). 503 when none of
// the accepted keys is set (feature off), 401 on mismatch.
//
// Accepts a LIST because one route can legitimately serve two clients with
// distinct trust boundaries: /api/ingest/capture is the shared item-creation
// endpoint for both the Chrome extension and the iOS Share Extension. Keeping
// separate secrets that both open the same door preserves the point of having
// two — either can be rotated without touching the other.
type IngestKeyName = 'TASTE_INGEST_KEY' | 'TASTE_EXTENSION_KEY' | 'TASTE_IOS_KEY'

export const requireIngestKey = (
  event: any,
  envKey: IngestKeyName | IngestKeyName[] = 'TASTE_INGEST_KEY'
) => {
  const env = event?.context?.cloudflare?.env as CloudflareEnv | undefined
  const names = Array.isArray(envKey) ? envKey : [envKey]
  const configured = names.map((n) => env?.[n]).filter((v): v is string => Boolean(v))
  if (!configured.length) {
    throw createError({ statusCode: 503, statusMessage: 'Ingest is not configured.' })
  }
  const header = event?.node?.req?.headers?.authorization ?? ''
  if (!configured.some((key) => header === `Bearer ${key}`)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid ingest key.' })
  }
}

export const getD1 = (event: any) => {
  const env = event?.context?.cloudflare?.env as CloudflareEnv | undefined
  if (!env?.DB) {
    throw createError({
      statusCode: 500,
      statusMessage: 'D1 database binding (DB) is not configured.',
    })
  }
  return env.DB
}

// taste-maker's OWN writable D1 (app data — items, connections). Distinct
// from getD1 above, which stays pointed at Reader's read-only session DB.
export const getTasteDb = (event: any) => {
  const env = event?.context?.cloudflare?.env as CloudflareEnv | undefined
  if (!env?.TASTE_DB) {
    throw createError({
      statusCode: 500,
      statusMessage: 'D1 database binding (TASTE_DB) is not configured.',
    })
  }
  return env.TASTE_DB
}

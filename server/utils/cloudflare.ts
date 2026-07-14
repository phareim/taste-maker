// Vendored from reader/server/utils/cloudflare.ts (D1 only).
import { createError } from 'h3'

type CloudflareEnv = {
  DB?: any
  TASTE_DB?: any
  NVIDIA_API_KEY?: string
  TASTE_INGEST_KEY?: string
}

// Bearer gate for the server-to-server ingest routes (Reader's highlight
// mirror). Session auth doesn't apply there — the caller is a Worker, not a
// browser. 503 when the key is unset (feature off), 401 on mismatch.
export const requireIngestKey = (event: any) => {
  const env = event?.context?.cloudflare?.env as CloudflareEnv | undefined
  const key = env?.TASTE_INGEST_KEY
  if (!key) {
    throw createError({ statusCode: 503, statusMessage: 'Ingest is not configured.' })
  }
  const header = event?.node?.req?.headers?.authorization ?? ''
  if (header !== `Bearer ${key}`) {
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

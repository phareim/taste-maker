// Vendored from reader/server/utils/cloudflare.ts (D1 only).
import { createError } from 'h3'

type CloudflareEnv = {
  DB?: any
  TASTE_DB?: any
  NVIDIA_API_KEY?: string
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

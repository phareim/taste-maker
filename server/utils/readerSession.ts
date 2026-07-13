/**
 * Reader-session validation. Reader (reader.phareim.no) is the identity
 * provider: it sets the `session_token` cookie with domain .phareim.no and
 * owns the "session"/"User" tables in the shared reader-service D1 database.
 * This app validates the cookie READ-ONLY — no expiry cleanup, no writes;
 * Reader owns the schema. Vendored convention from reader/server/utils/.
 */
import { H3Event, getCookie, createError } from 'h3'
import { getD1 } from '~/server/utils/cloudflare'

const SESSION_COOKIE = 'session_token'

export const READER_LOGIN = 'https://reader.phareim.no/login'

export interface ReaderUser {
  id: string
  email: string
  name: string | null
}

export async function getReaderUser(event: H3Event): Promise<ReaderUser | null> {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return null

  const db = getD1(event)
  const user = await db
    .prepare(
      'SELECT u.id, u.email, u.name FROM "session" s JOIN "User" u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'
    )
    .bind(token, new Date().toISOString())
    .first()

  return (user as ReaderUser) ?? null
}

/**
 * The real gate for every proxy route: any Reader account holds a valid
 * session cookie, but the tasks behind this app are single-user data.
 * 401 without a session, 403 for a session outside the allowlist.
 */
export async function requireAllowedUser(event: H3Event): Promise<ReaderUser> {
  const user = await getReaderUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  }

  const allowed = (useRuntimeConfig(event).allowedUserEmails || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean)

  if (!allowed.includes(user.email.toLowerCase())) {
    throw createError({ statusCode: 403, statusMessage: 'Not authorized for this app' })
  }

  return user
}

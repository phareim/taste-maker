/**
 * Read-only auth state — Reader (reader.phareim.no) is the identity
 * provider; this app only checks whether its domain-wide session cookie
 * resolves to a user. Signing in/out happens on Reader. The login gate
 * (middleware/auth.global.ts) fills this state during SSR; the client reuses
 * it after hydration and asks only when the server could not tell.
 */
export const READER_LOGIN = 'https://reader.phareim.no/login'

interface SessionUser {
  id: string
  email: string
  name: string | null
}

export function useAuth() {
  const user = useState<SessionUser | null>('auth_user', () => null)
  const checked = useState<boolean>('auth_checked', () => false)

  async function fetchSession(): Promise<SessionUser | null> {
    try {
      const data = await $fetch<{ user: SessionUser | null }>('/api/auth/session')
      user.value = data.user
    } catch {
      user.value = null
    }
    checked.value = true
    return user.value
  }

  // Reader's login with a redirect back to the page asked for. useRequestURL
  // is the incoming request's URL on the server and window.location in the
  // browser, so no app name is hard-coded. On the server the scheme only
  // comes from X-Forwarded-Proto (Nitro's cloudflare-module entry passes
  // "https:", h3/unenv compare against "https"), so a non-local http URL is
  // lifted to https: the apps are only served over https.
  function loginUrl(): string {
    const here = useRequestURL()
    if (here.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(here.hostname)) {
      here.protocol = 'https:'
    }
    return `${READER_LOGIN}?redirect=${encodeURIComponent(here.href)}`
  }

  return { user, checked, fetchSession, loginUrl }
}

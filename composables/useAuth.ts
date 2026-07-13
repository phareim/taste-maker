/**
 * Read-only auth state — Reader (reader.phareim.no) is the identity
 * provider; this app only checks whether its domain-wide session cookie
 * resolves to a user. Signing in/out happens on Reader.
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

  function loginUrl(): string {
    const here = import.meta.client ? window.location.href : 'https://taste.phareim.no/'
    return `${READER_LOGIN}?redirect=${encodeURIComponent(here)}`
  }

  return { user, checked, fetchSession, loginUrl }
}

/**
 * Login bounce: without a valid Reader session, send the browser to Reader's
 * login with a redirect back here.
 *
 * Server (the first request of a visit): asks this app's own
 * /api/auth/session with the request's cookie and stores the answer in the
 * same useState as useAuth, so the client does not ask again after hydration.
 * A definite `{ user: null }` answers 302 to Reader's login before any page
 * code runs. When the check itself fails (throws, 5xx, D1 down) the server
 * does NOT redirect: the page renders and the client check below decides, so
 * a hiccup here can never loop between this app and Reader's login.
 *
 * Client (client-side navigation, or after a failed server check): the same
 * check with $fetch, then a full-page bounce.
 *
 * Every data endpoint is still guarded on its own (401/403 from the proxies);
 * this gate only spares the shell, the 401s and the flash.
 */
export default defineNuxtRouteMiddleware(async () => {
  const { user, checked, fetchSession, loginUrl } = useAuth()

  if (import.meta.server) {
    if (!checked.value) {
      let data: { user: typeof user.value } | undefined
      try {
        data = await useRequestFetch()<{ user: typeof user.value }>('/api/auth/session')
      } catch {
        return // check failed: no verdict, leave it to the client
      }
      if (!data || typeof data !== 'object' || !('user' in data)) return // not an answer
      user.value = data.user ?? null
      checked.value = true
    }
    if (!user.value) {
      return navigateTo(loginUrl(), { external: true, redirectCode: 302 })
    }
    return
  }

  if (!checked.value) {
    await fetchSession()
  }
  if (!user.value) {
    window.location.href = loginUrl()
    return abortNavigation()
  }
})

/**
 * Client-side login bounce: without a valid Reader session, send the
 * browser to Reader's login with a redirect back here. Runs client-only —
 * SSR renders the shell and every data endpoint is guarded server-side
 * anyway (401/403 from the proxies).
 */
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return

  const { user, checked, fetchSession, loginUrl } = useAuth()
  if (!checked.value) {
    await fetchSession()
  }
  if (!user.value) {
    window.location.href = loginUrl()
    return abortNavigation()
  }
})

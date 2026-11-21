/**
 * `source_url` is stored as the capture client sent it, so it can hold any
 * scheme. Only http(s) may become a link or be opened: a `javascript:` URL
 * would run on click. Returns the URL when it is safe to link, else null
 * (the caller then shows it as plain text).
 */
export function linkableUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

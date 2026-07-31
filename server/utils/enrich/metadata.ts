// Normalizes a page's head into one struct, from either of two sources:
// the Worker fetching and parsing the HTML itself, or the iOS Share
// Extension's JS preprocessor handing over what Safari already had in the DOM
// (in which case no outbound fetch happens at all).

/** All `<meta>` name/property values, lowercased keys. Plus the raw JSON-LD blobs. */
export interface PageMetadata {
  title: string | null
  meta: Record<string, string>
  jsonLd: any[]
}

export const emptyMetadata = (): PageMetadata => ({ title: null, meta: {}, jsonLd: [] })

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

/**
 * Every value here comes out of raw HTML attributes, so entities are routine —
 * `og:title` for a shirt is literally `Men&#39;s Loopback Sweatshirt`. Decoding
 * at the accessor rather than at each call site means no caller can forget.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

export const metaOf = (m: PageMetadata, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = m.meta[k.toLowerCase()]
    if (v && v.trim()) return decodeEntities(v).trim()
  }
  return null
}

/** og:title if present, else the <title> element. */
export const titleOf = (m: PageMetadata): string | null =>
  metaOf(m, 'og:title', 'twitter:title') ||
  (m.title && m.title.trim() ? decodeEntities(m.title).trim() : null)

export const siteNameOf = (m: PageMetadata): string | null => metaOf(m, 'og:site_name', 'application-name')

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Removes `suffix` from the end of `t`, but never leaves it empty. */
function stripSuffix(t: string, pattern: string): string {
  const stripped = t.replace(new RegExp(pattern, 'i'), '').trim()
  return stripped || t
}

/**
 * `og:title` is written for search results, not for a library entry: it carries
 * the site's name and often the creator's too ("Rumours by Fleetwood Mac on
 * Apple Music", "Loopback Sweatshirt | Sunspel"). Both end up duplicated next to
 * a field that already holds them, so strip what we're storing separately.
 *
 * Only ever removes a suffix it can match against a KNOWN value — the site name,
 * the bare host, or the creator we resolved. It never guesses at a separator,
 * which would eat real titles like "Blood on the Tracks".
 */
export function cleanTitle(
  m: PageMetadata,
  sourceUrl: string | null,
  creator: string | null
): string | null {
  let t = titleOf(m)
  if (!t) return null

  const site = siteNameOf(m)
  const bareHost = (() => {
    try {
      return sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, '').replace(/\.[a-z.]+$/, '') : null
    } catch {
      return null
    }
  })()
  // Site names often carry a tagline — Apple Music sends "Apple Music - Web
  // Player" while its titles end in plain "on Apple Music" — so the leading
  // segment counts as an owner name too.
  const siteHead = site?.split(/\s+[—–|·-]\s+/)[0].trim() || null
  const owners = [site, siteHead, bareHost].filter((v): v is string => Boolean(v))

  // "… on Apple Music" / "… on Spotify"
  for (const owner of owners) {
    t = stripSuffix(t, `\\s+on\\s+${escapeRe(owner)}\\.?$`)
  }

  // A trailing separator segment that is the site, the host, or the creator.
  const drop = [...owners, creator].filter((v): v is string => Boolean(v)).map(norm)
  for (let i = 0; i < 2; i++) {
    const parts = t.split(/\s+[—–|·]\s+|\s+-\s+/)
    if (parts.length < 2) break
    const last = parts[parts.length - 1].trim()
    if (!drop.includes(norm(last))) break
    const rest = parts.slice(0, -1).join(' — ').trim()
    if (!rest) break
    t = rest
  }

  // "Rumours by Fleetwood Mac" once we already know the artist.
  if (creator) t = stripSuffix(t, `\\s+by\\s+${escapeRe(creator)}\\.?$`)

  return t || null
}

/**
 * JSON-LD is routinely malformed, deeply nested, and wrapped in `@graph`.
 * Flatten every node we can reach so callers can just scan for an `@type`.
 */
export function flattenJsonLd(blobs: any[]): any[] {
  const out: any[] = []
  const visit = (node: any, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 6) return
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1))
      return
    }
    out.push(node)
    if (node['@graph']) visit(node['@graph'], depth + 1)
    if (node.mainEntity) visit(node.mainEntity, depth + 1)
    if (node.mainEntityOfPage) visit(node.mainEntityOfPage, depth + 1)
  }
  blobs.forEach((b) => visit(b, 0))
  return out
}

/** Nodes whose `@type` (string or array) matches any of `types`. */
export function nodesOfType(nodes: any[], ...types: string[]): any[] {
  const wanted = new Set(types.map((t) => t.toLowerCase()))
  return nodes.filter((n) => {
    const t = n?.['@type']
    if (typeof t === 'string') return wanted.has(t.toLowerCase())
    if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && wanted.has(x.toLowerCase()))
    return false
  })
}

/**
 * schema.org lets almost any property be a string, an object with `name`, or
 * an array of either. Collapse all of that to at most 3 names.
 */
export function namesFrom(value: any): string | null {
  const collect = (v: any, acc: string[]) => {
    if (!v || acc.length >= 3) return
    if (typeof v === 'string') {
      if (v.trim()) acc.push(v.trim())
    } else if (Array.isArray(v)) {
      v.forEach((x) => collect(x, acc))
    } else if (typeof v === 'object') {
      if (typeof v.name === 'string' && v.name.trim()) acc.push(v.name.trim())
    }
  }
  const acc: string[] = []
  collect(value, acc)
  return acc.length ? acc.join(', ') : null
}

/** Parse the metadata the iOS preprocessor scraped from the live DOM. */
export function metadataFromPage(page: any): PageMetadata {
  const meta: Record<string, string> = {}
  if (page?.meta && typeof page.meta === 'object') {
    for (const [k, v] of Object.entries(page.meta)) {
      if (typeof v === 'string') meta[k.toLowerCase()] = v
    }
  }
  const jsonLd: any[] = []
  const raw = Array.isArray(page?.jsonld) ? page.jsonld : []
  for (const blob of raw) {
    if (typeof blob !== 'string') continue
    try {
      jsonLd.push(JSON.parse(blob))
    } catch {
      // Malformed JSON-LD is common enough that it isn't worth reporting.
    }
  }
  return {
    title: typeof page?.title === 'string' ? page.title : null,
    meta,
    jsonLd,
  }
}

// Some sites emit enormous JSON-LD blobs; cap what we retain per script.
const MAX_JSONLD_CHARS = 256 * 1024

/**
 * Stream a fetched page through HTMLRewriter — native to the Workers runtime,
 * so no HTML-parsing dependency is added (this repo's deps are deliberately
 * minimal). Only the head-level tags we care about are retained.
 */
export async function metadataFromResponse(response: Response): Promise<PageMetadata> {
  const meta: Record<string, string> = {}
  const jsonLdText: string[] = []
  let title = ''
  let inTitle = false
  let current = ''

  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el: any) {
        const key = el.getAttribute('property') || el.getAttribute('name')
        const content = el.getAttribute('content')
        if (key && content) meta[key.toLowerCase()] = content
      },
    })
    .on('title', {
      element() {
        inTitle = true
      },
      text(chunk: any) {
        if (inTitle && title.length < 500) title += chunk.text
        if (chunk.lastInTextNode) inTitle = false
      },
    })
    .on('script[type="application/ld+json"]', {
      element() {
        current = ''
      },
      text(chunk: any) {
        if (current.length < MAX_JSONLD_CHARS) current += chunk.text
        if (chunk.lastInTextNode) {
          if (current.trim()) jsonLdText.push(current)
          current = ''
        }
      },
    })

  // HTMLRewriter is lazy — the handlers only run as the body is consumed.
  await rewriter.transform(response).arrayBuffer()

  const jsonLd: any[] = []
  for (const text of jsonLdText) {
    try {
      jsonLd.push(JSON.parse(text))
    } catch {
      // Ignore; a broken blob shouldn't cost us the well-formed ones.
    }
  }

  return { title: title.trim() || null, meta, jsonLd }
}

declare const HTMLRewriter: any

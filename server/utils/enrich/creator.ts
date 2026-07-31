// Best-effort `creator` inference.
//
// Nothing in this codebase has ever filled `creator` — the Chrome extension,
// /capture and the Reader highlight mirror all leave it to be typed by hand.
// This is the ladder that changes that. It is deliberately DETERMINISTIC: no
// model, no guessing. Every rung either produces a value it can point at a
// source for, or falls through. A blank field beats a confident wrong
// attribution, because a wrong one gets silently committed to the library.

import type { Kind } from '~/types/taste'
import {
  decodeEntities,
  flattenJsonLd,
  metaOf,
  namesFrom,
  nodesOfType,
  siteNameOf,
  titleOf,
  type PageMetadata,
} from './metadata'
import { matchRule, normalizeHost } from './domains'

export interface CreatorGuess {
  value: string
  /** Human-readable provenance, shown as a caption under the field. */
  source: string
}

/**
 * Every rung's output passes through here. Returns null when the value looks
 * like the pattern matched garbage rather than a name.
 */
export function normalizeCreator(raw: string | null | undefined, kind: Kind | null, title: string | null): string | null {
  if (!raw) return null
  let v = decodeEntities(String(raw))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^by\s+/i, '')
    .replace(/[®™]/g, '')
    .replace(/\s+-\s+Topic$/i, '') // YouTube's auto-generated artist channels
    .trim()

  if (kind === 'clothing') {
    v = v.replace(/[,\s]+(AS|ASA|A\/S|Inc\.?|Ltd\.?|LLC|GmbH|B\.?V\.?|S\.?A\.?)$/i, '').trim()
  }

  if (!v) return null
  if (v.length > 80) return null
  if (/^https?:\/\//i.test(v)) return null
  if (title && v.toLowerCase() === title.trim().toLowerCase()) return null
  return v
}

/**
 * "mdou-moctar" -> "Mdou Moctar". Used only where a URL slug stands in for a
 * display name (a Bandcamp subdomain, an author profile path). NOT used for
 * handles like a GitHub owner or an Instagram username, where the lowercase
 * form is the actual identity.
 */
export function humanizeSlug(slug: string): string | null {
  const cleaned = slug.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned || /\d{4,}/.test(cleaned)) return null
  return cleaned
    .split(' ')
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

// Publications overwhelmingly point `article:author` at a profile page rather
// than naming the author. The name is usually right there in the path.
const AUTHOR_PATH = /\/(?:profile|author|authors|by|people|contributor|writers?)\/([^/?#]+)/i

function creatorFromAuthorUrl(raw: string | null): string | null {
  if (!raw || !/^https?:\/\//i.test(raw)) return null
  try {
    const url = new URL(raw)
    const slug = AUTHOR_PATH.exec(url.pathname)?.[1]
    if (slug) return humanizeSlug(decodeURIComponent(slug))
    const last = url.pathname.split('/').filter(Boolean).pop()
    if (last?.startsWith('@')) return last.slice(1)
    return null
  } catch {
    return null
  }
}

// --- rung 4: per-host extractors -------------------------------------------
// Sync only — anything needing a network call lives in oembedCreator below.

type Extractor = (m: PageMetadata, url: URL) => string | null

const HOST_EXTRACTORS: Array<{ match: RegExp; extract: Extractor }> = [
  {
    // og:description is "Song · Fleetwood Mac · 1977" (order varies). Drop the
    // segments that are the title, a bare year, or the content-type word; the
    // first survivor is the artist.
    match: /^open\.spotify\.com$/,
    extract: (m) => {
      const desc = metaOf(m, 'og:description')
      if (!desc) return null
      const title = (titleOf(m) || '').toLowerCase()
      const parts = desc
        .split('·')
        .map((p) => p.trim())
        .filter(Boolean)
      for (const part of parts) {
        if (part.toLowerCase() === title) continue
        if (/^\d{4}$/.test(part)) continue
        if (/^(song|album|playlist|podcast|episode|single|ep)$/i.test(part)) continue
        if (/^\d+ (songs?|likes?|saves?|followers?)/i.test(part)) continue
        return part
      }
      return null
    },
  },
  {
    match: /^music\.apple\.com$/,
    extract: (m) => {
      // "Rumours by Fleetwood Mac on Apple Music"
      const t = titleOf(m)
      const byMatch = t?.match(/^(.+?)\s+by\s+(.+?)(?:\s+on Apple Music)?$/i)
      if (byMatch) return byMatch[2]
      // "Listen to Rumours by Fleetwood Mac on Apple Music."
      const desc = metaOf(m, 'og:description')
      return desc?.match(/\bby\s+(.+?)(?:\s+on Apple Music)?\.?$/i)?.[1] ?? null
    },
  },
  {
    match: /(^|\.)bandcamp\.com$/,
    extract: (m, url) => {
      const t = titleOf(m)
      const byMatch = t?.match(/,\s+by\s+(.+)$/i)
      if (byMatch) return byMatch[1]
      // Bandcamp renders entirely client-side, so a server-side fetch sees no
      // og:title at all — the artist subdomain is the only signal left.
      const sub = url.hostname.toLowerCase().replace(/^www\./, '').split('.')[0]
      return sub && sub !== 'bandcamp' ? humanizeSlug(sub) : null
    },
  },
  {
    match: /^(m\.)?soundcloud\.com$/,
    extract: (m, url) => {
      const t = titleOf(m)
      const byMatch = t?.match(/\s+by\s+(.+)$/i)
      if (byMatch) return byMatch[1]
      const first = url.pathname.split('/').filter(Boolean)[0]
      return first ? humanizeSlug(first) : null
    },
  },
  {
    match: /^github\.com$/,
    extract: (_m, url) => url.pathname.split('/').filter(Boolean)[0] || null,
  },
  {
    match: /^medium\.com$/,
    extract: (_m, url) => {
      const first = url.pathname.split('/').filter(Boolean)[0]
      return first?.startsWith('@') ? first.slice(1) : null
    },
  },
  {
    match: /(^|\.)substack\.com$/,
    extract: (m, url) => {
      const site = siteNameOf(m)
      if (site) return site
      const sub = url.hostname.toLowerCase().replace(/^www\./, '').split('.')[0]
      return sub && sub !== 'substack' ? sub : null
    },
  },
  {
    match: /^(www\.)?instagram\.com$/,
    extract: (_m, url) => {
      const parts = url.pathname.split('/').filter(Boolean)
      // /p/<id> and /reel/<id> are posts, not profiles — no author in the path.
      if (!parts.length || ['p', 'reel', 'reels', 'explore', 'stories'].includes(parts[0])) return null
      return parts[0]
    },
  },
]

/**
 * The ladder. First rung to produce a value that survives normalization wins.
 */
export function inferCreator(
  m: PageMetadata,
  sourceUrl: string | null,
  kind: Kind | null,
  sharedText: string | null
): CreatorGuess | null {
  const title = titleOf(m)
  const nodes = flattenJsonLd(m.jsonLd)

  const take = (raw: string | null, source: string): CreatorGuess | null => {
    const value = normalizeCreator(raw, kind, title)
    return value ? { value, source } : null
  }

  // 1 — kind-aware structured data. The most trustworthy signal by far:
  // the page is explicitly asserting who made the thing.
  const jsonLdRungs: Array<[string[], string, (n: any) => any]> = [
    [['MusicRecording', 'MusicAlbum', 'MusicGroup'], 'byArtist', (n) => n.byArtist],
    [['Product', 'ProductGroup'], 'brand', (n) => n.brand],
    [['VisualArtwork', 'Painting', 'Sculpture'], 'creator', (n) => n.creator ?? n.artist],
    [['Article', 'NewsArticle', 'BlogPosting', 'Book', 'Report'], 'author', (n) => n.author],
    [['VideoObject', 'PodcastEpisode'], 'author', (n) => n.author ?? n.creator],
  ]
  for (const [types, field, pick] of jsonLdRungs) {
    for (const node of nodesOfType(nodes, ...types)) {
      const hit = take(namesFrom(pick(node)), `JSON-LD ${types[0]}.${field}`)
      if (hit) return hit
    }
  }

  // 2 — Open Graph music vertical.
  const musician = take(metaOf(m, 'music:musician', 'og:audio:artist'), 'og:music:musician')
  if (musician) return musician

  // 3 — plain author meta.
  const author = take(metaOf(m, 'author', 'article:author', 'twitter:creator'), 'page author metadata')
  if (author) {
    return { ...author, value: author.value.replace(/^@/, '') }
  }

  // 3b — ...and when that meta is a profile URL (which normalizeCreator just
  // rejected), the author's name is usually still sitting in its path.
  for (const key of ['article:author', 'author', 'og:article:author']) {
    const hit = take(creatorFromAuthorUrl(metaOf(m, key)), 'author profile link')
    if (hit) return hit
  }

  // 4 — per-host extractors.
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl)
      const host = normalizeHost(sourceUrl)
      const entry = HOST_EXTRACTORS.find((e) => e.match.test(url.hostname.toLowerCase().replace(/^www\./, '')))
      if (entry) {
        const hit = take(entry.extract(m, url), `matched ${host}`)
        if (hit) return hit
      }
    } catch {
      // Unparseable URL — skip this rung.
    }
  }

  // 4b — a single-brand shop IS the brand. Most such product pages carry no
  // `Product.brand` at all (verified on Sunspel), so without this the one field
  // a clothing capture most wants stays empty. Deliberately below the per-host
  // and structured rungs: a real brand assertion always wins, and multi-brand
  // retailers are excluded by the table, since "Ssense" is nobody's label.
  if (kind === 'clothing' && sourceUrl) {
    const hit = matchRule(sourceUrl)
    if (hit && !hit.rule.multiBrand) {
      const brand = take(siteNameOf(m), 'the retailer’s own name')
      if (brand) return brand
    }
  }

  // 5 — title patterns. "X by Y" is safe; a trailing separator segment is only
  // a creator when it ISN'T the site's own name, otherwise
  // "Headline | The Guardian" would attribute every article to the masthead.
  if (title) {
    const byMatch = title.match(/^(.+?)\s+by\s+(.+)$/i)
    if (byMatch) {
      const hit = take(byMatch[2], 'title pattern')
      if (hit) return hit
    }
    const segments = title.split(/\s+[—–|]\s+|\s+:\s+/)
    if (segments.length >= 2) {
      const trailing = segments[segments.length - 1].trim()
      const site = (siteNameOf(m) || '').toLowerCase()
      const host = normalizeHost(sourceUrl || '') || ''
      const bare = host.replace(/\.[a-z.]+$/, '')
      const looksLikeSite =
        (site && trailing.toLowerCase() === site) ||
        (bare && trailing.toLowerCase().replace(/\s+/g, '') === bare.replace(/[^a-z0-9]/g, ''))
      if (!looksLikeSite) {
        const hit = take(trailing, 'title pattern')
        if (hit) return hit
      }
    }
  }

  // 6 — the Share Sheet's own text, e.g. Spotify's "Dreams by Fleetwood Mac".
  if (sharedText) {
    const byMatch = sharedText.match(/\s+by\s+(.+)$/i)
    if (byMatch) {
      const hit = take(byMatch[1], 'shared text')
      if (hit) return hit
    }
  }

  // 7 — nothing. Leave it blank rather than inventing an attribution.
  return null
}

/**
 * Network-backed last resort for the two hosts that expose a no-auth oEmbed
 * `author_name`. Kept out of `inferCreator` so that stays pure and testable.
 *
 * The endpoint patterns are the ones already used in components/ItemCard.vue's
 * `oembedEndpoint()`, which fetches these same URLs for a thumbnail and
 * explicitly ignores `author_name` — this is that unused half.
 */
export async function oembedCreator(sourceUrl: string): Promise<CreatorGuess | null> {
  let endpoint: string | null = null
  if (/youtu\.be\/|youtube\.com\/(watch|embed|shorts)/i.test(sourceUrl)) {
    endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(sourceUrl)}`
  } else if (/vimeo\.com\//i.test(sourceUrl)) {
    endpoint = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(sourceUrl)}`
  }
  if (!endpoint) return null

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const data: any = await res.json()
    const value = normalizeCreator(data?.author_name, null, data?.title ?? null)
    return value ? { value, source: 'oEmbed author' } : null
  } catch {
    return null
  }
}

// The kind-routing table: which hosts map to which kind, with no ambiguity.
//
// iOS gives a Share Extension NO way to learn which app invoked it — there is
// no public API for the host application's bundle ID. So "a Spotify share
// becomes music" is implemented against the shared URL's host instead. Every
// music and clothing app worth capturing from shares a URL, so in practice
// this behaves identically to app detection.
//
// THIS FILE IS MEANT TO BE APPENDED TO. Adding a host is a one-line change
// and a deploy — no app rebuild, which is the whole reason the table lives
// server-side rather than in Swift. Keep each group alphabetized.

import type { Kind } from '~/types/taste'

export interface DomainRule {
  /** Matched against the lowercased hostname, `www.` already stripped. */
  match: RegExp
  kind: Kind
}

export const DOMAIN_RULES: DomainRule[] = [
  // --- music ---------------------------------------------------------
  { match: /(^|\.)bandcamp\.com$/, kind: 'music' },
  { match: /^bleep\.com$/, kind: 'music' },
  { match: /^boomkat\.com$/, kind: 'music' },
  { match: /^deezer\.com$/, kind: 'music' },
  { match: /^discogs\.com$/, kind: 'music' },
  { match: /^last\.fm$/, kind: 'music' },
  { match: /^mixcloud\.com$/, kind: 'music' },
  { match: /^music\.apple\.com$/, kind: 'music' },
  { match: /^music\.youtube\.com$/, kind: 'music' },
  { match: /^nts\.live$/, kind: 'music' },
  { match: /^open\.spotify\.com$/, kind: 'music' },
  { match: /^(m\.)?soundcloud\.com$/, kind: 'music' },
  { match: /^spotify\.link$/, kind: 'music' },
  { match: /^(listen\.)?tidal\.com$/, kind: 'music' },

  // --- clothing ------------------------------------------------------
  { match: /^acnestudios\.com$/, kind: 'clothing' },
  { match: /(^|\.)adidas\.[a-z.]+$/, kind: 'clothing' },
  { match: /^arcteryx\.com$/, kind: 'clothing' },
  { match: /^aritzia\.com$/, kind: 'clothing' },
  { match: /^arket\.com$/, kind: 'clothing' },
  { match: /^carhartt-wip\.com$/, kind: 'clothing' },
  { match: /^cos\.com$/, kind: 'clothing' },
  { match: /^drakes\.com$/, kind: 'clothing' },
  { match: /^endclothing\.com$/, kind: 'clothing' },
  { match: /^everlane\.com$/, kind: 'clothing' },
  { match: /^(www2\.)?hm\.com$/, kind: 'clothing' },
  { match: /^farfetch\.com$/, kind: 'clothing' },
  { match: /^matchesfashion\.com$/, kind: 'clothing' },
  { match: /^mrporter\.com$/, kind: 'clothing' },
  { match: /^net-a-porter\.com$/, kind: 'clothing' },
  { match: /^nike\.com$/, kind: 'clothing' },
  { match: /^norseprojects\.com$/, kind: 'clothing' },
  { match: /^patagonia\.com$/, kind: 'clothing' },
  { match: /^ssense\.com$/, kind: 'clothing' },
  { match: /^stussy\.com$/, kind: 'clothing' },
  { match: /^sunspel\.com$/, kind: 'clothing' },
  { match: /^uniqlo\.com$/, kind: 'clothing' },
  { match: /(^|\.)zalando\.[a-z.]+$/, kind: 'clothing' },

  // --- art -----------------------------------------------------------
  { match: /^artnet\.com$/, kind: 'art' },
  { match: /^artsy\.net$/, kind: 'art' },
  { match: /^behance\.net$/, kind: 'art' },
  { match: /^cara\.app$/, kind: 'art' },
  { match: /^dribbble\.com$/, kind: 'art' },
  { match: /^metmuseum\.org$/, kind: 'art' },
  { match: /^moma\.org$/, kind: 'art' },
  { match: /^nasjonalmuseet\.no$/, kind: 'art' },
  { match: /^saatchiart\.com$/, kind: 'art' },
  { match: /^tate\.org\.uk$/, kind: 'art' },
  { match: /^wikiart\.org$/, kind: 'art' },
]

/** Lowercased hostname with `www.`, a trailing dot, and any port removed. */
export function normalizeHost(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  } catch {
    return null
  }
}

export function matchDomain(url: string): { kind: Kind; host: string } | null {
  const host = normalizeHost(url)
  if (!host) return null
  const rule = DOMAIN_RULES.find((r) => r.match.test(host))
  return rule ? { kind: rule.kind, host } : null
}

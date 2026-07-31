// Decides which kind a share becomes, and how sure we are.
//
// Confidence is what drives the UI contract: only `high` auto-selects a pill.
// `medium` renders the pill as a suggestion and leaves Save disabled, so an
// uncertain guess still saves typing without ever silently filing something
// under the wrong kind.

import type { Kind } from '~/types/taste'
import { matchDomain } from './domains'
import { flattenJsonLd, metaOf, nodesOfType, type PageMetadata } from './metadata'

export type Confidence = 'high' | 'medium' | 'low'

export interface KindGuess {
  kind: Kind | null
  confidence: Confidence
  /** Shown verbatim under the kind pills, e.g. "matched open.spotify.com". */
  reason: string
}

export interface ClassifyInput {
  sourceUrl: string | null
  metadata: PageMetadata
  hasSelection: boolean
  hasImage: boolean
}

export function classifyKind({ sourceUrl, metadata, hasSelection, hasImage }: ClassifyInput): KindGuess {
  // 1 — an explicit selection is an explicit intent. It outranks everything,
  // including a host match: selecting a lyric on a Spotify page is a quote,
  // not a music item.
  if (hasSelection) {
    return { kind: 'quote', confidence: 'high', reason: 'you selected text' }
  }

  // 2 — the routing table. This is what makes a Spotify or retailer share a
  // zero-tap capture.
  if (sourceUrl) {
    const matched = matchDomain(sourceUrl)
    if (matched) {
      return { kind: matched.kind, confidence: 'high', reason: `matched ${matched.host}` }
    }
  }

  const nodes = flattenJsonLd(metadata.jsonLd)
  const ogType = (metaOf(metadata, 'og:type') || '').toLowerCase()

  // 3 — structured data, for hosts not in the table. A product page is the
  // main way an unlisted retailer still routes to clothing.
  if (nodesOfType(nodes, 'Product', 'ProductGroup').length || ogType === 'product') {
    return { kind: 'clothing', confidence: 'medium', reason: 'looks like a product page' }
  }
  if (nodesOfType(nodes, 'MusicRecording', 'MusicAlbum', 'MusicGroup').length || ogType.startsWith('music')) {
    return { kind: 'music', confidence: 'high', reason: 'page says it is music' }
  }
  if (nodesOfType(nodes, 'VisualArtwork', 'Painting', 'Sculpture').length) {
    return { kind: 'art', confidence: 'high', reason: 'page says it is artwork' }
  }
  if (nodesOfType(nodes, 'Article', 'NewsArticle', 'BlogPosting', 'Report').length || ogType === 'article') {
    return { kind: 'reference', confidence: 'high', reason: 'looks like an article' }
  }

  // 4 — a bare photo with nowhere it came from.
  if (hasImage && !sourceUrl) {
    return { kind: 'art', confidence: 'medium', reason: 'shared a photo' }
  }

  // 5 — genuinely ambiguous. Say so and let the user pick, rather than
  // defaulting to `reference` the way the Chrome extension does.
  return { kind: null, confidence: 'low', reason: 'unrecognized source' }
}

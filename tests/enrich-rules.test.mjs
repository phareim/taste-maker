// The deterministic rules behind /api/ingest/enrich (server/utils/enrich/),
// tested as the pure functions they are. Each case is one the README or the
// code comments state as intended behaviour.
import test from 'node:test'
import assert from 'node:assert/strict'

const { classifyKind } = await import('~/server/utils/enrich/classify')
const { inferCreator, normalizeCreator, humanizeSlug } = await import('~/server/utils/enrich/creator')
const { matchDomain, matchRule, normalizeHost, siteNameForHost } = await import('~/server/utils/enrich/domains')
const { cleanTitle, decodeEntities, emptyMetadata, flattenJsonLd, metadataFromPage, namesFrom, nodesOfType } = await import('~/server/utils/enrich/metadata')

const meta = (meta = {}, extra = {}) => ({ title: null, meta, jsonLd: [], ...extra })

test('the routing table: host to kind, www and case ignored', () => {
  assert.deepEqual(matchDomain('https://open.spotify.com/track/x'), { kind: 'music', host: 'open.spotify.com' })
  assert.deepEqual(matchDomain('https://WWW.COS.com/en/p'), { kind: 'clothing', host: 'cos.com' })
  assert.deepEqual(matchDomain('https://www.artsy.net/artwork/x'), { kind: 'art', host: 'artsy.net' })
  assert.deepEqual(matchDomain('https://artist.bandcamp.com/album/x'), { kind: 'music', host: 'artist.bandcamp.com' })
  assert.equal(matchDomain('https://www.zalando.no/x').kind, 'clothing')
  assert.equal(matchDomain('https://example.test/'), null)
  assert.equal(matchDomain('https://notspotify.com.example.test/'), null) // anchored, not a substring match
  assert.equal(matchDomain('mailto:someone@open.spotify.com'), null)
  assert.equal(matchRule('https://www.ssense.com/x').rule.multiBrand, true)
  assert.equal(matchRule('https://www.sunspel.com/x').rule.multiBrand, undefined)
  assert.equal(normalizeHost('https://www.Example.TEST.:8443/x'), 'example.test')
  assert.equal(siteNameForHost('https://music.apple.com/no/album/x'), 'Apple Music')
})

test('classifyKind precedence: selection, then host, then structured data, then a bare photo', () => {
  const none = emptyMetadata()
  const product = meta({}, { jsonLd: [{ '@type': ['Thing', 'Product'] }] })
  const spotify = 'https://open.spotify.com/track/x'

  assert.equal(classifyKind({ sourceUrl: spotify, metadata: none, hasSelection: true, hasImage: true }).kind, 'quote')
  assert.deepEqual(classifyKind({ sourceUrl: spotify, metadata: product, hasSelection: false, hasImage: false }), {
    kind: 'music',
    confidence: 'high',
    reason: 'matched open.spotify.com',
  })
  // Only an unlisted host falls through to structured data; a product is a suggestion.
  assert.equal(classifyKind({ sourceUrl: 'https://shop.example.test/p', metadata: product, hasSelection: false, hasImage: false }).confidence, 'medium')
  assert.equal(classifyKind({ sourceUrl: null, metadata: meta({ 'og:type': 'product' }), hasSelection: false, hasImage: false }).kind, 'clothing')
  assert.equal(classifyKind({ sourceUrl: null, metadata: meta({ 'og:type': 'music.song' }), hasSelection: false, hasImage: false }).kind, 'music')
  assert.equal(classifyKind({ sourceUrl: null, metadata: meta({}, { jsonLd: [{ '@type': 'Painting' }] }), hasSelection: false, hasImage: false }).kind, 'art')
  assert.equal(classifyKind({ sourceUrl: null, metadata: meta({ 'og:type': 'article' }), hasSelection: false, hasImage: false }).kind, 'reference')
  // A photo that came from somewhere is not assumed to be art.
  assert.equal(classifyKind({ sourceUrl: 'https://example.test/', metadata: none, hasSelection: false, hasImage: true }).kind, null)
  assert.deepEqual(classifyKind({ sourceUrl: null, metadata: none, hasSelection: false, hasImage: false }), {
    kind: null,
    confidence: 'low',
    reason: 'unrecognized source',
  })
})

test('cleanTitle strips only a suffix it can match against the site, the host or the creator', () => {
  const apple = 'https://music.apple.com/no/album/rumours/1'
  assert.equal(cleanTitle(meta({ 'og:title': 'Rumours by Fleetwood Mac on Apple Music' }), apple, 'Fleetwood Mac'), 'Rumours')
  assert.equal(cleanTitle(meta({ 'og:title': 'Rumours on Apple Music', 'og:site_name': 'Apple Music - Web Player' }), apple, null), 'Rumours')
  assert.equal(cleanTitle(meta({ 'og:title': 'Funeral for Justice, by Mdou Moctar' }), 'https://mdoumoctar.bandcamp.com/album/x', 'Mdou Moctar'), 'Funeral for Justice')
  assert.equal(cleanTitle(meta({ 'og:title': 'Loopback Sweatshirt | Sunspel', 'og:site_name': 'Sunspel' }), 'https://www.sunspel.com/p', 'Sunspel'), 'Loopback Sweatshirt')
  assert.equal(cleanTitle(meta({ 'og:title': 'Loopback Sweatshirt | Sunspel' }), 'https://www.sunspel.com/p', null), 'Loopback Sweatshirt') // by bare host

  // Real titles survive.
  const spotify = 'https://open.spotify.com/album/x'
  assert.equal(cleanTitle(meta({ 'og:title': 'Blood on the Tracks', 'og:site_name': 'Spotify' }), spotify, 'Bob Dylan'), 'Blood on the Tracks')
  assert.equal(cleanTitle(meta({ 'og:title': 'Dreams - 2004 Remaster', 'og:site_name': 'Spotify' }), spotify, 'Fleetwood Mac'), 'Dreams - 2004 Remaster')
  // Never strips a title down to nothing.
  assert.equal(cleanTitle(meta({ 'og:title': 'Spotify', 'og:site_name': 'Spotify' }), spotify, null), 'Spotify')

  // <title> is the fallback when there is no og:title.
  assert.equal(cleanTitle(meta({}, { title: ' Plain &amp; Simple ' }), null, null), 'Plain & Simple')
  assert.equal(cleanTitle(emptyMetadata(), spotify, null), null)
})

test('inferCreator: the ladder, first usable rung wins, each with its provenance', () => {
  const guardian = 'https://www.theguardian.com/artanddesign/x'

  // 1: structured data beats everything below it.
  assert.deepEqual(
    inferCreator(meta({ author: 'Somebody Else' }, { jsonLd: [{ '@type': 'Article', author: [{ name: 'Dalya Alberge' }, { name: 'A. N. Other' }] }] }), guardian, 'reference', null),
    { value: 'Dalya Alberge, A. N. Other', source: 'JSON-LD Article.author' }
  )
  assert.equal(inferCreator(meta({}, { jsonLd: [{ '@type': 'VisualArtwork', creator: 'Johannes Vermeer' }] }), null, 'art', null).value, 'Johannes Vermeer')
  // 2: Open Graph music vertical.
  assert.deepEqual(inferCreator(meta({ 'music:musician': 'Fleetwood Mac' }), null, 'music', null), { value: 'Fleetwood Mac', source: 'og:music:musician' })
  // 3: plain author meta, a leading @ dropped.
  assert.deepEqual(inferCreator(meta({ 'twitter:creator': '@dalya' }), null, null, null), { value: 'dalya', source: 'page author metadata' })
  // 3b: a profile URL names the author in its path.
  assert.deepEqual(
    inferCreator(meta({ 'article:author': 'https://www.theguardian.com/profile/dalya-alberge' }), guardian, 'reference', null),
    { value: 'Dalya Alberge', source: 'author profile link' }
  )
  // 4: per-host extractors.
  assert.equal(inferCreator(meta({ 'og:title': 'Dreams', 'og:description': 'Song · Fleetwood Mac · 1977' }), 'https://open.spotify.com/track/x', 'music', null).value, 'Fleetwood Mac')
  assert.equal(inferCreator(meta({ 'og:title': 'Rumours by Fleetwood Mac on Apple Music' }), 'https://music.apple.com/album/x', 'music', null).value, 'Fleetwood Mac')
  assert.equal(inferCreator(emptyMetadata(), 'https://github.com/nuxt/nuxt', 'reference', null).value, 'nuxt')
  assert.equal(inferCreator(emptyMetadata(), 'https://medium.com/@someone/a-post-123', 'reference', null).value, 'someone')
  assert.equal(inferCreator(emptyMetadata(), 'https://www.instagram.com/p/Cabc123/', null, null), null) // a post, not a profile
  // 4b: a single-brand shop is the brand; a multi-brand retailer is nobody's label.
  assert.deepEqual(inferCreator(meta({ 'og:site_name': 'Sunspel' }), 'https://www.sunspel.com/p', 'clothing', null), { value: 'Sunspel', source: 'the retailer’s own name' })
  assert.equal(inferCreator(meta({ 'og:site_name': 'SSENSE' }), 'https://www.ssense.com/p', 'clothing', null), null)
  // 5: a trailing title segment, unless it is the site's own name.
  assert.equal(inferCreator(meta({ 'og:title': 'View of Delft — Johannes Vermeer' }), 'https://example.test/x', 'art', null).value, 'Johannes Vermeer')
  assert.equal(inferCreator(meta({ 'og:title': 'Lost Vermeer found | The Guardian', 'og:site_name': 'The Guardian' }), guardian, 'reference', null), null)
  assert.equal(inferCreator(meta({ 'og:title': 'Lost Vermeer found | The Guardian' }), guardian, 'reference', null), null) // by bare host
  // 6: the Share Sheet's own text.
  assert.deepEqual(inferCreator(emptyMetadata(), null, 'music', 'Dreams by Fleetwood Mac'), { value: 'Fleetwood Mac', source: 'shared text' })
  // 7: nothing is better than a guess.
  assert.equal(inferCreator(emptyMetadata(), 'https://example.test/', null, 'just a caption'), null)
})

test('normalizeCreator: cleaned, then rejected when it is not a name', () => {
  assert.equal(normalizeCreator('  by  Fleetwood&nbsp;Mac® ', 'music', null), 'Fleetwood Mac')
  assert.equal(normalizeCreator('Rick Astley - Topic', null, null), 'Rick Astley')
  assert.equal(normalizeCreator('Sunspel Ltd.', 'clothing', null), 'Sunspel')
  assert.equal(normalizeCreator('Norse Projects A/S', 'clothing', null), 'Norse Projects')
  assert.equal(normalizeCreator('Sunspel Ltd', 'reference', null), 'Sunspel Ltd') // legal suffixes only matter for brands
  assert.equal(normalizeCreator('https://example.test/author/x', null, null), null)
  assert.equal(normalizeCreator('x'.repeat(81), null, null), null)
  assert.equal(normalizeCreator('Rumours', 'music', ' rumours '), null) // the title is not its own creator
  assert.equal(normalizeCreator('', null, null), null)
  assert.equal(normalizeCreator(null, null, null), null)
})

test('small helpers', () => {
  assert.equal(humanizeSlug('mdou-moctar'), 'Mdou Moctar')
  assert.equal(humanizeSlug('user-20481'), null) // an id, not a name
  assert.equal(decodeEntities('Men&#39;s &amp; Women&#x27;s&nbsp;&lt;3 &unknown;'), "Men's & Women's <3 &unknown;")
  assert.equal(namesFrom([{ name: 'A' }, 'B', { name: 'C' }, 'D']), 'A, B, C') // at most three
  assert.equal(namesFrom({ url: 'https://example.test' }), null)
  const nodes = flattenJsonLd([{ '@graph': [{ '@type': 'WebPage', mainEntity: { '@type': 'Product' } }] }, [{ '@type': 'article' }], null, 'text'])
  assert.equal(nodesOfType(nodes, 'Product').length, 1)
  assert.equal(nodesOfType(nodes, 'Article').length, 1) // type names compare case-insensitively
  assert.deepEqual(metadataFromPage({ title: 7, meta: { 'OG:Title': 'T', bad: 1 }, jsonld: ['{"@type":"Product"}', '{broken', 5] }), {
    title: null,
    meta: { 'og:title': 'T' },
    jsonLd: [{ '@type': 'Product' }],
  })
})

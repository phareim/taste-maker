// POST /api/ingest/enrich: called by the iOS Share Extension (Bearer
// TASTE_IOS_KEY; ios/TasteCaptureKit/.../EnrichClient.swift) and by this
// app's own capture form (Reader session). It fetches pages and oEmbed
// endpoints chosen by the caller; every outbound call here is a stub and
// every page a hand-written fixture.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, EXTENSION_KEY, INGEST_KEY, IOS_KEY } from './helpers/app.mjs'
import { FakeHTMLRewriter } from './helpers/html-rewriter.mjs'

globalThis.HTMLRewriter = FakeHTMLRewriter

// EnrichResult in EnrichClient.swift decodes exactly these.
const RESULT_KEYS = ['kind', 'kind_confidence', 'kind_reason', 'title', 'creator', 'creator_source', 'image_url', 'source_url']

const html = (head) => new Response(`<!doctype html><html><head>${head}</head><body></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })

/** Stub the outbound fetch; `routes` maps a URL prefix to a response factory. */
function stubFetch(t, routes = {}) {
  return t.mock.method(globalThis, 'fetch', async (url) => {
    for (const [prefix, respond] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) return respond(String(url))
    }
    return new Response('not found', { status: 404 })
  })
}

const enrich = (app, json, auth = { bearer: IOS_KEY }) => app.request('POST', '/api/ingest/enrich', { ...auth, json })

test('enrich: the iOS key or an allowed Reader session, nothing else', async (t) => {
  stubFetch(t)
  const app = await createTestApp()
  assert.equal((await enrich(app, {}, {})).status, 401)
  assert.equal((await enrich(app, {}, { bearer: 'wrong' })).status, 401)
  assert.equal((await enrich(app, {}, { bearer: EXTENSION_KEY })).status, 401)
  assert.equal((await enrich(app, {}, { bearer: INGEST_KEY })).status, 401)
  assert.equal((await enrich(app, {}, { cookie: app.signIn('someone-else@example.test') })).status, 403)
  assert.equal((await enrich(app, {}, { bearer: IOS_KEY })).status, 200)
  assert.equal((await enrich(app, {}, { cookie: app.signIn() })).status, 200) // the web capture form

  // A Bearer header is judged as a Bearer: a valid session does not rescue a wrong key.
  assert.equal((await enrich(app, {}, { bearer: 'wrong', cookie: app.signIn() })).status, 401)

  const off = await createTestApp({ TASTE_IOS_KEY: undefined })
  assert.equal((await enrich(off, {}, { bearer: IOS_KEY })).status, 503)
  assert.equal((await enrich(off, {}, { cookie: off.signIn() })).status, 200) // the form does not need the iOS key
})

test('enrich: nothing to go on is a 200 with null fields, not an error', async (t) => {
  const fetchMock = stubFetch(t)
  const app = await createTestApp()
  const res = await enrich(app, {})
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body), RESULT_KEYS)
  assert.deepEqual(res.body, {
    kind: null,
    kind_confidence: 'low',
    kind_reason: 'unrecognized source',
    title: null,
    creator: null,
    creator_source: null,
    image_url: null,
    source_url: null,
  })
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('enrich: metadata the Share Extension scraped is used as is, with no outbound fetch', async (t) => {
  const fetchMock = stubFetch(t)
  const app = await createTestApp()
  const res = await enrich(app, {
    url: 'https://open.spotify.com/track/0ofHAoxe9vBkTCp2UQIavz',
    has_image: false,
    page: {
      title: 'Dreams - 2004 Remaster - song and lyrics by Fleetwood Mac | Spotify',
      url: 'https://open.spotify.com/track/0ofHAoxe9vBkTCp2UQIavz',
      meta: {
        'og:title': 'Dreams - 2004 Remaster',
        'og:description': 'Fleetwood Mac · Rumours · Song · 1977',
        'og:image': 'https://i.scdn.co/image/cover',
        'og:site_name': 'Spotify',
      },
      jsonld: [],
    },
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, {
    kind: 'music',
    kind_confidence: 'high',
    kind_reason: 'matched open.spotify.com',
    title: 'Dreams - 2004 Remaster',
    creator: 'Fleetwood Mac',
    creator_source: 'matched open.spotify.com',
    image_url: 'https://i.scdn.co/image/cover',
    source_url: 'https://open.spotify.com/track/0ofHAoxe9vBkTCp2UQIavz',
  })
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('enrich: a text selection is a quote, even on a music host', async (t) => {
  stubFetch(t)
  const app = await createTestApp()
  const res = await enrich(app, { page: { url: 'https://open.spotify.com/track/x', selection: 'Thunder only happens when it\'s raining', meta: {} } })
  assert.equal(res.body.kind, 'quote')
  assert.equal(res.body.kind_confidence, 'high')
  assert.equal(res.body.kind_reason, 'you selected text')
  assert.equal(res.body.source_url, 'https://open.spotify.com/track/x') // page.url stands in for url
})

test('enrich: a product page on an unlisted shop is a clothing suggestion, brand from JSON-LD', async (t) => {
  stubFetch(t)
  const app = await createTestApp()
  const res = await enrich(app, {
    url: 'https://shop.example.test/p/1',
    page: {
      title: 'Loopback Sweatshirt',
      meta: { 'og:title': 'Men&#39;s Loopback Sweatshirt' },
      jsonld: ['{not json', JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Product', name: 'Loopback Sweatshirt', brand: { '@type': 'Brand', name: 'Sunspel Ltd' } }] })],
    },
  })
  assert.equal(res.body.kind, 'clothing')
  assert.equal(res.body.kind_confidence, 'medium') // a suggestion: the user still picks
  assert.equal(res.body.creator, 'Sunspel') // legal suffix dropped
  assert.equal(res.body.creator_source, 'JSON-LD Product.brand')
  assert.equal(res.body.title, "Men's Loopback Sweatshirt") // entity decoded
})

test('enrich: a bare photo is an art suggestion; shared text can name the creator', async (t) => {
  stubFetch(t)
  const app = await createTestApp()
  const photo = await enrich(app, { has_image: true })
  assert.equal(photo.body.kind, 'art')
  assert.equal(photo.body.kind_confidence, 'medium')
  assert.equal(photo.body.kind_reason, 'shared a photo')

  const text = await enrich(app, { url: 'https://unknown.example.test/x', shared_text: 'Dreams by Fleetwood Mac' })
  assert.equal(text.body.kind, null)
  assert.equal(text.body.creator, 'Fleetwood Mac')
  assert.equal(text.body.creator_source, 'shared text')
})

test('enrich: a pasted link is fetched as a crawler and read from its head', async (t) => {
  const fetchMock = stubFetch(t, {
    'https://www.theguardian.com/': () =>
      html(`
        <title>Lost Vermeer found | Art | The Guardian</title>
        <meta property="og:title" content="Lost Vermeer found | The Guardian">
        <meta property="og:type" content="article">
        <meta property="og:site_name" content="The Guardian">
        <meta property="og:image" content="https://i.guim.co.uk/vermeer.jpg">
        <meta property="article:author" content="https://www.theguardian.com/profile/dalya-alberge">
      `),
  })
  const app = await createTestApp()
  const res = await enrich(app, { url: ' https://www.theguardian.com/artanddesign/2026/vermeer ' }, { cookie: app.signIn() })
  assert.deepEqual(res.body, {
    kind: 'reference',
    kind_confidence: 'high',
    kind_reason: 'looks like an article',
    title: 'Lost Vermeer found',
    creator: 'Dalya Alberge',
    creator_source: 'author profile link',
    image_url: 'https://i.guim.co.uk/vermeer.jpg',
    source_url: 'https://www.theguardian.com/artanddesign/2026/vermeer',
  })
  assert.equal(fetchMock.mock.callCount(), 1)
  const [url, init] = fetchMock.mock.calls[0].arguments
  assert.equal(url, 'https://www.theguardian.com/artanddesign/2026/vermeer')
  assert.match(init.headers['User-Agent'], /compatible; taste-maker\//)
})

test('enrich: JSON-LD in a fetched page is read too', async (t) => {
  stubFetch(t, {
    'https://records.example.test/': () =>
      html(`
        <title>Funeral for Justice</title>
        <script type="application/ld+json">${JSON.stringify({ '@type': 'MusicAlbum', name: 'Funeral for Justice', byArtist: { '@type': 'MusicGroup', name: 'Mdou Moctar' } })}</script>
      `),
  })
  const app = await createTestApp()
  const res = await enrich(app, { url: 'https://records.example.test/album/1' })
  assert.equal(res.body.kind, 'music')
  assert.equal(res.body.kind_reason, 'page says it is music')
  assert.equal(res.body.title, 'Funeral for Justice')
  assert.equal(res.body.creator, 'Mdou Moctar')
  assert.equal(res.body.creator_source, 'JSON-LD MusicRecording.byArtist') // the caption names the rung, not the node's own type
})

test('enrich: a page that cannot be read still routes by its host', async (t) => {
  const failures = {
    'a network error': () => {
      throw new TypeError('fetch failed')
    },
    'a 404': () => new Response('gone', { status: 404 }),
    'not HTML': () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    'a declared length far past the cap': () => new Response('x', { headers: { 'content-type': 'text/html', 'content-length': String(8 * 512 * 1024 + 1) } }),
  }
  for (const [what, respond] of Object.entries(failures)) {
    const mock = stubFetch(t, { 'https://mdou-moctar.bandcamp.com/': respond })
    const app = await createTestApp()
    const res = await enrich(app, { url: 'https://mdou-moctar.bandcamp.com/album/funeral-for-justice' })
    assert.equal(res.status, 200, what)
    assert.equal(res.body.kind, 'music', what)
    assert.equal(res.body.kind_reason, 'matched mdou-moctar.bandcamp.com', what)
    assert.equal(res.body.creator, 'Mdou Moctar', what) // the artist subdomain
    assert.equal(res.body.title, null, what)
    mock.mock.restore()
  }
})

test('enrich never fetches a local or private address, or anything that is not http(s)', async (t) => {
  const fetchMock = stubFetch(t)
  const app = await createTestApp()
  for (const url of [
    'http://localhost:8787/admin',
    'http://dev.localhost/',
    'http://service.internal/',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://172.16.4.4/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://2130706433/', // 127.0.0.1 as one number
    'ftp://example.test/file',
    'file:///etc/passwd',
    'not a url',
  ]) {
    const res = await enrich(app, { url })
    assert.equal(res.status, 200, url)
    assert.equal(res.body.kind, null, url)
    assert.equal(res.body.source_url, url, url)
  }
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('enrich: YouTube falls back to oEmbed for the creator', async (t) => {
  const fetchMock = stubFetch(t, {
    'https://www.youtube.com/watch': () => html('<title>Never Gonna Give You Up - YouTube</title><meta property="og:title" content="Never Gonna Give You Up">'),
    // Hand-written from the oEmbed fields the code reads: author_name, title.
    'https://www.youtube.com/oembed': () =>
      new Response(JSON.stringify({ title: 'Never Gonna Give You Up', author_name: 'Rick Astley - Topic', type: 'video', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' }), {
        headers: { 'content-type': 'application/json' },
      }),
  })
  const app = await createTestApp()
  const res = await enrich(app, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
  assert.equal(res.body.creator, 'Rick Astley')
  assert.equal(res.body.creator_source, 'oEmbed author')
  assert.equal(res.body.title, 'Never Gonna Give You Up')
  assert.equal(
    fetchMock.mock.calls[1].arguments[0],
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')}`
  )
})

test('enrich: a failing oEmbed lookup just leaves the creator empty', async (t) => {
  stubFetch(t, {
    'https://vimeo.com/api/oembed.json': () => new Response('nope', { status: 500 }),
  })
  const app = await createTestApp()
  const res = await enrich(app, { url: 'https://vimeo.com/123456' })
  assert.equal(res.status, 200)
  assert.equal(res.body.creator, null)
  assert.equal(res.body.creator_source, null)
})

test('enrich: one malformed character reference does not cost the whole answer', async (t) => {
  stubFetch(t)
  const app = await createTestApp()
  const res = await enrich(app, {
    url: 'https://open.spotify.com/track/x',
    page: { meta: { 'og:title': 'Caf&#9999999999; Song &#x110000; &#233;', 'og:description': 'Some Artist · Song' } },
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.kind, 'music') // was null: the RangeError blanked every field
  assert.equal(res.body.creator, 'Some Artist')
  assert.equal(res.body.title, 'Caf&#9999999999; Song &#x110000; é') // the bad references stay as written
})

// The two clients that cannot be redeployed from here: the Chrome extension
// (extension/popup.js) and the iOS Share Extension (ios/TasteCaptureKit).
// Shapes and status codes are the ones those clients are written against:
// CaptureClient.swift maps 400/401/413/503, popup.js reads 401 and res.ok.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, INGEST_KEY, EXTENSION_KEY, IOS_KEY } from './helpers/app.mjs'

const ITEM_KEYS = [
  'id', 'kind', 'title', 'body', 'source_url', 'creator', 'note', 'image_url',
  'status', 'wins', 'losses', 'promoted_via', 'created_at', 'updated_at',
]
const EXTENSION_ORIGIN = 'chrome-extension://odjnpodgcgeofokemcjnnokedkdikcan'

const capture = {
  kind: 'art',
  body: 'A painting',
  title: 'View of Delft',
  source_url: 'https://example.test/delft',
  creator: 'Vermeer',
  note: 'the light',
  image_url: 'https://example.test/delft.jpg',
}

function assertCors(res) {
  assert.equal(res.headers.get('access-control-allow-origin'), EXTENSION_ORIGIN)
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS')
  assert.equal(res.headers.get('access-control-allow-headers'), 'Authorization, Content-Type')
}

test('OPTIONS /api/ingest/capture answers the preflight without a key', async () => {
  const app = await createTestApp()
  const res = await app.request('OPTIONS', '/api/ingest/capture', {
    headers: { origin: EXTENSION_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
  })
  assert.equal(res.status, 204)
  assertCors(res)
})

test('POST /api/ingest/capture: the extension key creates an item and returns the bare row', async () => {
  const app = await createTestApp()
  const res = await app.request('POST', '/api/ingest/capture', { bearer: EXTENSION_KEY, json: capture })
  assert.equal(res.status, 200)
  assertCors(res)
  assert.deepEqual(Object.keys(res.body), ITEM_KEYS) // the row itself, not a wrapper
  assert.deepEqual(
    { kind: res.body.kind, body: res.body.body, title: res.body.title, source_url: res.body.source_url, creator: res.body.creator, note: res.body.note, image_url: res.body.image_url },
    capture
  )
  assert.equal(res.body.status, 'captured')
  assert.equal(app.item(res.body.id).external_ref, null)
})

test('POST /api/ingest/capture: the iOS key opens the same door', async () => {
  const app = await createTestApp()
  const res = await app.request('POST', '/api/ingest/capture', { bearer: IOS_KEY, json: { kind: 'music', body: 'Dreams' } })
  assert.equal(res.status, 200)
  assert.equal(res.body.kind, 'music')
  assert.equal(res.body.title, null)
})

test('POST /api/ingest/capture: each key works alone, so either can be rotated', async () => {
  const onlyIos = await createTestApp({ TASTE_EXTENSION_KEY: undefined })
  assert.equal((await onlyIos.request('POST', '/api/ingest/capture', { bearer: IOS_KEY, json: capture })).status, 200)
  assert.equal((await onlyIos.request('POST', '/api/ingest/capture', { bearer: EXTENSION_KEY, json: capture })).status, 401)
  const onlyExtension = await createTestApp({ TASTE_IOS_KEY: undefined })
  assert.equal((await onlyExtension.request('POST', '/api/ingest/capture', { bearer: EXTENSION_KEY, json: capture })).status, 200)
})

test('POST /api/ingest/capture: 401 (with CORS headers) for no key, a wrong key, Reader\'s key or a session', async () => {
  const app = await createTestApp()
  const attempts = [{}, { bearer: 'wrong' }, { bearer: INGEST_KEY }, { cookie: app.signIn() }, { headers: { authorization: EXTENSION_KEY } }]
  for (const auth of attempts) {
    const res = await app.request('POST', '/api/ingest/capture', { ...auth, json: capture })
    assert.equal(res.status, 401, JSON.stringify(auth))
    assertCors(res) // or the popup could not read the status
  }
  assert.equal(app.tasteDb.rows('SELECT COUNT(*) AS n FROM taste_item')[0].n, 0)
})

test('POST /api/ingest/capture: 503 while neither client key is set', async () => {
  const app = await createTestApp({ TASTE_EXTENSION_KEY: undefined, TASTE_IOS_KEY: undefined })
  const res = await app.request('POST', '/api/ingest/capture', { bearer: EXTENSION_KEY, json: capture })
  assert.equal(res.status, 503)
})

test('POST /api/ingest/capture: 400 for an unknown kind or an empty body', async () => {
  const app = await createTestApp()
  for (const json of [{ kind: 'film', body: 'x' }, { kind: 'quote', body: '  ' }, { kind: 'quote' }, {}]) {
    const res = await app.request('POST', '/api/ingest/capture', { bearer: EXTENSION_KEY, json })
    assert.equal(res.status, 400, JSON.stringify(json))
  }
})

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

test('POST /api/ingest/capture-image stores the bytes and returns 201 { url }', async () => {
  const app = await createTestApp()
  const res = await app.request('POST', '/api/ingest/capture-image', { bearer: IOS_KEY, body: jpeg, headers: { 'content-type': 'image/jpeg' } })
  assert.equal(res.status, 201)
  assert.deepEqual(Object.keys(res.body), ['url'])
  const m = res.body.url.match(/^https:\/\/taste\.phareim\.no\/api\/images\/([0-9a-f-]{36}\.jpg)$/)
  assert.ok(m, res.body.url)
  const stored = app.bucket.objects.get(m[1])
  assert.deepEqual(stored.bytes, jpeg)
  assert.deepEqual(stored.httpMetadata, { contentType: 'image/jpeg' })

  // ...and that URL serves the same bytes back, with no auth at all.
  const served = await app.request('GET', new URL(res.body.url).pathname)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/jpeg')
  assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.ok(served.headers.get('etag'))
  assert.deepEqual(served.bytes, jpeg)
})

test('POST /api/ingest/capture-image: the extension by content type', async () => {
  const app = await createTestApp()
  for (const [type, ext] of [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/heic', 'heic'], ['image/webp', 'webp'], ['image/png; charset=binary', 'png']]) {
    const res = await app.request('POST', '/api/ingest/capture-image', { bearer: IOS_KEY, body: jpeg, headers: { 'content-type': type } })
    assert.equal(res.status, 201, type)
    assert.ok(res.body.url.endsWith(`.${ext}`), `${type} -> ${res.body.url}`)
  }
})

test('POST /api/ingest/capture-image: only the iOS key, 503 while it is unset', async () => {
  const app = await createTestApp()
  const send = (auth) => app.request('POST', '/api/ingest/capture-image', { ...auth, body: jpeg, headers: { 'content-type': 'image/jpeg', ...auth.headers } })
  assert.equal((await send({})).status, 401)
  assert.equal((await send({ bearer: EXTENSION_KEY })).status, 401)
  assert.equal((await send({ bearer: INGEST_KEY })).status, 401)
  assert.equal((await send({ cookie: app.signIn() })).status, 401)
  assert.equal(app.bucket.objects.size, 0)

  const off = await createTestApp({ TASTE_IOS_KEY: undefined })
  const res = await off.request('POST', '/api/ingest/capture-image', { bearer: IOS_KEY, body: jpeg, headers: { 'content-type': 'image/jpeg' } })
  assert.equal(res.status, 503)
})

test('POST /api/ingest/capture-image: 400 for another type or no bytes, 413 over 8 MB', async () => {
  const app = await createTestApp()
  const send = (body, headers) => app.request('POST', '/api/ingest/capture-image', { bearer: IOS_KEY, body, headers })
  assert.equal((await send(jpeg, { 'content-type': 'image/gif' })).status, 400)
  assert.equal((await send(jpeg, { 'content-type': 'application/json' })).status, 400)
  assert.equal((await send(new Uint8Array(0), { 'content-type': 'image/jpeg' })).status, 400)
  // The declared length alone is enough...
  assert.equal((await send(jpeg, { 'content-type': 'image/jpeg', 'content-length': String(8 * 1024 * 1024 + 1) })).status, 413)
  // ...and so are the actual bytes.
  assert.equal((await send(new Uint8Array(8 * 1024 * 1024 + 1), { 'content-type': 'image/jpeg' })).status, 413)
  assert.equal((await send(new Uint8Array(8 * 1024 * 1024), { 'content-type': 'image/jpeg' })).status, 201)
  assert.equal(app.bucket.objects.size, 1)
})

test('GET /api/images/[key]: 404 for a key the upload route could not have minted, or one that is not stored', async () => {
  const app = await createTestApp()
  await app.bucket.put('secret.txt', new Uint8Array([1]), {})
  for (const key of ['secret.txt', 'x.jpg', '..%2Fsecret.txt', '00000000-0000-0000-0000-000000000000.gif', '00000000-0000-0000-0000-000000000000.jpg']) {
    assert.equal((await app.request('GET', `/api/images/${key}`)).status, 404, key)
  }
})

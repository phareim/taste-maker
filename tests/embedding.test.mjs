// The NVIDIA NIM seam (server/utils/embedding.ts). The response here is
// hand-written from the shape the code reads (data[0].embedding); no test
// calls the live service.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp } from './helpers/app.mjs'

const { embedText, cosine } = await import('~/server/utils/embedding')

const nimResponse = (embedding) =>
  new Response(JSON.stringify({ object: 'list', data: [{ index: 0, object: 'embedding', embedding }], model: 'nvidia/nv-embedqa-e5-v5' }), {
    headers: { 'content-type': 'application/json' },
  })

test('embedText: no key means no call and no vector', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => nimResponse([1]))
  assert.equal(await embedText({}, 'text'), null)
  assert.equal(await embedText(undefined, 'text'), null)
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('embedText posts one passage to NIM with the Bearer key and returns the vector', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => nimResponse([0.1, 0.2, 0.3]))
  assert.deepEqual(await embedText({ NVIDIA_API_KEY: 'nim-key' }, 'x'.repeat(9000)), [0.1, 0.2, 0.3])

  const [url, init] = fetchMock.mock.calls[0].arguments
  assert.equal(url, 'https://integrate.api.nvidia.com/v1/embeddings')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.Authorization, 'Bearer nim-key')
  const sent = JSON.parse(init.body)
  assert.equal(sent.model, 'nvidia/nv-embedqa-e5-v5')
  assert.equal(sent.input_type, 'passage')
  assert.equal(sent.truncate, 'END')
  assert.equal(sent.input.length, 1)
  assert.equal(sent.input[0].length, 8000) // capped before sending
})

test('embedText returns null, and never throws, when NIM fails', async (t) => {
  t.mock.method(console, 'error', () => {})
  const failures = {
    'a non-2xx answer': async () => new Response('rate limited', { status: 429 }),
    'an unexpected shape': async () => new Response(JSON.stringify({ data: [] })),
    'an empty vector': async () => nimResponse([]),
    'a body that is not JSON': async () => new Response('<html>'),
    'a network error': async () => {
      throw new TypeError('fetch failed')
    },
  }
  for (const [what, impl] of Object.entries(failures)) {
    const mock = t.mock.method(globalThis, 'fetch', impl)
    assert.equal(await embedText({ NVIDIA_API_KEY: 'nim-key' }, 'text'), null, what)
    mock.mock.restore()
  }
})

test('a write stores the vector as JSON, embedding title, creator, body and note together', async (t) => {
  const app = await createTestApp({ NVIDIA_API_KEY: 'nim-key' })
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => nimResponse([0.25, 0.75]))
  const res = await app.request('POST', '/api/items', {
    cookie: app.signIn(),
    json: { kind: 'music', body: 'Dreams', title: 'Rumours', creator: 'Fleetwood Mac', note: 'that bassline' },
  })
  assert.equal(res.status, 200)
  assert.ok(!('embedding' in res.body))
  assert.equal(app.item(res.body.id).embedding, '[0.25,0.75]')
  assert.deepEqual(JSON.parse(fetchMock.mock.calls[0].arguments[1].body).input, ['Rumours — Fleetwood Mac — Dreams — that bassline'])
})

test('a write still succeeds, without a vector, when NIM is down', async (t) => {
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async () => new Response('down', { status: 503 }))
  for (const [route, auth, json] of [
    ['/api/items', (app) => ({ cookie: app.signIn() }), { kind: 'quote', body: 'q' }],
    ['/api/ingest/capture', () => ({ bearer: 'extension-key-for-tests' }), { kind: 'quote', body: 'q' }],
    ['/api/ingest/highlight', () => ({ bearer: 'ingest-key-for-tests' }), { highlight_id: 1, quote: 'q' }],
  ]) {
    const app = await createTestApp({ NVIDIA_API_KEY: 'nim-key' })
    const res = await app.request('POST', route, { ...auth(app), json })
    assert.equal(res.status, 200, route)
    const id = res.body.id ?? res.body.item.id
    assert.equal(app.item(id).embedding, null, route)
  }
})

test('POST /api/items/reembed fills missing vectors, 25 per call, oldest first, and answers { embedded, left }', async (t) => {
  const app = await createTestApp({ NVIDIA_API_KEY: 'nim-key' })
  const cookie = app.signIn()
  const kept = app.seedItem({ body: 'already has one', embedding: [9, 9] })
  const first = app.seedItem({ title: 'Rumours', creator: 'Fleetwood Mac', body: 'Dreams', note: 'that bassline' })
  for (let i = 0; i < 29; i++) app.seedItem()
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => nimResponse([0.25, 0.75]))

  const res = await app.request('POST', '/api/items/reembed', { cookie })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { embedded: 25, left: 5 })
  assert.equal(fetchMock.mock.callCount(), 25)
  assert.deepEqual(JSON.parse(fetchMock.mock.calls[0].arguments[1].body).input, ['Rumours — Fleetwood Mac — Dreams — that bassline'])
  assert.equal(app.item(first).embedding, '[0.25,0.75]')
  assert.equal(app.item(kept).embedding, '[9,9]') // an existing vector is never touched

  assert.deepEqual((await app.request('POST', '/api/items/reembed', { cookie })).body, { embedded: 5, left: 0 })
  assert.deepEqual((await app.request('POST', '/api/items/reembed', { cookie })).body, { embedded: 0, left: 0 })

  // The Related panel now has neighbours for an item captured while NIM was down.
  const related = await app.request('GET', `/api/items/${first}/related`, { cookie })
  assert.equal(related.body.length, 5)
})

test('POST /api/items/reembed stops at the first NIM failure and leaves the rest for later', async (t) => {
  t.mock.method(console, 'error', () => {})
  const app = await createTestApp({ NVIDIA_API_KEY: 'nim-key' })
  for (let i = 0; i < 4; i++) app.seedItem()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => (++calls === 1 ? nimResponse([1, 0]) : new Response('down', { status: 503 })))
  const res = await app.request('POST', '/api/items/reembed', { cookie: app.signIn() })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { embedded: 1, left: 3 })
  assert.equal(calls, 2)

  const noKey = await createTestApp()
  noKey.seedItem()
  assert.deepEqual((await noKey.request('POST', '/api/items/reembed', { cookie: noKey.signIn() })).body, { embedded: 0, left: 1 })
})

test('cosine: 1 for the same direction, 0 for orthogonal and for a zero vector', () => {
  assert.equal(cosine([1, 2, 3], [2, 4, 6]), 1)
  assert.equal(cosine([1, 0], [0, 1]), 0)
  assert.equal(cosine([0, 0], [1, 1]), 0)
  assert.ok(Math.abs(cosine([1, 0], [-1, 0]) + 1) < 1e-12)
})

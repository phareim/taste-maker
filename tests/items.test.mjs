// The library's own API: /api/items and /api/items/[id]. These are also the
// routes other systems read with the visitor's Reader session cookie, so the
// row shape is pinned here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp } from './helpers/app.mjs'

// server/utils/tasteDb.ts ITEM_COLUMNS: the item row as every route returns it.
const ITEM_KEYS = [
  'id', 'kind', 'title', 'body', 'source_url', 'creator', 'note', 'image_url',
  'status', 'wins', 'losses', 'promoted_via', 'created_at', 'updated_at',
]

test('POST /api/items creates a captured item and returns the bare row', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const res = await app.request('POST', '/api/items', {
    cookie,
    json: { kind: 'reference', body: '  A film  ', title: ' Stalker ', source_url: 'https://example.test/s', creator: 'Tarkovsky', note: '', image_url: '   ' },
  })
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body), ITEM_KEYS)
  assert.equal(res.body.body, 'A film') // trimmed
  assert.equal(res.body.title, 'Stalker')
  assert.equal(res.body.note, null) // empty strings become NULL
  assert.equal(res.body.image_url, null)
  assert.equal(res.body.status, 'captured')
  assert.equal(res.body.wins, 0)
  assert.equal(res.body.promoted_via, null)
  assert.equal(app.item(res.body.id).embedding, null) // no NVIDIA_API_KEY: saved without a vector
})

test('POST /api/items rejects an unknown kind and an empty body with 400', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  for (const json of [{ kind: 'film', body: 'x' }, { kind: 'quote', body: '   ' }, { kind: 'quote' }, { body: 'x' }, { kind: 'quote', body: 42 }]) {
    const res = await app.request('POST', '/api/items', { cookie, json })
    assert.equal(res.status, 400, JSON.stringify(json))
  }
  assert.equal(app.tasteDb.rows('SELECT COUNT(*) AS n FROM taste_item')[0].n, 0)
})

test('POST /api/items accepts every kind in the closed set', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  for (const kind of ['quote', 'reference', 'music', 'art', 'clothing']) {
    const res = await app.request('POST', '/api/items', { cookie, json: { kind, body: kind } })
    assert.equal(res.status, 200, kind)
    assert.equal(res.body.kind, kind)
  }
})

test('GET /api/items lists newest first and never returns the embedding', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const first = app.seedItem({ body: 'first', embedding: [1, 0] })
  const second = app.seedItem({ body: 'second' })
  const res = await app.request('GET', '/api/items', { cookie })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.map((i) => i.id), [second, first])
  for (const row of res.body) assert.deepEqual(Object.keys(row), ITEM_KEYS)
})

test('GET /api/items filters by kind, status and q (title, body, creator, note)', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const quote = app.seedItem({ kind: 'quote', body: 'the sea, the sea' })
  const song = app.seedItem({ kind: 'music', body: 'Dreams', creator: 'Fleetwood Mac', status: 'canon' })
  const coat = app.seedItem({ kind: 'clothing', body: 'A coat', title: 'Overcoat', note: 'like the sea' })
  const ids = async (query) => (await app.request('GET', `/api/items?${query}`, { cookie })).body.map((i) => i.id)

  assert.deepEqual(await ids('kind=music'), [song])
  assert.deepEqual(await ids('status=canon'), [song])
  assert.deepEqual(await ids('status=captured'), [coat, quote])
  assert.deepEqual(await ids('q=sea'), [coat, quote])
  assert.deepEqual(await ids('q=fleetwood'), [song])
  assert.deepEqual(await ids('q=overcoat'), [coat])
  assert.deepEqual(await ids('q=sea&kind=quote'), [quote])
  assert.deepEqual(await ids('kind=nonsense'), [])
})

test('GET /api/items: % and _ in a search are the characters themselves, not wildcards', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const percent = app.seedItem({ body: 'give it 100% every night' })
  const snake = app.seedItem({ body: 'the snake_case years' })
  app.seedItem({ body: 'nothing special here' })
  const ids = async (q) => (await app.request('GET', `/api/items?q=${encodeURIComponent(q)}`, { cookie })).body.map((i) => i.id)

  assert.deepEqual(await ids('%'), [percent])
  assert.deepEqual(await ids('100%'), [percent])
  assert.deepEqual(await ids('_'), [snake])
  assert.deepEqual(await ids('snake_case'), [snake])
  assert.deepEqual(await ids('snakeXcase'), [])
  assert.deepEqual(await ids('\\'), [])
})

test('GET /api/items/[id] returns { item, connections } with the other endpoint resolved', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const a = app.seedItem({ body: 'a', embedding: [1, 0] })
  const b = app.seedItem({ body: 'b' })
  await app.request('POST', '/api/connections', { cookie, json: { from_id: a, to_id: b, note: 'why' } })

  for (const [self, other] of [[a, b], [b, a]]) {
    const res = await app.request('GET', `/api/items/${self}`, { cookie })
    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body), ['item', 'connections'])
    assert.deepEqual(Object.keys(res.body.item), ITEM_KEYS)
    assert.equal(res.body.connections.length, 1)
    assert.deepEqual(Object.keys(res.body.connections[0]), ['id', 'note', 'created_at', 'other'])
    assert.equal(res.body.connections[0].note, 'why')
    assert.equal(res.body.connections[0].other.id, other)
    assert.deepEqual(Object.keys(res.body.connections[0].other), ITEM_KEYS)
  }
})

test('GET /api/items/[id] is 404 for an unknown id', async () => {
  const app = await createTestApp()
  const res = await app.request('GET', '/api/items/nope', { cookie: app.signIn() })
  assert.equal(res.status, 404)
})

test('PATCH status: entering canon marks it manual, leaving canon clears the mark', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const id = app.seedItem({ body: 'x' })

  const up = await app.request('PATCH', `/api/items/${id}`, { cookie, json: { status: 'canon' } })
  assert.equal(up.status, 200)
  assert.deepEqual(Object.keys(up.body), ITEM_KEYS)
  assert.equal(up.body.status, 'canon')
  assert.equal(up.body.promoted_via, 'manual')
  assert.equal(up.body.body, 'x') // untouched fields keep their value

  const down = await app.request('PATCH', `/api/items/${id}`, { cookie, json: { status: 'captured' } })
  assert.equal(down.body.status, 'captured')
  assert.equal(down.body.promoted_via, null)
})

test('PATCH keeps a refine-earned promotion mark when other fields change', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const id = app.seedItem({ status: 'canon', promoted_via: 'refine', wins: 3 })
  const res = await app.request('PATCH', `/api/items/${id}`, { cookie, json: { note: 'still earned' } })
  assert.equal(res.body.promoted_via, 'refine')
  assert.equal(res.body.note, 'still earned')
})

test('PATCH: a status-only change keeps the stored embedding, a text change recomputes it', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const id = app.seedItem({ body: 'x', embedding: [0.5, 0.5] })

  await app.request('PATCH', `/api/items/${id}`, { cookie, json: { status: 'archived' } })
  assert.equal(app.item(id).embedding, '[0.5,0.5]')

  // No NVIDIA_API_KEY here, so the recompute yields no vector: the stale one
  // for the old text must not survive.
  await app.request('PATCH', `/api/items/${id}`, { cookie, json: { body: 'entirely different' } })
  assert.equal(app.item(id).embedding, null)
})

test('PATCH rejects an invalid status and an emptied body with 400, 404 for an unknown id', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const id = app.seedItem({ body: 'keep me' })
  assert.equal((await app.request('PATCH', `/api/items/${id}`, { cookie, json: { status: 'loved' } })).status, 400)
  assert.equal((await app.request('PATCH', `/api/items/${id}`, { cookie, json: { body: '   ' } })).status, 400)
  assert.equal((await app.request('PATCH', '/api/items/nope', { cookie, json: { status: 'canon' } })).status, 404)
  assert.equal(app.item(id).body, 'keep me')
})

test('PATCH body: null is rejected, not stored as the text "null"', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const id = app.seedItem({ body: 'keep me' })
  const res = await app.request('PATCH', `/api/items/${id}`, { cookie, json: { body: null } })
  assert.equal(res.status, 400)
  assert.equal(app.item(id).body, 'keep me')
})

test('DELETE /api/items/[id] removes the item and its connections', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const a = app.seedItem()
  const b = app.seedItem()
  await app.request('POST', '/api/connections', { cookie, json: { from_id: a, to_id: b } })

  const res = await app.request('DELETE', `/api/items/${a}`, { cookie })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { ok: true })
  assert.equal(app.item(a), null)
  assert.equal(app.tasteDb.rows('SELECT COUNT(*) AS n FROM connection')[0].n, 0)
  assert.notEqual(app.item(b), null)
})

test('GET /api/items/[id]/related: top five by cosine similarity, without vectors', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const target = app.seedItem({ embedding: [1, 0] })
  const near = app.seedItem({ embedding: [0.9, 0.1] })
  const far = app.seedItem({ embedding: [0, 1] })
  app.seedItem({ embedding: null }) // no vector: never a neighbour
  for (let i = 0; i < 5; i++) app.seedItem({ embedding: [0.5, 0.5] })

  const res = await app.request('GET', `/api/items/${target}/related`, { cookie })
  assert.equal(res.status, 200)
  assert.equal(res.body.length, 5)
  assert.equal(res.body[0].id, near)
  assert.deepEqual(Object.keys(res.body[0]), [...ITEM_KEYS, 'similarity'])
  assert.equal(res.body[0].similarity, 0.994)
  assert.ok(!res.body.some((r) => r.id === far || r.id === target))
})

test('GET /api/items/[id]/related: [] when the item has no embedding, 404 when it does not exist', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const id = app.seedItem({ embedding: null })
  app.seedItem({ embedding: [1, 0] })
  const res = await app.request('GET', `/api/items/${id}/related`, { cookie })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, [])
  assert.equal((await app.request('GET', '/api/items/nope/related', { cookie })).status, 404)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp } from './helpers/app.mjs'

test('POST /api/connections stores one edge per pair, whichever way it is drawn', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const a = app.seedItem()
  const b = app.seedItem()

  const first = await app.request('POST', '/api/connections', { cookie, json: { from_id: a, to_id: b, note: ' first ' } })
  assert.equal(first.status, 200)
  assert.deepEqual(Object.keys(first.body), ['id', 'from_id', 'to_id', 'note', 'created_at'])
  assert.equal(first.body.note, 'first')

  const again = await app.request('POST', '/api/connections', { cookie, json: { from_id: b, to_id: a, note: 'second' } })
  assert.equal(again.status, 200)
  assert.equal(again.body.id, first.body.id) // the existing edge, not a duplicate
  assert.equal(again.body.note, 'first')
  assert.equal(app.tasteDb.rows('SELECT COUNT(*) AS n FROM connection')[0].n, 1)

  const list = await app.request('GET', '/api/connections', { cookie })
  assert.equal(list.status, 200)
  assert.deepEqual(list.body, [first.body])
})

test('POST /api/connections: 400 when an id is missing or both are the same', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const a = app.seedItem()
  for (const json of [{}, { from_id: a }, { to_id: a }, { from_id: a, to_id: a }, { from_id: 1, to_id: 2 }]) {
    assert.equal((await app.request('POST', '/api/connections', { cookie, json })).status, 400, JSON.stringify(json))
  }
})

test('POST /api/connections: 404 when an endpoint does not exist, and no edge is stored', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const a = app.seedItem()
  for (const json of [{ from_id: a, to_id: 'gone' }, { from_id: 'gone', to_id: a }]) {
    const res = await app.request('POST', '/api/connections', { cookie, json })
    assert.equal(res.status, 404, JSON.stringify(json))
  }
  assert.equal(app.tasteDb.rows('SELECT COUNT(*) AS n FROM connection')[0].n, 0)
})

test('DELETE /api/connections/[id] removes the edge and is quiet about an unknown id', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const a = app.seedItem()
  const b = app.seedItem()
  const edge = (await app.request('POST', '/api/connections', { cookie, json: { from_id: a, to_id: b } })).body

  const res = await app.request('DELETE', `/api/connections/${edge.id}`, { cookie })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { ok: true })
  assert.equal(app.tasteDb.rows('SELECT COUNT(*) AS n FROM connection')[0].n, 0)
  assert.equal((await app.request('DELETE', '/api/connections/nope', { cookie })).status, 200)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp } from './helpers/app.mjs'

test('GET /api/refine/pair: nothing to compare until one kind has two captured items', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  app.seedItem({ kind: 'quote' })
  app.seedItem({ kind: 'music' })
  app.seedItem({ kind: 'music', status: 'canon' })
  const res = await app.request('GET', '/api/refine/pair', { cookie })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { a: null, b: null, mix: false })
})

test('GET /api/refine/pair: same kind by default, least-seen first, captured only', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  app.seedItem({ kind: 'art' }) // a lone kind is never paired by default
  const fresh1 = app.seedItem({ kind: 'quote' })
  const fresh2 = app.seedItem({ kind: 'quote' })
  app.seedItem({ kind: 'quote', wins: 2, losses: 1 }) // seen three times: waits
  app.seedItem({ kind: 'quote', status: 'canon' })
  app.seedItem({ kind: 'quote', status: 'archived' })

  for (let i = 0; i < 5; i++) {
    const res = await app.request('GET', '/api/refine/pair', { cookie })
    assert.deepEqual([res.body.a.id, res.body.b.id].sort(), [fresh1, fresh2].sort())
    assert.equal(res.body.mix, false)
    assert.ok(!('embedding' in res.body.a))
  }
})

test('GET /api/refine/pair: ?kind pins the kind, ?mix=true pairs across kinds', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const art = app.seedItem({ kind: 'art' })
  const song = app.seedItem({ kind: 'music' })
  app.seedItem({ kind: 'quote', wins: 1 })
  app.seedItem({ kind: 'quote', wins: 1 })

  const pinned = await app.request('GET', '/api/refine/pair?kind=quote', { cookie })
  assert.equal(pinned.body.a.kind, 'quote')
  assert.equal(pinned.body.b.kind, 'quote')

  const lone = await app.request('GET', '/api/refine/pair?kind=art', { cookie })
  assert.deepEqual(lone.body, { a: null, b: null, mix: false })

  const mixed = await app.request('GET', '/api/refine/pair?mix=true', { cookie })
  assert.equal(mixed.body.mix, true)
  assert.deepEqual([mixed.body.a.id, mixed.body.b.id].sort(), [art, song].sort())
})

test('POST /api/refine/pick records one win and one loss', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const winner = app.seedItem()
  const loser = app.seedItem()
  const res = await app.request('POST', '/api/refine/pick', { cookie, json: { winner_id: winner, loser_id: loser } })
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body), ['winner', 'loser', 'promoted', 'archived'])
  assert.equal(res.body.winner.wins, 1)
  assert.equal(res.body.loser.losses, 1)
  assert.equal(res.body.promoted, false)
  assert.equal(res.body.archived, false)
})

test('POST /api/refine/pick promotes at the third win and archives four losses down', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const winner = app.seedItem({ wins: 2 })
  const loser = app.seedItem({ losses: 3 })
  const res = await app.request('POST', '/api/refine/pick', { cookie, json: { winner_id: winner, loser_id: loser } })
  assert.equal(res.body.promoted, true)
  assert.equal(res.body.winner.status, 'canon')
  assert.equal(res.body.winner.promoted_via, 'refine')
  assert.equal(res.body.archived, true)
  assert.equal(res.body.loser.status, 'archived')
})

test('POST /api/refine/pick never re-promotes an archived item or re-archives a canon one', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const winner = app.seedItem({ wins: 5, status: 'archived' })
  const loser = app.seedItem({ losses: 9, status: 'canon', promoted_via: 'manual' })
  const res = await app.request('POST', '/api/refine/pick', { cookie, json: { winner_id: winner, loser_id: loser } })
  assert.equal(res.body.promoted, false)
  assert.equal(res.body.winner.status, 'archived')
  assert.equal(res.body.archived, false)
  assert.equal(res.body.loser.status, 'canon')
})

test('POST /api/refine/pick: 400 when an id is missing or both are the same', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const a = app.seedItem()
  for (const json of [{}, { winner_id: a }, { loser_id: a }, { winner_id: a, loser_id: a }]) {
    assert.equal((await app.request('POST', '/api/refine/pick', { cookie, json })).status, 400, JSON.stringify(json))
  }
  assert.equal(app.item(a).wins, 0)
})

test('POST /api/refine/pick: an unknown loser is 404 and the winner keeps its score', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const winner = app.seedItem({ wins: 2 })
  const res = await app.request('POST', '/api/refine/pick', { cookie, json: { winner_id: winner, loser_id: 'gone' } })
  assert.equal(res.status, 404)
  assert.equal(app.item(winner).wins, 2) // not counted...
  assert.equal(app.item(winner).status, 'captured') // ...and so not promoted by half a pick
})

test('POST /api/refine/pick: an unknown winner is 404 and the loser keeps its score', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const loser = app.seedItem({ losses: 3 })
  const res = await app.request('POST', '/api/refine/pick', { cookie, json: { winner_id: 'gone', loser_id: loser } })
  assert.equal(res.status, 404)
  assert.equal(app.item(loser).losses, 3)
  assert.equal(app.item(loser).status, 'captured')
})

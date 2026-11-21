// The Reader seam, write side: Reader mirrors each highlight here as a quote
// item (POST) and undoes it (DELETE), Worker to Worker, with the
// TASTE_INGEST_KEY Bearer. Request and response shapes are the ones this
// repo's README states; Reader's side lives in the reader repo.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, INGEST_KEY, EXTENSION_KEY, IOS_KEY } from './helpers/app.mjs'

const ITEM_KEYS = [
  'id', 'kind', 'title', 'body', 'source_url', 'creator', 'note', 'image_url',
  'status', 'wins', 'losses', 'promoted_via', 'created_at', 'updated_at',
]

const highlight = {
  highlight_id: 4711,
  quote: '  The sea, the sea.  ',
  note: 'why it stayed',
  source_url: 'https://example.test/article',
  source_title: 'An Article',
}

test('POST /api/ingest/highlight: 401 without the ingest key, also for the other clients\' keys and a session', async () => {
  const app = await createTestApp()
  assert.equal((await app.request('POST', '/api/ingest/highlight', { json: highlight })).status, 401)
  assert.equal((await app.request('POST', '/api/ingest/highlight', { bearer: 'wrong', json: highlight })).status, 401)
  assert.equal((await app.request('POST', '/api/ingest/highlight', { bearer: EXTENSION_KEY, json: highlight })).status, 401)
  assert.equal((await app.request('POST', '/api/ingest/highlight', { bearer: IOS_KEY, json: highlight })).status, 401)
  assert.equal((await app.request('POST', '/api/ingest/highlight', { cookie: app.signIn(), json: highlight })).status, 401)
  assert.equal(app.tasteDb.rows('SELECT COUNT(*) AS n FROM taste_item')[0].n, 0)
})

test('POST /api/ingest/highlight: 503 while TASTE_INGEST_KEY is not set', async () => {
  const app = await createTestApp({ TASTE_INGEST_KEY: undefined })
  const res = await app.request('POST', '/api/ingest/highlight', { bearer: INGEST_KEY, json: highlight })
  assert.equal(res.status, 503)
})

test('POST /api/ingest/highlight creates a quote item: { item, created: true }', async () => {
  const app = await createTestApp()
  const res = await app.request('POST', '/api/ingest/highlight', { bearer: INGEST_KEY, json: highlight })
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body), ['item', 'created'])
  assert.equal(res.body.created, true)
  assert.deepEqual(Object.keys(res.body.item), ITEM_KEYS)
  assert.equal(res.body.item.kind, 'quote')
  assert.equal(res.body.item.body, 'The sea, the sea.')
  assert.equal(res.body.item.title, 'An Article') // the article title
  assert.equal(res.body.item.note, 'why it stayed')
  assert.equal(res.body.item.source_url, 'https://example.test/article')
  assert.equal(res.body.item.creator, null)
  assert.equal(res.body.item.status, 'captured')
  assert.equal(app.item(res.body.item.id).external_ref, 'reader-highlight:4711')
})

test('POST /api/ingest/highlight is idempotent on highlight_id: a re-send returns the first item', async () => {
  const app = await createTestApp()
  const first = await app.request('POST', '/api/ingest/highlight', { bearer: INGEST_KEY, json: highlight })
  const again = await app.request('POST', '/api/ingest/highlight', {
    bearer: INGEST_KEY,
    json: { ...highlight, highlight_id: '4711', quote: 'edited since' }, // the id may arrive as a string
  })
  assert.equal(again.status, 200)
  assert.equal(again.body.created, false)
  assert.deepEqual(again.body.item, first.body.item)
  assert.equal(app.tasteDb.rows('SELECT COUNT(*) AS n FROM taste_item')[0].n, 1)
})

test('POST /api/ingest/highlight: only highlight_id and quote are required', async () => {
  const app = await createTestApp()
  const res = await app.request('POST', '/api/ingest/highlight', { bearer: INGEST_KEY, json: { highlight_id: 1, quote: 'q' } })
  assert.equal(res.status, 200)
  assert.equal(res.body.item.title, null)
  assert.equal(res.body.item.note, null)
  assert.equal(res.body.item.source_url, null)
})

test('POST /api/ingest/highlight: 400 for a missing or non-positive id and for an empty quote', async () => {
  const app = await createTestApp()
  for (const json of [{ quote: 'q' }, { highlight_id: 0, quote: 'q' }, { highlight_id: -3, quote: 'q' }, { highlight_id: 1.5, quote: 'q' }, { highlight_id: 'abc', quote: 'q' }, { highlight_id: 1 }, { highlight_id: 1, quote: '   ' }]) {
    const res = await app.request('POST', '/api/ingest/highlight', { bearer: INGEST_KEY, json })
    assert.equal(res.status, 400, JSON.stringify(json))
  }
  assert.equal(app.tasteDb.rows('SELECT COUNT(*) AS n FROM taste_item')[0].n, 0)
})

test('DELETE /api/ingest/highlight/[id] needs the ingest key', async () => {
  const app = await createTestApp()
  assert.equal((await app.request('DELETE', '/api/ingest/highlight/4711')).status, 401)
  assert.equal((await app.request('DELETE', '/api/ingest/highlight/4711', { cookie: app.signIn() })).status, 401)
  const off = await createTestApp({ TASTE_INGEST_KEY: undefined })
  assert.equal((await off.request('DELETE', '/api/ingest/highlight/4711', { bearer: INGEST_KEY })).status, 503)
})

test('DELETE /api/ingest/highlight/[id] removes an untouched mirror', async () => {
  const app = await createTestApp()
  const created = await app.request('POST', '/api/ingest/highlight', { bearer: INGEST_KEY, json: highlight })
  const res = await app.request('DELETE', '/api/ingest/highlight/4711', { bearer: INGEST_KEY })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { deleted: true })
  assert.equal(app.item(created.body.item.id), null)

  // Idempotent: a second undo, or one for a highlight never mirrored, is not an error.
  const again = await app.request('DELETE', '/api/ingest/highlight/4711', { bearer: INGEST_KEY })
  assert.equal(again.status, 200)
  assert.deepEqual(again.body, { deleted: false, reason: 'not-found' })
})

test('DELETE /api/ingest/highlight/[id] leaves an item the library has touched', async () => {
  const touch = {
    'a refine win': (app, id) => app.tasteDb.exec(`UPDATE taste_item SET wins = 1 WHERE id = '${id}'`),
    'a refine loss': (app, id) => app.tasteDb.exec(`UPDATE taste_item SET losses = 1 WHERE id = '${id}'`),
    'a promotion': (app, id) => app.tasteDb.exec(`UPDATE taste_item SET status = 'canon' WHERE id = '${id}'`),
    'an archive': (app, id) => app.tasteDb.exec(`UPDATE taste_item SET status = 'archived' WHERE id = '${id}'`),
    'a connection': (app, id) => {
      const other = app.seedItem()
      app.tasteDb.exec(`INSERT INTO connection (id, from_id, to_id, note, created_at) VALUES ('c1', '${other}', '${id}', NULL, '2026-01-01')`)
    },
  }
  for (const [what, apply] of Object.entries(touch)) {
    const app = await createTestApp()
    const created = await app.request('POST', '/api/ingest/highlight', { bearer: INGEST_KEY, json: highlight })
    apply(app, created.body.item.id)
    const res = await app.request('DELETE', '/api/ingest/highlight/4711', { bearer: INGEST_KEY })
    assert.equal(res.status, 200, what)
    assert.deepEqual(res.body, { deleted: false, reason: 'touched' }, what)
    assert.notEqual(app.item(created.body.item.id), null, what)
  }
})

test('DELETE /api/ingest/highlight/[id]: 400 for an id that is not a positive integer', async () => {
  const app = await createTestApp()
  for (const id of ['abc', '0', '-1', '1.5']) {
    assert.equal((await app.request('DELETE', `/api/ingest/highlight/${id}`, { bearer: INGEST_KEY })).status, 400, id)
  }
})

test('DELETE /api/ingest/highlight/[id] cannot reach items captured elsewhere', async () => {
  const app = await createTestApp()
  const own = app.seedItem({ body: 'typed by hand' })
  const res = await app.request('DELETE', '/api/ingest/highlight/1', { bearer: INGEST_KEY })
  assert.deepEqual(res.body, { deleted: false, reason: 'not-found' })
  assert.notEqual(app.item(own), null)
})

// server/middleware/origin.ts: session-gated writes from another site are
// refused; ingest routes and requests without an Origin are untouched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, EXTENSION_KEY, INGEST_KEY, IOS_KEY } from './helpers/app.mjs'

const OWN = 'https://taste.phareim.no'
const EXTENSION_ORIGIN = 'chrome-extension://odjnpodgcgeofokemcjnnokedkdikcan'
const count = (app) => app.tasteDb.rows('SELECT COUNT(*) AS n FROM taste_item')[0].n

test('a cross-origin write with the session cookie is 403 and writes nothing', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const id = app.seedItem({ body: 'keep me' })
  const other = app.seedItem()
  const writes = [
    ['POST', '/api/items', { kind: 'quote', body: 'planted' }],
    ['PATCH', `/api/items/${id}`, { body: 'changed' }],
    ['DELETE', `/api/items/${id}`, undefined],
    ['POST', '/api/connections', { from_id: id, to_id: other }],
    ['POST', '/api/refine/pick', { winner_id: id, loser_id: other }],
    ['POST', '/api/items/reembed', undefined],
  ]
  for (const origin of ['https://evil.example', 'https://reader.phareim.no', 'http://taste.phareim.no.evil.example', 'null']) {
    for (const [method, url, json] of writes) {
      const res = await app.request(method, url, { cookie, json, headers: { origin } })
      assert.equal(res.status, 403, `${origin} ${method} ${url}`)
    }
  }
  // A form post, the classic cross-site shape, is refused the same way.
  const form = await app.request('POST', '/api/items', { cookie, body: 'kind=quote&body=planted', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' } })
  assert.equal(form.status, 403)
  assert.equal(count(app), 2)
  assert.equal(app.item(id).body, 'keep me')
  assert.equal(app.item(id).wins, 0)
  assert.equal(app.tasteDb.rows('SELECT COUNT(*) AS n FROM connection')[0].n, 0)
})

test('the app\'s own origin, and no Origin at all, write as before', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  assert.equal((await app.request('POST', '/api/items', { cookie, json: { kind: 'quote', body: 'mine' }, headers: { origin: OWN } })).status, 200)
  assert.equal((await app.request('POST', '/api/items', { cookie, json: { kind: 'quote', body: 'native' } })).status, 200)
  const id = app.seedItem()
  assert.equal((await app.request('PATCH', `/api/items/${id}`, { cookie, json: { status: 'canon' }, headers: { origin: OWN } })).status, 200)
  assert.equal((await app.request('DELETE', `/api/items/${id}`, { cookie, headers: { origin: OWN } })).status, 200)
  // Without a session the route's own 401 still answers.
  assert.equal((await app.request('POST', '/api/items', { json: { kind: 'quote', body: 'x' }, headers: { origin: OWN } })).status, 401)
})

test('reads are never refused for their Origin', async () => {
  const app = await createTestApp()
  const cookie = app.signIn()
  const id = app.seedItem()
  for (const url of ['/api/items', `/api/items/${id}`, '/api/connections', '/api/auth/session']) {
    assert.equal((await app.request('GET', url, { cookie, headers: { origin: 'https://thoughts.phareim.no' } })).status, 200, url)
  }
})

test('ingest routes keep working with any Origin or none, exactly as before', async () => {
  const app = await createTestApp()
  const capture = { kind: 'quote', body: 'from the extension' }
  const ext = await app.request('POST', '/api/ingest/capture', { bearer: EXTENSION_KEY, json: capture, headers: { origin: EXTENSION_ORIGIN } })
  assert.equal(ext.status, 200)
  assert.equal(ext.headers.get('access-control-allow-origin'), EXTENSION_ORIGIN)
  const preflight = await app.request('OPTIONS', '/api/ingest/capture', { headers: { origin: EXTENSION_ORIGIN, 'access-control-request-method': 'POST' } })
  assert.equal(preflight.status, 204)
  assert.equal((await app.request('POST', '/api/ingest/capture', { bearer: IOS_KEY, json: capture })).status, 200) // the iOS app: no Origin
  assert.equal((await app.request('POST', '/api/ingest/capture-image', { bearer: IOS_KEY, body: new Uint8Array([1, 2]), headers: { 'content-type': 'image/png' } })).status, 201)
  assert.equal((await app.request('POST', '/api/ingest/enrich', { bearer: IOS_KEY, json: {} })).status, 200)
  assert.equal((await app.request('POST', '/api/ingest/enrich', { cookie: app.signIn(), json: {}, headers: { origin: OWN } })).status, 200) // the /capture form
  const hl = await app.request('POST', '/api/ingest/highlight', { bearer: INGEST_KEY, json: { highlight_id: 1, quote: 'q' }, headers: { origin: 'https://reader.phareim.no' } })
  assert.equal(hl.status, 200)
  assert.deepEqual((await app.request('DELETE', '/api/ingest/highlight/1', { bearer: INGEST_KEY })).body, { deleted: true })
  // ...and their own auth still decides: a foreign Origin is not what refuses a bad key.
  assert.equal((await app.request('POST', '/api/ingest/capture', { bearer: 'wrong', json: capture, headers: { origin: 'https://evil.example' } })).status, 401)
})

// The Reader-login seam: server/utils/readerSession.ts validates Reader's
// `session_token` cookie against Reader's database (read-only) and then
// applies this app's own email allowlist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, listRoutes, ALLOWED_EMAIL } from './helpers/app.mjs'
import { testRuntimeConfig } from './helpers/setup.mjs'

// Routes that are deliberately NOT behind the session + allowlist gate.
const OPEN_OR_KEYED = [
  'get /api/auth/session', // reports the session, never data
  'get /api/images/:key', // public, like every other image_url
  'options /api/ingest/capture', // CORS preflight
  'post /api/ingest/capture', // Bearer TASTE_EXTENSION_KEY | TASTE_IOS_KEY
  'post /api/ingest/capture-image', // Bearer TASTE_IOS_KEY
  'post /api/ingest/highlight', // Bearer TASTE_INGEST_KEY
  'delete /api/ingest/highlight/:id', // Bearer TASTE_INGEST_KEY
]

const sessionGated = listRoutes().filter((r) => !OPEN_OR_KEYED.includes(`${r.method} ${r.route}`))

test('the route table is the one the clients call', () => {
  assert.deepEqual(
    listRoutes().map((r) => `${r.method} ${r.route}`),
    [
      'get /api/auth/session',
      'get /api/connections',
      'post /api/connections',
      'delete /api/connections/:id',
      'get /api/images/:key',
      'options /api/ingest/capture',
      'post /api/ingest/capture',
      'post /api/ingest/capture-image',
      'post /api/ingest/enrich',
      'post /api/ingest/highlight',
      'delete /api/ingest/highlight/:id',
      'get /api/items',
      'post /api/items',
      'delete /api/items/:id',
      'get /api/items/:id',
      'patch /api/items/:id',
      'get /api/items/:id/related',
      'get /api/refine/pair',
      'post /api/refine/pick',
    ]
  )
})

test('GET /api/auth/session: no cookie is { user: null }, not an error', async () => {
  const app = await createTestApp()
  const res = await app.request('GET', '/api/auth/session')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { user: null })
})

test('GET /api/auth/session: a valid Reader session resolves to id, email, name', async () => {
  const app = await createTestApp()
  const cookie = app.signIn(ALLOWED_EMAIL, { name: 'Owner' })
  const res = await app.request('GET', '/api/auth/session', { cookie })
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body.user).sort(), ['email', 'id', 'name'])
  assert.equal(res.body.user.email, ALLOWED_EMAIL)
  assert.equal(res.body.user.name, 'Owner')
})

test('GET /api/auth/session: an expired or unknown session is { user: null }', async () => {
  const app = await createTestApp()
  const expired = app.signIn(ALLOWED_EMAIL, { expiresAt: new Date(Date.now() - 1000).toISOString() })
  assert.deepEqual((await app.request('GET', '/api/auth/session', { cookie: expired })).body, { user: null })
  assert.deepEqual(
    (await app.request('GET', '/api/auth/session', { cookie: 'session_token=not-a-session' })).body,
    { user: null }
  )
})

test('session validation never writes to Reader\'s database', async () => {
  const app = await createTestApp()
  const expired = app.signIn(ALLOWED_EMAIL, { expiresAt: new Date(Date.now() - 1000).toISOString() })
  await app.request('GET', '/api/auth/session', { cookie: expired })
  await app.request('GET', '/api/items', { cookie: expired })
  assert.equal(app.readerDb.rows('SELECT COUNT(*) AS n FROM "session"')[0].n, 1) // no expiry cleanup here
})

for (const { method, route } of sessionGated) {
  const url = route.replace(':id', 'some-id')

  test(`${method.toUpperCase()} ${route}: 401 without a session`, async () => {
    const app = await createTestApp()
    const res = await app.request(method.toUpperCase(), url, method === 'get' || method === 'delete' ? {} : { json: {} })
    assert.equal(res.status, 401)
  })

  test(`${method.toUpperCase()} ${route}: 403 for a Reader account outside the allowlist`, async () => {
    const app = await createTestApp()
    const cookie = app.signIn('someone-else@example.test')
    const res = await app.request(method.toUpperCase(), url, method === 'get' || method === 'delete' ? { cookie } : { cookie, json: {} })
    assert.equal(res.status, 403)
  })
}

test('a read over a service binding is judged by the forwarded cookie alone, whatever the host', async () => {
  // How this repo understands the neighbours that read the library: they call
  // the same routes with the visitor's Reader cookie, and a service binding
  // can address the Worker under any host name.
  const app = await createTestApp()
  const id = app.seedItem({ body: 'visible to its owner' })
  const origin = 'https://taste-maker.internal'
  const list = await app.request('GET', '/api/items', { cookie: app.signIn(), origin })
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.map((i) => i.id), [id])
  assert.equal((await app.request('GET', `/api/items/${id}`, { cookie: app.signIn(), origin })).status, 200)
  assert.equal((await app.request('GET', '/api/items', { origin })).status, 401)
  assert.equal((await app.request('GET', '/api/items', { cookie: app.signIn('visitor@example.test'), origin })).status, 403)
})

test('the allowlist is comma-separated and case-insensitive', async () => {
  const app = await createTestApp()
  testRuntimeConfig.allowedUserEmails = ' First@Example.test , SECOND@example.test '
  const cookie = app.signIn('second@EXAMPLE.test')
  assert.equal((await app.request('GET', '/api/items', { cookie })).status, 200)
  const other = app.signIn(ALLOWED_EMAIL)
  assert.equal((await app.request('GET', '/api/items', { cookie: other })).status, 403)
})

test('an empty allowlist lets nobody in', async () => {
  const app = await createTestApp()
  const cookie = app.signIn(ALLOWED_EMAIL)
  testRuntimeConfig.allowedUserEmails = ''
  assert.equal((await app.request('GET', '/api/items', { cookie })).status, 403)
})

test('a missing D1 binding is a 500, not a silent pass', async () => {
  const noReader = await createTestApp({ DB: undefined })
  assert.equal((await noReader.request('GET', '/api/items', { cookie: 'session_token=x' })).status, 500)
  const noTaste = await createTestApp({ TASTE_DB: undefined })
  assert.equal((await noTaste.request('GET', '/api/items', { cookie: noTaste.signIn() })).status, 500)
})

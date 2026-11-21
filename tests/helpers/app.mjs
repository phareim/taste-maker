// Mounts every handler under server/api on an h3 app, with the same
// file-name-to-route mapping Nitro uses ([id] -> :id, index -> '', the
// method from the file suffix), and a Cloudflare `env` the tests control.
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toWebHandler } from 'h3'
import { ROOT, testRuntimeConfig } from './setup.mjs'
import { createReaderDb, createTasteDb } from './d1.mjs'

export const ALLOWED_EMAIL = 'owner@example.test'
export const INGEST_KEY = 'ingest-key-for-tests'
export const EXTENSION_KEY = 'extension-key-for-tests'
export const IOS_KEY = 'ios-key-for-tests'

const API_DIR = path.join(ROOT, 'server', 'api')
const MIDDLEWARE_DIR = path.join(ROOT, 'server', 'middleware')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/** [{ method, route, file }] for every file under server/api. */
export function listRoutes() {
  return walk(API_DIR)
    .map((file) => {
      const rel = path.relative(API_DIR, file).split(path.sep).join('/')
      const m = rel.match(/^(.*)\.(get|post|patch|put|delete|options)\.ts$/)
      if (!m) throw new Error(`Unrecognized route file name: ${rel}`)
      const route = `/api/${m[1]}`
        .replace(/\[([^\]]+)\]/g, ':$1')
        .replace(/\/index$/, '')
      return { method: m[2], route, file }
    })
    .sort((a, b) => `${a.route} ${a.method}`.localeCompare(`${b.route} ${b.method}`))
}

/** A fake R2 bucket: the put/get subset the image routes use. */
export class FakeBucket {
  constructor() {
    this.objects = new Map()
  }

  async put(key, bytes, options = {}) {
    this.objects.set(key, { bytes: new Uint8Array(bytes), httpMetadata: options.httpMetadata })
  }

  async get(key) {
    const object = this.objects.get(key)
    if (!object) return null
    return {
      body: new Response(object.bytes).body,
      httpMetadata: object.httpMetadata,
      httpEtag: `"etag-${key}"`,
    }
  }
}

/**
 * A fresh app with empty databases. `env` is the Worker's bindings and
 * secrets; override any of them (set one to undefined to unset it).
 */
export async function createTestApp(envOverrides = {}) {
  const readerDb = createReaderDb()
  const tasteDb = createTasteDb()
  const bucket = new FakeBucket()
  const env = {
    DB: readerDb,
    TASTE_DB: tasteDb,
    TASTE_IMAGES: bucket,
    TASTE_INGEST_KEY: INGEST_KEY,
    TASTE_EXTENSION_KEY: EXTENSION_KEY,
    TASTE_IOS_KEY: IOS_KEY,
    ...envOverrides,
  }
  testRuntimeConfig.allowedUserEmails = ALLOWED_EMAIL

  const app = createApp()
  app.use(defineEventHandler((event) => {
    event.context.cloudflare = { env }
  }))
  // Nitro runs server/middleware/* on every request, in file-name order,
  // before the route handler.
  for (const name of readdirSync(MIDDLEWARE_DIR).filter((f) => f.endsWith('.ts')).sort()) {
    const mod = await import(pathToFileURL(path.join(MIDDLEWARE_DIR, name)).href)
    app.use(mod.default)
  }
  const router = createRouter()
  for (const { method, route, file } of listRoutes()) {
    const mod = await import(pathToFileURL(file).href)
    router.add(route, mod.default, method)
  }
  app.use(router)
  const handle = toWebHandler(app)

  /** Sign a Reader user in; returns the Cookie header value. */
  function signIn(email = ALLOWED_EMAIL, { expiresAt, name = 'Test User' } = {}) {
    const id = `user-${crypto.randomUUID()}`
    const token = `token-${crypto.randomUUID()}`
    readerDb.sqlite.prepare('INSERT INTO "User" (id, email, name) VALUES (?, ?, ?)').run(id, email, name)
    readerDb.sqlite
      .prepare('INSERT INTO "session" (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(token, id, expiresAt ?? new Date(Date.now() + 86_400_000).toISOString())
    return `session_token=${token}`
  }

  /**
   * One request. `json` is sent as a JSON body, `body` as raw bytes; `origin`
   * is the scheme and host it is addressed to.
   * Returns { status, headers, body, bytes } with the body parsed when it is JSON.
   */
  async function request(method, url, { cookie, bearer, json, body, headers = {}, origin = 'https://taste.phareim.no' } = {}) {
    const h = new Headers(headers)
    // Every real HTTP request carries Host; a bare web Request does not.
    if (!h.has('host')) h.set('host', new URL(origin).host)
    if (cookie) h.set('cookie', cookie)
    if (bearer) h.set('authorization', `Bearer ${bearer}`)
    let payload = body
    if (json !== undefined) {
      h.set('content-type', 'application/json')
      payload = JSON.stringify(json)
    }
    const res = await handle(new Request(`${origin}${url}`, { method, headers: h, body: payload }))
    const bytes = new Uint8Array(await res.arrayBuffer())
    const text = new TextDecoder().decode(bytes)
    let parsed = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // not JSON: leave the text
    }
    return { status: res.status, headers: res.headers, body: parsed, bytes }
  }

  /** Insert an item straight into the database; returns its id. */
  let seq = 0
  function seedItem(fields = {}) {
    seq += 1
    const row = {
      id: fields.id ?? crypto.randomUUID(),
      kind: 'quote',
      title: null,
      body: `item ${seq}`,
      source_url: null,
      creator: null,
      note: null,
      image_url: null,
      status: 'captured',
      wins: 0,
      losses: 0,
      promoted_via: null,
      embedding: null,
      external_ref: null,
      // One second apart, so created_at ordering is deterministic.
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
      ...fields,
    }
    row.updated_at = fields.updated_at ?? row.created_at
    if (Array.isArray(row.embedding)) row.embedding = JSON.stringify(row.embedding)
    const cols = Object.keys(row)
    tasteDb.sqlite
      .prepare(`INSERT INTO taste_item (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((c) => row[c]))
    return row.id
  }

  const item = (id) => tasteDb.rows('SELECT * FROM taste_item WHERE id = ?', id)[0] ?? null

  return { env, readerDb, tasteDb, bucket, request, signIn, seedItem, item }
}

// A D1 stand-in on Node's built-in SQLite: the same SQL dialect D1 runs, with
// foreign keys enforced as D1 enforces them. Covers the part of the D1 client
// API the routes use: prepare().bind().first()/all()/run().
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from './setup.mjs'

class Statement {
  constructor(db, sql, params = []) {
    this.db = db
    this.sql = sql
    this.params = params
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params)
  }

  async first() {
    const row = this.db.prepare(this.sql).get(...this.params)
    return row ? { ...row } : null
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.params).map((row) => ({ ...row }))
    return { results, success: true, meta: {} }
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params)
    return { success: true, meta: { changes: Number(info.changes) } }
  }
}

export class FakeD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec('PRAGMA foreign_keys = ON')
  }

  prepare(sql) {
    return new Statement(this.sqlite, sql)
  }

  exec(sql) {
    this.sqlite.exec(sql)
  }

  /** Synchronous read for assertions. */
  rows(sql, ...params) {
    return this.sqlite.prepare(sql).all(...params).map((row) => ({ ...row }))
  }
}

/** This app's own database, built from the real migrations in order. */
export function createTasteDb() {
  const db = new FakeD1()
  const dir = path.join(ROOT, 'migrations')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(path.join(dir, file), 'utf8'))
  }
  return db
}

/**
 * Reader's database, reduced to what server/utils/readerSession.ts reads.
 * Hand-written from that query: Reader owns the real schema, and this repo
 * only assumes these two tables and five columns (expires_at as ISO-8601 text).
 */
export function createReaderDb() {
  const db = new FakeD1()
  db.exec(`
    CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT);
    CREATE TABLE "session" (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL);
  `)
  return db
}

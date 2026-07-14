import { ITEM_COLUMNS } from '~/server/utils/tasteDb'
import { embedText } from '~/server/utils/embedding'

/**
 * Server-to-server capture: Reader mirrors a highlight here as a `quote`
 * item. Idempotent on `external_ref` ("reader-highlight:<id>") — re-sends
 * (including the backfill script) return the existing item instead of
 * duplicating. Auth is the TASTE_INGEST_KEY Bearer, not a session.
 */
export default defineEventHandler(async (event) => {
  requireIngestKey(event)
  const db = getTasteDb(event)
  const body = await readBody(event)

  const highlightId = Number(body?.highlight_id)
  const quote = typeof body?.quote === 'string' ? body.quote.trim() : ''
  if (!Number.isInteger(highlightId) || highlightId <= 0 || !quote) {
    throw createError({ statusCode: 400, statusMessage: 'highlight_id (positive int) and non-empty quote are required' })
  }
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null
  const source_url = typeof body?.source_url === 'string' && body.source_url.trim() ? body.source_url.trim() : null
  const source_title = typeof body?.source_title === 'string' && body.source_title.trim() ? body.source_title.trim() : null

  const externalRef = `reader-highlight:${highlightId}`

  const existing = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE external_ref = ?`)
    .bind(externalRef)
    .first()
  if (existing) return { item: existing, created: false }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const env = event?.context?.cloudflare?.env
  const embedInput = [source_title, quote, note].filter(Boolean).join(' — ')
  const embedding = await embedText(env, embedInput)

  try {
    await db
      .prepare(
        `INSERT INTO taste_item
          (id, kind, title, body, source_url, creator, note, image_url, status, wins, losses, promoted_via, embedding, external_ref, created_at, updated_at)
         VALUES (?, 'quote', ?, ?, ?, NULL, ?, NULL, 'captured', 0, 0, NULL, ?, ?, ?, ?)`
      )
      .bind(
        id,
        source_title,
        quote,
        source_url,
        note,
        embedding ? JSON.stringify(embedding) : null,
        externalRef,
        now,
        now
      )
      .run()
  } catch (err: any) {
    // Unique-index race on external_ref: another send won — return its row.
    const raced = await db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE external_ref = ?`)
      .bind(externalRef)
      .first()
    if (raced) return { item: raced, created: false }
    throw err
  }

  const row = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`).bind(id).first()
  return { item: row, created: true }
})

/**
 * Undo path for the Reader highlight mirror. Deletes the mirrored quote item
 * ONLY if it is still untouched (captured, no wins/losses, no connections) —
 * once Petter has refined or connected it, the taste library owns it and a
 * Reader-side undo no longer reaches it. Idempotent: missing = deleted:false.
 */
export default defineEventHandler(async (event) => {
  requireIngestKey(event)
  const db = getTasteDb(event)

  const highlightId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(highlightId) || highlightId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid highlight id' })
  }
  const externalRef = `reader-highlight:${highlightId}`

  const item = await db
    .prepare(`SELECT id, status, wins, losses FROM taste_item WHERE external_ref = ?`)
    .bind(externalRef)
    .first<{ id: string; status: string; wins: number; losses: number }>()
  if (!item) return { deleted: false, reason: 'not-found' }

  if (item.status !== 'captured' || item.wins > 0 || item.losses > 0) {
    return { deleted: false, reason: 'touched' }
  }
  const conn = await db
    .prepare(`SELECT COUNT(*) AS n FROM connection WHERE from_id = ?1 OR to_id = ?1`)
    .bind(item.id)
    .first<{ n: number }>()
  if ((conn?.n ?? 0) > 0) {
    return { deleted: false, reason: 'touched' }
  }

  await db.prepare(`DELETE FROM taste_item WHERE id = ?`).bind(item.id).run()
  return { deleted: true }
})

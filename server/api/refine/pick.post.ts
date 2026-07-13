import { ITEM_COLUMNS } from '~/server/utils/tasteDb'
import { PROMOTE_THRESHOLD, ARCHIVE_THRESHOLD } from '~/server/utils/refine'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const body = await readBody(event)

  const winner_id = typeof body?.winner_id === 'string' ? body.winner_id : ''
  const loser_id = typeof body?.loser_id === 'string' ? body.loser_id : ''
  if (!winner_id || !loser_id || winner_id === loser_id) {
    throw createError({ statusCode: 400, statusMessage: 'winner_id and loser_id are required and must differ' })
  }

  const now = new Date().toISOString()

  await db.prepare('UPDATE taste_item SET wins = wins + 1, updated_at = ? WHERE id = ?').bind(now, winner_id).run()
  let winner = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`).bind(winner_id).first<any>()
  if (!winner) {
    throw createError({ statusCode: 404, statusMessage: 'winner_id not found' })
  }

  let promoted = false
  if (winner.wins >= PROMOTE_THRESHOLD && winner.status === 'captured') {
    await db
      .prepare(`UPDATE taste_item SET status='canon', promoted_via='refine', updated_at=? WHERE id=?`)
      .bind(now, winner_id)
      .run()
    winner = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`).bind(winner_id).first()
    promoted = true
  }

  await db.prepare('UPDATE taste_item SET losses = losses + 1, updated_at = ? WHERE id = ?').bind(now, loser_id).run()
  let loser = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`).bind(loser_id).first<any>()
  if (!loser) {
    throw createError({ statusCode: 404, statusMessage: 'loser_id not found' })
  }

  let archived = false
  if (loser.losses - loser.wins >= ARCHIVE_THRESHOLD && loser.status === 'captured') {
    await db.prepare(`UPDATE taste_item SET status='archived', updated_at=? WHERE id=?`).bind(now, loser_id).run()
    loser = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`).bind(loser_id).first()
    archived = true
  }

  return { winner, loser, promoted, archived }
})

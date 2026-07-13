import { orderedPair } from '~/server/utils/tasteDb'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const body = await readBody(event)

  const from_id = typeof body?.from_id === 'string' ? body.from_id : ''
  const to_id = typeof body?.to_id === 'string' ? body.to_id : ''
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null

  if (!from_id || !to_id || from_id === to_id) {
    throw createError({ statusCode: 400, statusMessage: 'from_id and to_id are required and must differ' })
  }

  const [a, b] = orderedPair(from_id, to_id)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await db
    .prepare(
      `INSERT INTO connection (id, from_id, to_id, note, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(from_id, to_id) DO NOTHING`
    )
    .bind(id, a, b, note, now)
    .run()

  // ON CONFLICT DO NOTHING returns zero rows on the dedupe path — always
  // read back the row so the caller never gets `undefined` for an existing pair.
  const row = await db.prepare('SELECT * FROM connection WHERE from_id = ? AND to_id = ?').bind(a, b).first()
  return row
})

import { ITEM_COLUMNS } from '~/server/utils/tasteDb'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const id = getRouterParam(event, 'id') as string

  const item = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`).bind(id).first()
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  }

  const { results: edges } = await db
    .prepare('SELECT * FROM connection WHERE from_id = ?1 OR to_id = ?1 ORDER BY created_at DESC')
    .bind(id)
    .all()

  const connections = []
  for (const edge of edges as any[]) {
    const otherId = edge.from_id === id ? edge.to_id : edge.from_id
    const other = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`).bind(otherId).first()
    if (!other) continue // stale edge whose other endpoint is gone; skip rather than error
    connections.push({ id: edge.id, note: edge.note, created_at: edge.created_at, other })
  }

  return { item, connections }
})

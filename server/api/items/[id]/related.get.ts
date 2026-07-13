import { ITEM_COLUMNS } from '~/server/utils/tasteDb'
import { cosine } from '~/server/utils/embedding'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const id = getRouterParam(event, 'id') as string

  const target = await db.prepare('SELECT embedding FROM taste_item WHERE id = ?').bind(id).first<{ embedding: string | null }>()
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  }
  if (!target.embedding) {
    return []
  }
  const targetVec: number[] = JSON.parse(target.embedding)

  // Known ceiling: this loads all embedded vectors per request — fine at
  // personal scale, but a few thousand items x ~15KB approaches D1/Worker
  // response limits. v2 concern (e.g. a vector index) — not addressed here.
  const { results } = await db
    .prepare(`SELECT ${ITEM_COLUMNS}, embedding FROM taste_item WHERE id != ? AND embedding IS NOT NULL`)
    .bind(id)
    .all()

  const scored = (results as any[])
    .map((row) => {
      const { embedding, ...item } = row
      const vec: number[] = JSON.parse(embedding)
      return { ...item, similarity: Math.round(cosine(targetVec, vec) * 1000) / 1000 }
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)

  return scored
})

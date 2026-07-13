import { ITEM_COLUMNS, getItem } from '~/server/utils/tasteDb'
import { embedText } from '~/server/utils/embedding'
import type { Status } from '~/types/taste'

const VALID_STATUSES: Status[] = ['captured', 'canon', 'archived']

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const id = getRouterParam(event, 'id') as string
  const body = await readBody(event)

  const current = await getItem(db, id)
  if (!current) {
    throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  }

  if (body?.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid status' })
  }

  const next = {
    title: body?.title !== undefined ? (typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null) : current.title,
    body: body?.body !== undefined ? String(body.body).trim() : current.body,
    source_url: body?.source_url !== undefined ? (typeof body.source_url === 'string' && body.source_url.trim() ? body.source_url.trim() : null) : current.source_url,
    creator: body?.creator !== undefined ? (typeof body.creator === 'string' && body.creator.trim() ? body.creator.trim() : null) : current.creator,
    note: body?.note !== undefined ? (typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null) : current.note,
    image_url: body?.image_url !== undefined ? (typeof body.image_url === 'string' && body.image_url.trim() ? body.image_url.trim() : null) : current.image_url,
    status: (body?.status !== undefined ? body.status : current.status) as Status,
  }

  if (!next.body) {
    throw createError({ statusCode: 400, statusMessage: 'body cannot be empty' })
  }

  // Fast-track / demote marker: entering canon from elsewhere via PATCH is
  // the manual bypass (distinct from refine-earned promotion); leaving canon
  // clears it.
  let promoted_via = current.promoted_via
  if (next.status === 'canon' && current.status !== 'canon') {
    promoted_via = 'manual'
  } else if (next.status !== 'canon' && current.status === 'canon') {
    promoted_via = null
  }

  const textChanged = next.body !== current.body || next.title !== current.title || next.note !== current.note || next.creator !== current.creator
  let embedding: number[] | null | undefined
  if (textChanged) {
    const env = event?.context?.cloudflare?.env
    const embedInput = [next.title, next.creator, next.body, next.note].filter(Boolean).join(' — ')
    embedding = await embedText(env, embedInput)
  }

  const now = new Date().toISOString()

  if (textChanged) {
    await db
      .prepare(
        `UPDATE taste_item
         SET title=?, body=?, source_url=?, creator=?, note=?, image_url=?, status=?, promoted_via=?, embedding=?, updated_at=?
         WHERE id=?`
      )
      .bind(
        next.title,
        next.body,
        next.source_url,
        next.creator,
        next.note,
        next.image_url,
        next.status,
        promoted_via,
        embedding ? JSON.stringify(embedding) : null,
        now,
        id
      )
      .run()
  } else {
    await db
      .prepare(
        `UPDATE taste_item
         SET title=?, body=?, source_url=?, creator=?, note=?, image_url=?, status=?, promoted_via=?, updated_at=?
         WHERE id=?`
      )
      .bind(next.title, next.body, next.source_url, next.creator, next.note, next.image_url, next.status, promoted_via, now, id)
      .run()
  }

  const row = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`).bind(id).first()
  return row
})

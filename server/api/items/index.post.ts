import { ITEM_COLUMNS } from '~/server/utils/tasteDb'
import { embedText } from '~/server/utils/embedding'
import type { Kind } from '~/types/taste'

const VALID_KINDS: Kind[] = ['quote', 'reference', 'music', 'art']

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const body = await readBody(event)

  const kind = body?.kind
  const text = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!VALID_KINDS.includes(kind) || !text) {
    throw createError({ statusCode: 400, statusMessage: 'kind (quote|reference|music|art) and non-empty body are required' })
  }

  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : null
  const source_url = typeof body?.source_url === 'string' && body.source_url.trim() ? body.source_url.trim() : null
  const creator = typeof body?.creator === 'string' && body.creator.trim() ? body.creator.trim() : null
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null
  const image_url = typeof body?.image_url === 'string' && body.image_url.trim() ? body.image_url.trim() : null

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const env = event?.context?.cloudflare?.env
  const embedInput = [title, creator, text, note].filter(Boolean).join(' — ')
  const embedding = await embedText(env, embedInput)

  await db
    .prepare(
      `INSERT INTO taste_item
        (id, kind, title, body, source_url, creator, note, image_url, status, wins, losses, promoted_via, embedding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', 0, 0, NULL, ?, ?, ?)`
    )
    .bind(
      id,
      kind,
      title,
      text,
      source_url,
      creator,
      note,
      image_url,
      embedding ? JSON.stringify(embedding) : null,
      now,
      now
    )
    .run()

  const row = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`).bind(id).first()
  return row
})

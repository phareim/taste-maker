import { embedText } from '~/server/utils/embedding'

// Items written while NIM was down (or before NVIDIA_API_KEY was set) are
// saved with embedding = NULL and never get a Related panel. This backfills
// them, oldest first, a batch per call. It stops at the first failure: NIM
// is then down again, and every further try would wait out its own timeout.
const BATCH = 25

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const env = event?.context?.cloudflare?.env

  const { results } = await db
    .prepare(
      'SELECT id, title, creator, body, note FROM taste_item WHERE embedding IS NULL ORDER BY created_at ASC, id ASC LIMIT ?'
    )
    .bind(BATCH)
    .all()

  let embedded = 0
  for (const row of results as any[]) {
    // The same text every write route embeds.
    const embedInput = [row.title, row.creator, row.body, row.note].filter(Boolean).join(' — ')
    const embedding = await embedText(env, embedInput)
    if (!embedding) break
    await db
      .prepare('UPDATE taste_item SET embedding = ? WHERE id = ? AND embedding IS NULL')
      .bind(JSON.stringify(embedding), row.id)
      .run()
    embedded++
  }

  const left = await db.prepare('SELECT COUNT(*) AS n FROM taste_item WHERE embedding IS NULL').first<{ n: number }>()
  return { embedded, left: left?.n ?? 0 }
})

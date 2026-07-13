export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)

  // Personal scale — no filters; the palette joins client-side.
  const { results } = await db.prepare('SELECT * FROM connection ORDER BY created_at DESC').all()
  return results
})

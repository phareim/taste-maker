export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const id = getRouterParam(event, 'id') as string

  await db.prepare('DELETE FROM connection WHERE id = ?').bind(id).run()

  return { ok: true }
})

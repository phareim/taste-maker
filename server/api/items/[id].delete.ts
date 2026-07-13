export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const id = getRouterParam(event, 'id') as string

  // D1/SQLite FK enforcement is not guaranteed (per-connection pragma,
  // version-dependent) — never rely on the DDL's ON DELETE CASCADE.
  // Explicitly clear edges first so item pages never hit an orphaned edge.
  await db.prepare('DELETE FROM connection WHERE from_id = ?1 OR to_id = ?1').bind(id).run()
  await db.prepare('DELETE FROM taste_item WHERE id = ?1').bind(id).run()

  return { ok: true }
})

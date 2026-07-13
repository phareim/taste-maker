import { ITEM_COLUMNS } from '~/server/utils/tasteDb'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const query = getQuery(event)

  const kind = typeof query.kind === 'string' ? query.kind : ''
  const status = typeof query.status === 'string' ? query.status : ''
  const q = typeof query.q === 'string' ? query.q.trim() : ''

  const clauses: string[] = []
  const params: any[] = []

  if (kind) {
    clauses.push('kind = ?')
    params.push(kind)
  }
  if (status) {
    clauses.push('status = ?')
    params.push(status)
  }
  if (q) {
    // All-anonymous `?` placeholders only — never mix `?` and `?N` binding
    // styles in the same statement (SQLite mis-binds). Push the same value
    // once per `?` in clause order.
    clauses.push('(title LIKE ? OR body LIKE ? OR creator LIKE ? OR note LIKE ?)')
    const like = `%${q}%`
    params.push(like, like, like, like)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const sql = `SELECT ${ITEM_COLUMNS} FROM taste_item ${where} ORDER BY created_at DESC`

  const { results } = await db.prepare(sql).bind(...params).all()
  return results
})

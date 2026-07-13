// Thin query helpers shared by the items/connections/refine routes so each
// route file stays small. Deliberately minimal — routes are free to inline
// SQL for anything not covered here.
import type { TasteItem } from '~/types/taste'

// `embedding` is deliberately excluded — it never leaves the server. Every
// route that returns item rows to the client must select exactly these
// columns (never `SELECT *`).
export const ITEM_COLUMNS =
  'id,kind,title,body,source_url,creator,note,image_url,status,wins,losses,promoted_via,created_at,updated_at'

export async function getItem(db: any, id: string): Promise<TasteItem | null> {
  const row = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM taste_item WHERE id = ?`)
    .bind(id)
    .first()
  return (row as TasteItem) ?? null
}

// Canonical ordering for connection dedupe: sort the two ids so A-B and B-A
// always land on the same (from_id, to_id) pair, letting the unique index
// on (from_id, to_id) dedupe regardless of direction.
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

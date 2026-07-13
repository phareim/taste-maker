import { ITEM_COLUMNS } from '~/server/utils/tasteDb'

// First guesses to revisit with real usage — see PROMOTE_THRESHOLD /
// ARCHIVE_THRESHOLD in refine/pick.post.ts.
export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const db = getTasteDb(event)
  const query = getQuery(event)

  const pinnedKind = typeof query.kind === 'string' && query.kind ? query.kind : null
  const mix = query.mix === 'true' || query.mix === '1'

  let kind: string | null = pinnedKind

  if (!mix && !kind) {
    // Default path: pick an eligible kind at random (same-kind pairing is
    // the default — cross-kind is a deliberate "wildcard" mode, not an accident).
    const row = await db
      .prepare(
        `SELECT kind FROM taste_item WHERE status='captured' GROUP BY kind HAVING COUNT(*) >= 2 ORDER BY RANDOM() LIMIT 1`
      )
      .first<{ kind: string }>()
    if (!row) {
      return { a: null, b: null, mix: false }
    }
    kind = row.kind
  }

  // Exposure weighting (all modes) — least-seen items surface first so
  // repeat pairings don't dominate a small pool.
  let results: any[]
  if (mix) {
    const res = await db
      .prepare(
        `SELECT ${ITEM_COLUMNS} FROM taste_item WHERE status='captured' ORDER BY (wins + losses) ASC, RANDOM() LIMIT 2`
      )
      .all()
    results = res.results
  } else {
    const res = await db
      .prepare(
        `SELECT ${ITEM_COLUMNS} FROM taste_item WHERE status='captured' AND kind=? ORDER BY (wins + losses) ASC, RANDOM() LIMIT 2`
      )
      .bind(kind)
      .all()
    results = res.results
  }

  if (results.length < 2) {
    return { a: null, b: null, mix }
  }

  return { a: results[0], b: results[1], mix }
})

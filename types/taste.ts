// Shared client/server contract for taste-maker's owned data.
// Note: TasteItem deliberately has NO `embedding` field — that column never
// leaves the server (see server/utils/tasteDb.ts ITEM_COLUMNS).

export type Kind = 'quote' | 'reference' | 'music' | 'art'

export type Status = 'captured' | 'canon' | 'archived'

export interface TasteItem {
  id: string
  kind: Kind
  title: string | null
  body: string
  source_url: string | null
  creator: string | null
  note: string | null
  image_url: string | null
  status: Status
  wins: number
  losses: number
  promoted_via: 'refine' | 'manual' | null
  created_at: string
  updated_at: string
}

export interface Connection {
  id: string
  from_id: string
  to_id: string
  note: string | null
  created_at: string
}

export interface RelatedItem extends TasteItem {
  similarity: number
}

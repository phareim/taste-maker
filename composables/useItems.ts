import type { TasteItem, Connection, RelatedItem, Kind, Status } from '~/types/taste'

export interface ItemConnection {
  id: string
  note: string | null
  created_at: string
  other: TasteItem
}

export interface ItemWithConnections {
  item: TasteItem
  connections: ItemConnection[]
}

export interface RefinePair {
  a: TasteItem | null
  b: TasteItem | null
  mix: boolean
}

export interface RefinePickResult {
  winner: TasteItem
  loser: TasteItem
  promoted: boolean
  archived: boolean
}

export interface NewItemInput {
  kind: Kind
  body: string
  title?: string | null
  source_url?: string | null
  creator?: string | null
  note?: string | null
  image_url?: string | null
}

/**
 * Thin $fetch wrappers over taste-maker's owned API (server/api/items,
 * connections, refine). Modeled on do-web's useTasks.ts shape, minus the
 * useState cache — at personal scale each page fetches what it needs
 * directly rather than sharing a store.
 */
export function useItems() {
  function list(params?: { kind?: Kind | string; status?: Status | string; q?: string }): Promise<TasteItem[]> {
    return $fetch<TasteItem[]>('/api/items', { query: params })
  }

  function get(id: string): Promise<ItemWithConnections> {
    return $fetch<ItemWithConnections>(`/api/items/${id}`)
  }

  function create(input: NewItemInput): Promise<TasteItem> {
    return $fetch<TasteItem>('/api/items', { method: 'POST', body: input })
  }

  function patch(id: string, body: Partial<NewItemInput> & { status?: Status }): Promise<TasteItem> {
    return $fetch<TasteItem>(`/api/items/${id}`, { method: 'PATCH', body })
  }

  function remove(id: string): Promise<{ ok: true }> {
    return $fetch<{ ok: true }>(`/api/items/${id}`, { method: 'DELETE' })
  }

  function related(id: string): Promise<RelatedItem[]> {
    return $fetch<RelatedItem[]>(`/api/items/${id}/related`)
  }

  function refinePair(opts?: { kind?: Kind | string; mix?: boolean }): Promise<RefinePair> {
    return $fetch<RefinePair>('/api/refine/pair', {
      query: {
        kind: opts?.kind || undefined,
        mix: opts?.mix ? 'true' : undefined,
      },
    })
  }

  function refinePick(winnerId: string, loserId: string): Promise<RefinePickResult> {
    return $fetch<RefinePickResult>('/api/refine/pick', {
      method: 'POST',
      body: { winner_id: winnerId, loser_id: loserId },
    })
  }

  function connections(): Promise<Connection[]> {
    return $fetch<Connection[]>('/api/connections')
  }

  function connect(from: string, to: string, note?: string): Promise<Connection> {
    return $fetch<Connection>('/api/connections', {
      method: 'POST',
      body: { from_id: from, to_id: to, note: note || undefined },
    })
  }

  function disconnect(id: string): Promise<{ ok: true }> {
    return $fetch<{ ok: true }>(`/api/connections/${id}`, { method: 'DELETE' })
  }

  return { list, get, create, patch, remove, related, refinePair, refinePick, connections, connect, disconnect }
}

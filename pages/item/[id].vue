<template>
  <main class="max-w-2xl mx-auto px-5 pb-24 pt-8">
    <nav class="flex items-baseline justify-between">
      <NuxtLink
        to="/"
        class="font-mono uppercase text-mute hover:text-ink"
        style="font-size: 10px; letter-spacing: 0.16em;"
      >&larr;&nbsp;Library</NuxtLink>
      <MonoLabel v-if="statusLabel" accent>{{ statusLabel }}</MonoLabel>
    </nav>

    <template v-if="item">
      <header class="mt-6">
        <MonoLabel dash>{{ kindLabel }}</MonoLabel>
      </header>

      <div class="mt-3">
        <ItemCard :item="item" variant="large" />
      </div>

      <!-- Refine-standing indicator — omitted for untouched items (no wins yet). -->
      <p
        v-if="item.status === 'captured' && item.wins > 0"
        class="mt-3 font-mono text-mute"
        style="font-size: 10px; letter-spacing: 0.1em;"
      >{{ item.wins }}/{{ PROMOTE_THRESHOLD }} toward canon</p>

      <HairlineRule class="mt-6" />

      <!-- Status actions -->
      <div class="mt-4 flex flex-wrap gap-2">
        <ActionLabel v-if="item.status === 'captured'" accent :disabled="promoting" @click="promote">
          {{ promoting ? 'Fast-tracking…' : 'Fast-track to palette' }}
        </ActionLabel>
        <ActionLabel v-if="item.status === 'canon'" :disabled="demoting" @click="demote">
          {{ demoting ? 'Demoting…' : 'Demote to captured' }}
        </ActionLabel>
        <ActionLabel v-if="item.status === 'archived'" :disabled="unarchiving" @click="unarchive">
          {{ unarchiving ? 'Un-archiving…' : 'Un-archive' }}
        </ActionLabel>
        <ActionLabel :disabled="deleting" @click="confirmDelete">{{ deleting ? 'Deleting…' : 'Delete' }}</ActionLabel>
      </div>

      <!-- Related — hidden entirely when the item has no embedding or no
           neighbours; a bare hidden section is calmer than "no matches" noise. -->
      <section v-if="relatedItems.length" class="mt-10">
        <MonoLabel dash>Related</MonoLabel>
        <ul class="mt-3 space-y-3">
          <li
            v-for="r in relatedItems"
            :key="r.id"
            class="flex items-center justify-between gap-3 border-b border-rule pb-3"
          >
            <NuxtLink :to="`/item/${r.id}`" class="min-w-0 flex-1">
              <p class="truncate text-ink">{{ r.title || r.body }}</p>
              <span class="font-mono text-faint" style="font-size: 10px; letter-spacing: 0.08em;">{{ r.similarity.toFixed(2) }}</span>
            </NuxtLink>
            <ActionLabel :disabled="isConnected(r.id) || connectingId === r.id" @click="quickConnect(r.id)">
              {{ isConnected(r.id) ? 'Connected' : (connectingId === r.id ? 'Connecting…' : 'Connect') }}
            </ActionLabel>
          </li>
        </ul>
      </section>

      <!-- Explicit connections -->
      <section v-if="connections.length" class="mt-10">
        <MonoLabel dash>Connections</MonoLabel>
        <ul class="mt-3 space-y-3">
          <li
            v-for="c in connections"
            :key="c.id"
            class="flex items-center justify-between gap-3 border-b border-rule pb-3"
          >
            <NuxtLink :to="`/item/${c.other.id}`" class="min-w-0 flex-1">
              <p class="truncate text-ink">{{ c.other.title || c.other.body }}</p>
              <p v-if="c.note" class="truncate text-mute italic">{{ c.note }}</p>
            </NuxtLink>
            <ActionLabel :disabled="removingId === c.id" @click="removeConnection(c.id)">
              {{ removingId === c.id ? 'Removing…' : 'Remove' }}
            </ActionLabel>
          </li>
        </ul>
      </section>
    </template>

    <template v-else-if="notFound">
      <HairlineRule class="mt-6" />
      <p class="mt-8 text-mute italic">This item does not exist (anymore).</p>
      <NuxtLink
        to="/"
        class="mt-4 inline-block font-mono uppercase text-accent-ink"
        style="font-size: 10px; letter-spacing: 0.16em;"
      >&mdash; Back to the library</NuxtLink>
    </template>

    <p v-else class="mt-8 text-mute italic">Loading…</p>
  </main>
</template>

<script setup lang="ts">
import type { TasteItem, RelatedItem } from '~/types/taste'
import type { ItemConnection } from '~/composables/useItems'

// Mirrors server/utils/refine.ts PROMOTE_THRESHOLD — server/utils is Nitro-only
// and not shared with the client bundle, so the display constant is duplicated
// here rather than importing across that boundary.
const PROMOTE_THRESHOLD = 3

const route = useRoute()
const id = computed(() => route.params.id as string)

const { get, patch, remove, related, connect, disconnect } = useItems()
const { showSuccess, showError } = useToast()

const item = ref<TasteItem | null>(null)
const connections = ref<ItemConnection[]>([])
const relatedItems = ref<RelatedItem[]>([])
const loading = ref(true)
const notFound = ref(false)

const promoting = ref(false)
const demoting = ref(false)
const unarchiving = ref(false)
const deleting = ref(false)
const connectingId = ref<string | null>(null)
const removingId = ref<string | null>(null)

const kindLabel = computed(() => {
  const k = item.value?.kind
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : ''
})

const statusLabel = computed(() => {
  if (item.value?.status === 'canon') return 'Canon'
  if (item.value?.status === 'archived') return 'Archived'
  return ''
})

function isConnected(otherId: string): boolean {
  return connections.value.some((c) => c.other.id === otherId)
}

async function load() {
  loading.value = true
  notFound.value = false
  try {
    const data = await get(id.value)
    item.value = data.item
    connections.value = data.connections
  } catch {
    item.value = null
    notFound.value = true
  } finally {
    loading.value = false
  }
  loadRelated()
}

async function loadRelated() {
  if (!item.value) {
    relatedItems.value = []
    return
  }
  try {
    relatedItems.value = await related(id.value)
  } catch {
    // Graceful degradation — no error toast, the panel just stays hidden.
    relatedItems.value = []
  }
}

async function refreshConnections() {
  if (!item.value) return
  const data = await get(item.value.id)
  item.value = data.item
  connections.value = data.connections
}

onMounted(load)
watch(id, load)

async function promote() {
  if (!item.value || promoting.value) return
  promoting.value = true
  try {
    item.value = await patch(item.value.id, { status: 'canon' })
    showSuccess('Fast-tracked to the palette')
  } catch {
    showError('Could not promote the item')
  } finally {
    promoting.value = false
  }
}

async function demote() {
  if (!item.value || demoting.value) return
  demoting.value = true
  try {
    item.value = await patch(item.value.id, { status: 'captured' })
    showSuccess('Back to captured')
  } catch {
    showError('Could not demote the item')
  } finally {
    demoting.value = false
  }
}

async function unarchive() {
  if (!item.value || unarchiving.value) return
  unarchiving.value = true
  try {
    item.value = await patch(item.value.id, { status: 'captured' })
    showSuccess('Un-archived — back in the library')
  } catch {
    showError('Could not un-archive the item')
  } finally {
    unarchiving.value = false
  }
}

async function confirmDelete() {
  if (!item.value || deleting.value) return
  const label = item.value.title || item.value.body
  if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return
  deleting.value = true
  try {
    await remove(item.value.id)
    showSuccess('Deleted')
    navigateTo('/')
  } catch {
    showError('Could not delete the item')
    deleting.value = false
  }
}

async function quickConnect(otherId: string) {
  if (!item.value || connectingId.value || isConnected(otherId)) return
  connectingId.value = otherId
  try {
    await connect(item.value.id, otherId)
    await refreshConnections()
    showSuccess('Connected')
  } catch {
    showError('Could not connect')
  } finally {
    connectingId.value = null
  }
}

async function removeConnection(connId: string) {
  if (removingId.value) return
  removingId.value = connId
  try {
    await disconnect(connId)
    connections.value = connections.value.filter((c) => c.id !== connId)
  } catch {
    showError('Could not remove the connection')
  } finally {
    removingId.value = null
  }
}
</script>

<template>
  <main class="max-w-2xl mx-auto px-5 pb-24 pt-8">
    <header class="flex items-baseline justify-between">
      <div>
        <MonoLabel dash>Library</MonoLabel>
        <h1 class="mt-1 text-3xl">The whole collection</h1>
      </div>
      <MonoLabel v-if="loaded">{{ items.length }} item{{ items.length === 1 ? '' : 's' }}</MonoLabel>
    </header>
    <HairlineRule class="mt-4" />

    <!-- Kind filter row -->
    <nav class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Filter by kind">
      <button
        v-for="f in KIND_FILTERS"
        :key="f.key"
        type="button"
        class="font-mono uppercase transition-colors"
        :class="kindFilter === f.key ? 'text-accent-ink border-b border-accent' : 'text-mute hover:text-ink'"
        style="font-size: 10px; letter-spacing: 0.16em;"
        @click="kindFilter = f.key"
      >{{ f.label }}</button>
    </nav>

    <!-- Status filter row -->
    <nav class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Filter by status">
      <button
        v-for="f in STATUS_FILTERS"
        :key="f.key"
        type="button"
        class="font-mono uppercase transition-colors"
        :class="statusFilter === f.key ? 'text-accent-ink border-b border-accent' : 'text-mute hover:text-ink'"
        style="font-size: 10px; letter-spacing: 0.16em;"
        @click="statusFilter = f.key"
      >{{ f.label }}</button>
    </nav>

    <!-- Search -->
    <div class="mt-5">
      <input
        v-model="searchInput"
        type="search"
        class="tufte-input"
        placeholder="Search title, body, creator, note…"
      />
    </div>

    <!-- Results -->
    <p v-if="loading && !loaded" class="mt-8 text-mute italic">Loading…</p>
    <p v-else-if="items.length === 0" class="mt-8 text-mute italic">
      {{ hasActiveFilters ? 'Nothing matches these filters.' : 'Nothing captured yet — start on the Capture page.' }}
    </p>
    <div v-else class="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
      <NuxtLink
        v-for="item in items"
        :key="item.id"
        :to="`/item/${item.id}`"
        class="block transition-opacity hover:opacity-90"
        :class="item.status === 'archived' ? 'opacity-60' : ''"
      >
        <ItemCard :item="item" variant="card" />
      </NuxtLink>
    </div>
  </main>
</template>

<script setup lang="ts">
import type { Kind, Status, TasteItem } from '~/types/taste'

type KindFilter = 'all' | Kind
type StatusFilter = 'all' | Status

const KIND_FILTERS: Array<{ key: KindFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'quote', label: 'Quote' },
  { key: 'reference', label: 'Reference' },
  { key: 'music', label: 'Music' },
  { key: 'art', label: 'Art' },
]

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'captured', label: 'Captured' },
  { key: 'canon', label: 'Canon' },
  { key: 'archived', label: 'Archived' },
]

const { list } = useItems()
const { showError } = useToast()
const route = useRoute()
const router = useRouter()

const items = ref<TasteItem[]>([])
const loading = ref(false)
const loaded = ref(false)

const kindFilter = ref<KindFilter>('all')
const statusFilter = ref<StatusFilter>('all')
const searchInput = ref(typeof route.query.q === 'string' ? route.query.q : '')
const activeQuery = ref(searchInput.value.trim())

const hasActiveFilters = computed(
  () => kindFilter.value !== 'all' || statusFilter.value !== 'all' || activeQuery.value.length > 0
)

let debounceHandle: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (val) => {
  if (debounceHandle) clearTimeout(debounceHandle)
  debounceHandle = setTimeout(() => {
    activeQuery.value = val.trim()
  }, 300)
})

async function fetchItems() {
  loading.value = true
  try {
    items.value = await list({
      kind: kindFilter.value === 'all' ? undefined : kindFilter.value,
      status: statusFilter.value === 'all' ? undefined : statusFilter.value,
      q: activeQuery.value || undefined,
    })
    loaded.value = true
  } catch {
    showError('Could not load the library')
  } finally {
    loading.value = false
  }
}

// Single watcher drives both the fetch and the ?q= URL sync, so the initial
// load and every subsequent filter/search change go through one path.
watch(
  [kindFilter, statusFilter, activeQuery],
  () => {
    router.replace({ query: activeQuery.value ? { q: activeQuery.value } : {} })
    fetchItems()
  },
  { immediate: true }
)
</script>

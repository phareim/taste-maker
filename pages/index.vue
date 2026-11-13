<template>
  <main class="max-w-2xl mx-auto px-5 pb-24 pt-8">
    <header class="flex items-baseline justify-between">
      <div>
        <MonoLabel dash>Library</MonoLabel>
        <h1 class="mt-1 text-3xl">The whole collection</h1>
      </div>
      <MonoLabel v-if="loaded">{{ items.length }} item{{ items.length === 1 ? '' : 's' }}</MonoLabel>
    </header>
    <HairlineRule class="mt-4" desk />

    <!-- The library is one sheet of paper lying on the desk; the header
         above sits on the desk itself. -->
    <div class="tufte-sheet page-sheet mt-5 px-5 py-5 sm:px-7 sm:py-6">
    <!-- Kind filter row -->
    <nav class="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Filter by kind">
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
  { key: 'clothing', label: 'Clothing' },
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

// One fetch per filter state. During SSR useAsyncData waits for it and
// list() goes through useRequestFetch, so the request's cookie reaches
// /api/items and the page renders with the library in it; the client takes
// the answer from the payload instead of asking again. `lazy` keeps client
// navigation to / instant (the "Loading…" line shows meanwhile), and `watch`
// refetches on every filter/search change.
const { data, status, error } = useAsyncData(
  'library-items',
  () =>
    list({
      kind: kindFilter.value === 'all' ? undefined : kindFilter.value,
      status: statusFilter.value === 'all' ? undefined : statusFilter.value,
      q: activeQuery.value || undefined,
    }),
  { lazy: true, watch: [kindFilter, statusFilter, activeQuery] }
)
const items = computed<TasteItem[]>(() => data.value ?? [])
const loading = computed(() => status.value === 'pending')
const loaded = computed(() => data.value != null)

// The toast lives in the browser only (its timers are client-side). Started
// after mount, so a server-side failure (the payload's error) raises it once
// hydration is done rather than changing the DOM being hydrated.
onMounted(() => {
  watch(
    error,
    (e) => {
      if (e) showError('Could not load the library')
    },
    { immediate: true }
  )
})

// Keep ?q= in step with the search. The initial value is read from the URL
// above, so there is nothing to sync before the first change.
watch(activeQuery, (q) => {
  router.replace({ query: q ? { q } : {} })
})
</script>

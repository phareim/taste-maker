<template>
  <main class="max-w-3xl mx-auto px-5 pb-32 pt-10">
    <header>
      <MonoLabel dash>Palette</MonoLabel>
      <h1 class="mt-1 text-3xl">The refined canon</h1>
      <p v-if="loaded" class="mt-2 text-mute">
        {{ canonItems.length }} kept out of everything captured.
      </p>
    </header>
    <HairlineRule class="mt-6" />

    <p v-if="loading && !loaded" class="mt-20 text-center text-mute italic">Loading…</p>

    <div v-else-if="canonItems.length === 0" class="mt-24 text-center">
      <p class="text-mute italic">Nothing has earned its place yet.</p>
      <NuxtLink to="/refine" class="inline-block mt-4">
        <ActionLabel accent>Start refining</ActionLabel>
      </NuxtLink>
    </div>

    <template v-else>
      <section
        v-for="(group, gi) in groups"
        :key="group.kind"
        :class="gi === 0 ? 'mt-12' : 'mt-20'"
      >
        <MonoLabel dash>{{ group.label }}</MonoLabel>
        <HairlineRule class="mt-3" />

        <div :class="groupContainerClass(group.kind)">
          <div
            v-for="item in group.items"
            :id="`item-${item.id}`"
            :key="item.id"
            class="relative transition-all duration-700 ease-out"
            :class="[
              settlingId === item.id ? 'scale-[1.03] ring-2 ring-accent ring-offset-4 ring-offset-paper' : 'scale-100',
              group.kind === 'quote' ? 'text-center' : '',
            ]"
          >
            <span
              v-if="item.promoted_via === 'manual'"
              class="absolute right-0 top-0 select-none text-faint"
              style="font-size: 9px;"
              title="fast-tracked to the palette"
              aria-hidden="true"
            >&#10022;</span>
            <NuxtLink :to="`/item/${item.id}`" class="block">
              <ItemCard :item="item" variant="palette" />
            </NuxtLink>
            <p
              v-if="dialogueLabel(item)"
              class="mt-2 text-mute italic"
              :class="group.kind === 'quote' ? 'text-center' : ''"
              style="font-size: 12px;"
            >in dialogue with: {{ dialogueLabel(item) }}</p>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import type { Connection, Kind, TasteItem } from '~/types/taste'

// Section order per the plan: Quotes / References / Music / Art.
const KIND_ORDER: Kind[] = ['quote', 'reference', 'music', 'art']
const KIND_LABELS: Record<Kind, string> = {
  quote: 'Quotes',
  reference: 'References',
  music: 'Music',
  art: 'Art',
}

const { list, connections: fetchConnections } = useItems()
const { showError } = useToast()
const route = useRoute()
const router = useRouter()

const canonItems = ref<TasteItem[]>([])
const allConnections = ref<Connection[]>([])
const loading = ref(false)
const loaded = ref(false)

// One-time larger/accented arrival state for ?highlight=<id> (the promotion
// moment handed off from /refine); cleared after it settles into place.
const settlingId = ref<string | null>(null)

const highlightId = computed(() => (typeof route.query.highlight === 'string' ? route.query.highlight : null))

const canonById = computed(() => new Map(canonItems.value.map((i) => [i.id, i])))

// "In dialogue with" — the constellation lines. /api/connections returns
// every edge unfiltered (personal scale); join client-side and keep only
// edges where BOTH endpoints are canon items.
const dialogueMap = computed(() => {
  const map = new Map<string, TasteItem[]>()
  for (const c of allConnections.value) {
    const a = canonById.value.get(c.from_id)
    const b = canonById.value.get(c.to_id)
    if (!a || !b) continue
    if (!map.has(a.id)) map.set(a.id, [])
    if (!map.has(b.id)) map.set(b.id, [])
    map.get(a.id)!.push(b)
    map.get(b.id)!.push(a)
  }
  return map
})

function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

function dialogueLabel(item: TasteItem): string {
  const others = dialogueMap.value.get(item.id)
  if (!others || !others.length) return ''
  return others.map((o) => o.title || truncate(o.body)).join(', ')
}

function groupContainerClass(kind: Kind): string {
  switch (kind) {
    case 'quote':
      // Pull-quotes, stacked, generous breathing room between them.
      return 'mt-8 flex flex-col gap-14'
    case 'art':
      // An image grid — the one place the palette reads as a wall, not a list.
      return 'mt-8 grid grid-cols-2 sm:grid-cols-3 gap-6'
    case 'music':
      return 'mt-8 flex flex-col gap-6'
    case 'reference':
    default:
      // Elegant typed rows — ItemCard's palette variant already sets the
      // per-row hairline, so the container itself needs no extra gap.
      return 'mt-6 flex flex-col'
  }
}

const groups = computed(() =>
  KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABELS[kind],
    items: canonItems.value
      .filter((i) => i.kind === kind)
      // Most fought-for leads: wins DESC, then created_at DESC. ISO8601
      // strings sort correctly with a plain lexical comparison.
      .sort((a, b) => b.wins - a.wins || b.created_at.localeCompare(a.created_at)),
  })).filter((g) => g.items.length > 0)
)

async function load() {
  loading.value = true
  try {
    const [items, conns] = await Promise.all([list({ status: 'canon' }), fetchConnections()])
    canonItems.value = items
    allConnections.value = conns
    loaded.value = true
  } catch {
    showError('Could not load the palette')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  if (highlightId.value) {
    settlingId.value = highlightId.value
    await nextTick()
    document.getElementById(`item-${highlightId.value}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => {
      settlingId.value = null
      // One-time only — drop the query param so a later reload/back-nav
      // doesn't replay the arrival on a now-stale target.
      const rest = { ...route.query }
      delete rest.highlight
      router.replace({ query: rest })
    }, 900)
  }
})
</script>

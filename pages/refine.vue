<template>
  <main class="max-w-2xl mx-auto px-5 pb-24 pt-8">
    <header class="flex items-baseline justify-between gap-4">
      <div>
        <MonoLabel dash>Refine</MonoLabel>
        <h1 class="mt-1 text-3xl">Which one stays with you?</h1>
      </div>
      <span
        v-if="streak > 0"
        class="font-mono text-faint shrink-0"
        style="font-size: 10px; letter-spacing: 0.16em;"
      >{{ streak }} this sitting</span>
    </header>
    <HairlineRule class="mt-4" />

    <!-- Kind pin -->
    <nav class="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Pin a kind">
      <button
        v-for="opt in KIND_PIN_OPTIONS"
        :key="opt.label"
        type="button"
        class="font-mono uppercase transition-colors"
        :class="[
          kindPin === opt.value ? 'text-accent-ink border-b border-accent' : 'text-mute hover:text-ink',
          wildcard ? 'opacity-40 pointer-events-none' : '',
        ]"
        style="font-size: 10px; letter-spacing: 0.16em;"
        :disabled="wildcard"
        @click="kindPin = opt.value"
      >{{ opt.label }}</button>
    </nav>

    <!-- Wildcard toggle — a deliberate provocation, not the default. -->
    <div class="mt-3 flex items-center gap-3">
      <button
        type="button"
        role="switch"
        :aria-checked="wildcard"
        class="border px-3 py-1.5 font-mono uppercase transition-colors"
        :class="wildcard ? 'border-accent text-accent-ink' : 'border-rule text-mute hover:border-rule-strong hover:text-ink'"
        style="font-size: 10px; letter-spacing: 0.16em; border-radius: 0;"
        @click="wildcard = !wildcard"
      >{{ wildcard ? '✓ Wildcard' : 'Wildcard' }}</button>
      <span class="font-mono text-faint" style="font-size: 10px; letter-spacing: 0.1em;">
        {{ wildcard ? 'crossing kinds, on purpose' : 'same kind by default' }}
      </span>
    </div>

    <!-- Initial load -->
    <p v-if="loading && !loaded" class="mt-16 text-center text-mute italic">Loading…</p>

    <!-- Insufficient pool -->
    <div v-else-if="!hasPair" class="mt-16 text-center">
      <p class="text-mute italic">Capture a couple more before refining.</p>
      <NuxtLink to="/capture" class="inline-block mt-4">
        <ActionLabel accent>Go capture something</ActionLabel>
      </NuxtLink>
    </div>

    <!-- The pair -->
    <div v-else class="mt-10">
      <div
        class="flex flex-col sm:flex-row items-stretch gap-8 sm:gap-0 transition-opacity duration-300"
        :class="loading ? 'opacity-40' : 'opacity-100'"
      >
        <div class="flex-1 flex flex-col items-center gap-3 min-w-0">
          <div
            class="w-full p-1 transition-colors duration-500"
            :class="arrivingId && arrivingId === pairData?.a?.id ? 'border-2 border-accent' : 'border-2 border-transparent'"
          >
            <ItemCard v-if="pairData?.a" :item="pairData.a" variant="card" />
          </div>
          <p v-if="pairData?.a" class="font-mono text-faint" style="font-size: 10px; letter-spacing: 0.16em;">
            {{ winMarks(pairData.a) }} &middot; {{ pairData.a.wins }}/{{ PROMOTE_THRESHOLD }}
          </p>
          <p v-if="farewellId && pairData?.a && farewellId === pairData.a.id" class="text-mute italic text-sm text-center">
            let go &mdash; it can be recalled from the library
          </p>
          <ActionLabel
            v-else
            accent
            :disabled="busy || !pairData?.a"
            @click="pairData?.a && pairData?.b && choose(pairData.a, pairData.b)"
          >Pick &mdash; &larr;</ActionLabel>
        </div>

        <div class="hidden sm:flex flex-col items-center justify-center px-6 shrink-0">
          <span class="font-mono text-faint" style="font-size: 10px; letter-spacing: 0.2em;">vs</span>
        </div>

        <div class="flex-1 flex flex-col items-center gap-3 min-w-0">
          <div
            class="w-full p-1 transition-colors duration-500"
            :class="arrivingId && arrivingId === pairData?.b?.id ? 'border-2 border-accent' : 'border-2 border-transparent'"
          >
            <ItemCard v-if="pairData?.b" :item="pairData.b" variant="card" />
          </div>
          <p v-if="pairData?.b" class="font-mono text-faint" style="font-size: 10px; letter-spacing: 0.16em;">
            {{ winMarks(pairData.b) }} &middot; {{ pairData.b.wins }}/{{ PROMOTE_THRESHOLD }}
          </p>
          <p v-if="farewellId && pairData?.b && farewellId === pairData.b.id" class="text-mute italic text-sm text-center">
            let go &mdash; it can be recalled from the library
          </p>
          <ActionLabel
            v-else
            accent
            :disabled="busy || !pairData?.b"
            @click="pairData?.a && pairData?.b && choose(pairData.b, pairData.a)"
          >Pick &mdash; &rarr;</ActionLabel>
        </div>
      </div>

      <div class="mt-10 flex flex-col items-center gap-2">
        <ActionLabel :disabled="busy || !hasPair" @click="skip">Skip</ActionLabel>
        <p class="font-mono text-faint" style="font-size: 10px; letter-spacing: 0.12em;">
          &larr; pick &nbsp;&middot;&nbsp; space skip &nbsp;&middot;&nbsp; pick &rarr;
        </p>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import type { Kind, TasteItem } from '~/types/taste'
import type { RefinePair } from '~/composables/useItems'

// Mirrors server/utils/refine.ts PROMOTE_THRESHOLD — kept as a small local
// display constant since server/ utils aren't importable from a page.
const PROMOTE_THRESHOLD = 3

const KIND_PIN_OPTIONS: Array<{ value: Kind | null; label: string }> = [
  { value: null, label: 'Any' },
  { value: 'quote', label: 'Quote' },
  { value: 'reference', label: 'Reference' },
  { value: 'music', label: 'Music' },
  { value: 'art', label: 'Art' },
]

const { refinePair, refinePick } = useItems()
const { showError } = useToast()
const router = useRouter()

const kindPin = ref<Kind | null>(null)
const wildcard = ref(false)

const pairData = ref<RefinePair | null>(null)
const loading = ref(false)
const loaded = ref(false)
const busy = ref(false)
const streak = ref(0)
const arrivingId = ref<string | null>(null)
const farewellId = ref<string | null>(null)

const hasPair = computed(() => !!(pairData.value?.a && pairData.value?.b))

function winMarks(item: TasteItem): string {
  const filled = Math.min(item.wins, PROMOTE_THRESHOLD)
  return '●'.repeat(filled) + '○'.repeat(Math.max(PROMOTE_THRESHOLD - filled, 0))
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadPair() {
  loading.value = true
  farewellId.value = null
  arrivingId.value = null
  try {
    pairData.value = await refinePair({
      kind: wildcard.value ? undefined : kindPin.value || undefined,
      mix: wildcard.value,
    })
    loaded.value = true
  } catch {
    showError('Could not load a pair')
    pairData.value = null
  } finally {
    loading.value = false
  }
}

async function choose(winner: TasteItem, loser: TasteItem) {
  if (busy.value || !hasPair.value) return
  busy.value = true
  try {
    const result = await refinePick(winner.id, loser.id)
    streak.value += 1

    if (result.promoted) {
      // Promotion is an arrival, not a toast: hold the winner in the accent
      // for a beat before it leaves the ritual for the palette.
      arrivingId.value = winner.id
      await wait(600)
      router.push(`/palette?highlight=${winner.id}`)
      return
    }

    if (result.archived) {
      // Archival is a quiet "let go", not a delete — a farewell line, then move on.
      farewellId.value = loser.id
      await wait(1400)
      await loadPair()
      return
    }

    await loadPair()
  } catch {
    showError('Could not record that pick')
  } finally {
    busy.value = false
  }
}

async function skip() {
  if (busy.value || !hasPair.value) return
  busy.value = true
  try {
    await loadPair()
  } finally {
    busy.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (busy.value || !hasPair.value || !pairData.value?.a || !pairData.value?.b) return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    choose(pairData.value.a, pairData.value.b)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    choose(pairData.value.b, pairData.value.a)
  } else if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault()
    skip()
  }
}

watch([kindPin, wildcard], () => {
  if (!busy.value) loadPair()
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  loadPair()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

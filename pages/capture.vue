<template>
  <main class="max-w-2xl mx-auto px-5 pb-24 pt-8">
    <header>
      <MonoLabel dash>Capture</MonoLabel>
      <h1 class="mt-1 text-3xl">Add to the library</h1>
    </header>
    <HairlineRule class="mt-4" desk />

    <!-- The form is one sheet of paper lying on the desk; the header above
         sits on the desk itself. -->
    <div class="tufte-sheet page-sheet mt-5 px-5 py-6 sm:px-7 sm:py-7">
    <form class="space-y-6" @submit.prevent="submit" @keydown.meta.enter.prevent="submit" @keydown.ctrl.enter.prevent="submit">
      <!-- Source leads: pasting a link is the fast path. The server looks at
           the page, decides the kind, and fills what it can. -->
      <div>
        <MonoLabel>Source URL</MonoLabel>
        <input
          v-model="sourceUrl"
          type="url"
          class="tufte-input mt-1"
          placeholder="Paste a link — the form fills itself"
        />
        <p
          class="mt-1.5 font-mono text-mute"
          style="font-size: 10px; letter-spacing: 0.12em; min-height: 15px;"
          aria-live="polite"
        >
          <template v-if="enriching">looking at the page&hellip;</template>
          <template v-else-if="detection">{{ detection.reason }}</template>
        </p>
      </div>

      <!-- Kind: when the source already told us, state it instead of asking.
           The pills only appear while the kind is genuinely the user's call. -->
      <div v-if="kindLocked" class="flex items-baseline gap-2">
        <MonoLabel accent>&mdash;&nbsp;{{ kindLabel }}</MonoLabel>
      </div>
      <div v-else class="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind">
        <button
          v-for="k in KIND_OPTIONS"
          :key="k.value"
          type="button"
          role="radio"
          :aria-checked="kind === k.value"
          class="action-label border px-3 py-1.5 font-mono uppercase transition-colors"
          :class="kind === k.value ? 'action-label--accent border-accent text-accent-ink' : 'border-rule text-mute hover:border-rule-strong hover:text-ink'"
          style="font-size: 10px; letter-spacing: 0.16em; border-radius: 0;"
          @click="kind = k.value"
        >{{ k.label }}</button>
      </div>

      <div>
        <MonoLabel>{{ bodyLabel }}</MonoLabel>
        <textarea
          ref="bodyInput"
          v-model="body"
          class="tufte-input mt-1 resize-none"
          rows="4"
          :placeholder="bodyPlaceholder"
        />
      </div>

      <!-- For music the track name IS the body ("Track"), so a separate short
           title carries nothing — the field only shows for the other kinds. -->
      <div v-if="kind !== 'music'">
        <MonoLabel>Title</MonoLabel>
        <input v-model="title" type="text" class="tufte-input mt-1" placeholder="Optional short title" />
      </div>

      <div>
        <MonoLabel>{{ creatorLabel }}</MonoLabel>
        <input v-model="creator" type="text" class="tufte-input mt-1" placeholder="Author / artist / attribution" />
      </div>

      <!-- The image field shows its image: a thumbnail sits beside the URL the
           moment it loads, so a hotlink is never a blind paste. -->
      <div>
        <MonoLabel>Image URL</MonoLabel>
        <div class="mt-1 flex items-end gap-3">
          <div
            v-if="imageUrl.trim() && !thumbFailed"
            class="shrink-0 w-12 h-12 border border-rule-strong bg-paper-sunk overflow-hidden"
          >
            <img
              :src="imageUrl.trim()"
              alt=""
              class="w-full h-full object-cover"
              @error="thumbFailed = true"
              @load="thumbFailed = false"
            />
          </div>
          <input v-model="imageUrl" type="url" class="tufte-input" placeholder="Optional — https://…" />
        </div>
      </div>

      <div>
        <MonoLabel>Note</MonoLabel>
        <textarea v-model="note" class="tufte-input mt-1 resize-none" rows="2" placeholder="Why it strikes me" />
      </div>

      <!-- The item as the library will render it, live. This is where a
           Spotify paste shows its cover before anything is saved. -->
      <div v-if="showPreview">
        <MonoLabel dash>Preview</MonoLabel>
        <ItemCard :item="previewItem" variant="card" class="mt-2" />
      </div>

      <footer class="flex items-center justify-between pt-2">
        <MonoLabel class="hidden sm:inline">&#8984;&#9166; to submit</MonoLabel>
        <ActionLabel accent :disabled="!canSubmit || submitting" @click="submit">{{ submitting ? 'Saving…' : 'Capture' }}</ActionLabel>
      </footer>
    </form>
    </div>
  </main>
</template>

<script setup lang="ts">
import type { Kind, TasteItem } from '~/types/taste'

const KIND_OPTIONS: Array<{ value: Kind; label: string }> = [
  { value: 'quote', label: 'Quote' },
  { value: 'reference', label: 'Reference' },
  { value: 'music', label: 'Music' },
  { value: 'art', label: 'Art' },
  { value: 'clothing', label: 'Clothing' },
]

const { create } = useItems()
const { showSuccess, showError } = useToast()

const kind = ref<Kind>('quote')
const title = ref('')
const body = ref('')
const sourceUrl = ref('')
const creator = ref('')
const note = ref('')
const imageUrl = ref('')
const submitting = ref(false)
const thumbFailed = ref(false)
const bodyInput = ref<HTMLTextAreaElement | null>(null)

const bodyLabel = computed(() => (kind.value === 'quote' ? 'Quote' : isImageKind.value ? 'Description' : kind.value === 'music' ? 'Track' : 'Body'))
const isImageKind = computed(() => kind.value === 'art' || kind.value === 'clothing')
const creatorLabel = computed(() => (kind.value === 'clothing' ? 'Brand' : 'Creator'))
const bodyPlaceholder = computed(() => {
  switch (kind.value) {
    case 'quote': return 'The words themselves — required'
    case 'art':
    case 'clothing': return 'What it is, in a sentence — required'
    case 'music': return 'Track / album — required'
    default: return 'Short description — required'
  }
})

const canSubmit = computed(() => body.value.trim().length > 0)

// ————— Enrichment: the same server ladder the iOS Share Extension uses.
// Only `high` confidence locks the kind (hiding the pills); `medium` merely
// preselects one. Field autofill never clobbers something the user typed —
// it only writes into a field that is empty or still holds the previous
// autofill.

interface EnrichResult {
  kind: Kind | null
  kind_confidence: 'high' | 'medium' | 'low'
  kind_reason: string
  title: string | null
  creator: string | null
  image_url: string | null
  source_url: string | null
}

const detection = ref<{ kind: Kind; reason: string } | null>(null)
const kindLocked = ref(false)
const enriching = ref(false)
const kindLabel = computed(() => KIND_OPTIONS.find((k) => k.value === kind.value)?.label ?? kind.value)

const autofilled: Record<'title' | 'body' | 'creator' | 'imageUrl', string> = { title: '', body: '', creator: '', imageUrl: '' }
function autofill(field: Ref<string>, key: keyof typeof autofilled, value: string | null) {
  if (!value) return
  if (!field.value.trim() || field.value === autofilled[key]) {
    field.value = value
    autofilled[key] = value
  }
}

function looksLikeUrl(raw: string): boolean {
  return /^https?:\/\/\S+\.\S+/.test(raw)
}

let enrichSeq = 0
async function enrich(url: string) {
  const seq = ++enrichSeq
  enriching.value = true
  try {
    const r = await $fetch<EnrichResult>('/api/ingest/enrich', { method: 'POST', body: { url } })
    if (seq !== enrichSeq) return
    detection.value = r.kind ? { kind: r.kind, reason: r.kind_reason } : null
    if (r.kind && r.kind_confidence === 'high') {
      kind.value = r.kind
      kindLocked.value = true
    } else {
      kindLocked.value = false
      if (r.kind && r.kind_confidence === 'medium') kind.value = r.kind
    }
    // For music the enriched title IS the track — the required body field.
    if (r.kind === 'music') autofill(body, 'body', r.title)
    else autofill(title, 'title', r.title)
    autofill(creator, 'creator', r.creator)
    autofill(imageUrl, 'imageUrl', r.image_url)
  } catch {
    // Enrichment is an enhancement, never a blocker — the form stands as-is.
  } finally {
    if (seq === enrichSeq) enriching.value = false
  }
}

// Debounce so we look at the page once per paste, not once per keystroke.
// `settledSourceUrl` is also what the preview card consumes, keeping its
// oEmbed lookup on the same cadence.
const settledSourceUrl = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(sourceUrl, (raw) => {
  clearTimeout(debounceTimer)
  const trimmed = raw.trim()
  if (!looksLikeUrl(trimmed)) {
    enrichSeq++ // cancel any in-flight lookup
    enriching.value = false
    detection.value = null
    kindLocked.value = false
    settledSourceUrl.value = ''
    return
  }
  debounceTimer = setTimeout(() => {
    settledSourceUrl.value = trimmed
    enrich(trimmed)
  }, 500)
})
watch(imageUrl, () => {
  thumbFailed.value = false
})

// ————— Live preview: the exact card the library will render, built from the
// form as it stands. ItemCard owns the per-kind treatment (and the music
// oEmbed thumbnail), so the preview can never drift from the real thing.
const previewItem = computed<TasteItem>(() => ({
  id: 'preview',
  kind: kind.value,
  title: kind.value === 'music' ? null : title.value.trim() || null,
  body: body.value.trim() || title.value.trim() || '…',
  source_url: settledSourceUrl.value || null,
  creator: creator.value.trim() || null,
  note: note.value.trim() || null,
  image_url: imageUrl.value.trim() || null,
  status: 'captured',
  wins: 0,
  losses: 0,
  promoted_via: null,
  created_at: '',
  updated_at: '',
}))
const showPreview = computed(() =>
  Boolean(
    body.value.trim() ||
    imageUrl.value.trim() ||
    (kind.value === 'music' && settledSourceUrl.value)
  )
)

function resetForm() {
  title.value = ''
  body.value = ''
  sourceUrl.value = ''
  creator.value = ''
  note.value = ''
  imageUrl.value = ''
  detection.value = null
  kindLocked.value = false
  settledSourceUrl.value = ''
  thumbFailed.value = false
  autofilled.title = autofilled.body = autofilled.creator = autofilled.imageUrl = ''
}

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  try {
    await create({
      kind: kind.value,
      body: body.value.trim(),
      // A title typed before the kind settled on music must not ride along.
      title: kind.value === 'music' ? null : title.value.trim() || null,
      source_url: sourceUrl.value.trim() || null,
      creator: creator.value.trim() || null,
      note: note.value.trim() || null,
      image_url: imageUrl.value.trim() || null,
    })
    showSuccess('Captured')
    resetForm()
    // Keep focus on the body field so rapid-fire capture never touches the mouse.
    nextTick(() => bodyInput.value?.focus())
  } catch {
    showError('Could not save the item')
  } finally {
    submitting.value = false
  }
}
</script>

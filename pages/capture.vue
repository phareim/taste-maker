<template>
  <main class="max-w-2xl mx-auto px-5 pb-24 pt-8">
    <header>
      <MonoLabel dash>Capture</MonoLabel>
      <h1 class="mt-1 text-3xl">Add to the library</h1>
    </header>
    <HairlineRule class="mt-4" />

    <!-- Kind selector -->
    <div class="mt-6 flex flex-wrap gap-2" role="radiogroup" aria-label="Kind">
      <button
        v-for="k in KINDS"
        :key="k.value"
        type="button"
        role="radio"
        :aria-checked="kind === k.value"
        class="border px-3 py-1.5 font-mono uppercase transition-colors"
        :class="kind === k.value ? 'border-accent text-accent-ink' : 'border-rule text-mute hover:border-rule-strong hover:text-ink'"
        style="font-size: 10px; letter-spacing: 0.16em; border-radius: 0;"
        @click="kind = k.value"
      >{{ k.label }}</button>
    </div>

    <form class="mt-8 space-y-6" @submit.prevent="submit" @keydown.meta.enter.prevent="submit" @keydown.ctrl.enter.prevent="submit">
      <div>
        <MonoLabel>Title</MonoLabel>
        <input v-model="title" type="text" class="tufte-input mt-1" placeholder="Optional short title" />
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

      <!-- Image URL is always available (hotlinked, no uploads), but only
           promoted to a prominent position when the kind is art — for the
           other three kinds it still lives in the form, just further down. -->
      <div v-if="kind === 'art'">
        <MonoLabel>Image URL</MonoLabel>
        <input v-model="imageUrl" type="url" class="tufte-input mt-1" placeholder="https://…" />
      </div>

      <div>
        <MonoLabel>Source URL</MonoLabel>
        <input v-model="sourceUrl" type="url" class="tufte-input mt-1" :placeholder="sourcePlaceholder" />
      </div>

      <div>
        <MonoLabel>Creator</MonoLabel>
        <input v-model="creator" type="text" class="tufte-input mt-1" placeholder="Author / artist / attribution" />
      </div>

      <div v-if="kind !== 'art'">
        <MonoLabel>Image URL</MonoLabel>
        <input v-model="imageUrl" type="url" class="tufte-input mt-1" placeholder="Optional — https://…" />
      </div>

      <div>
        <MonoLabel>Note</MonoLabel>
        <textarea v-model="note" class="tufte-input mt-1 resize-none" rows="2" placeholder="Why it strikes me" />
      </div>

      <footer class="flex items-center justify-between pt-2">
        <MonoLabel class="hidden sm:inline">&#8984;&#9166; to submit</MonoLabel>
        <ActionLabel accent :disabled="!canSubmit || submitting" @click="submit">{{ submitting ? 'Saving…' : 'Capture' }}</ActionLabel>
      </footer>
    </form>
  </main>
</template>

<script setup lang="ts">
import type { Kind } from '~/types/taste'

const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'quote', label: 'Quote' },
  { value: 'reference', label: 'Reference' },
  { value: 'music', label: 'Music' },
  { value: 'art', label: 'Art' },
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
const bodyInput = ref<HTMLTextAreaElement | null>(null)

const bodyLabel = computed(() => (kind.value === 'quote' ? 'Quote' : kind.value === 'art' ? 'Description' : 'Body'))
const bodyPlaceholder = computed(() => {
  switch (kind.value) {
    case 'quote': return 'The words themselves — required'
    case 'art': return 'What it is, in a sentence — required'
    case 'music': return 'Track / album — required'
    default: return 'Short description — required'
  }
})
const sourcePlaceholder = computed(() =>
  kind.value === 'music' ? 'Spotify / YouTube link' : 'https://…'
)

const canSubmit = computed(() => body.value.trim().length > 0)

function resetForm() {
  title.value = ''
  body.value = ''
  sourceUrl.value = ''
  creator.value = ''
  note.value = ''
  imageUrl.value = ''
}

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  try {
    await create({
      kind: kind.value,
      body: body.value.trim(),
      title: title.value.trim() || null,
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

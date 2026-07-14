<template>
  <!--
    Kind-true rendering dispatch — the plan's stated differentiator: no two
    kinds share an identical treatment. `variant` controls size/context:
    'card' (library grid), 'large' (item detail page), 'palette' (canon view,
    airier, no frame). This file is the single source of truth other stages
    (item page, palette page) reuse rather than reimplementing per-kind markup.
  -->
  <div
    :class="[
      framed ? 'border border-rule-strong bg-paper-raised overflow-hidden' : '',
      isPalette ? 'palette-card' : '',
    ]"
  >
    <!-- QUOTE — pull-quote typography, the loudest text treatment. Type size
         steps down with length so the whole passage stays visible; a generous
         line-clamp is the safety rail against multi-page pastes. -->
    <blockquote v-if="item.kind === 'quote'" :class="isPalette ? 'py-2' : 'p-4 sm:p-5'">
      <p
        :class="[
          'text-ink',
          isCard ? quoteCardClasses : '',
          isLarge ? quoteLargeClasses : '',
          isPalette ? [quotePaletteClasses, 'text-center italic'] : '',
        ]"
      ><span class="text-accent-ink mr-0.5" aria-hidden="true">&ldquo;</span>{{ item.body }}<span class="text-accent-ink ml-0.5" aria-hidden="true">&rdquo;</span></p>
      <footer
        v-if="item.creator || item.title"
        class="mt-3 font-mono text-mute"
        :class="isPalette ? 'text-center' : ''"
        style="font-size: 11px; letter-spacing: 0.08em;"
      >&mdash;&nbsp;{{ item.creator || item.title }}</footer>
      <p v-if="isLarge && item.note" class="mt-4 text-body italic">{{ item.note }}</p>
    </blockquote>

    <!-- ART — image dominant; caption sits below, bled edge-to-edge above it. -->
    <div v-else-if="item.kind === 'art'">
      <div
        :class="[
          'bg-paper-sunk overflow-hidden',
          isCard ? 'aspect-[4/3]' : '',
          isLarge ? 'aspect-[16/10]' : '',
          isPalette ? 'aspect-square' : '',
        ]"
      >
        <img
          v-if="item.image_url && !imgFailed"
          :src="item.image_url"
          :alt="item.title || item.body"
          class="w-full h-full object-cover"
          loading="lazy"
          @error="imgFailed = true"
        />
        <div v-else class="w-full h-full flex items-center justify-center text-faint" style="font-size: 2rem;" aria-hidden="true">&#9638;</div>
      </div>
      <div :class="isPalette ? 'pt-2' : 'p-4 sm:p-5'">
        <p v-if="item.title" class="text-ink" :class="isLarge ? 'text-xl' : ''">{{ item.title }}</p>
        <p v-else class="text-body" :class="isCard ? 'line-clamp-2' : ''">{{ item.body }}</p>
        <MonoLabel v-if="item.creator" class="mt-1">{{ item.creator }}</MonoLabel>
        <p v-if="isLarge && item.note" class="mt-3 text-body italic">{{ item.note }}</p>
      </div>
    </div>

    <!-- MUSIC — oEmbed thumbnail when the source_url resolves (YouTube/Spotify,
         no-auth public endpoints); graceful glyph fallback otherwise. This is a
         thumbnail lookup only, not URL extraction. -->
    <div v-else-if="item.kind === 'music'" :class="isPalette ? 'flex items-center gap-3' : 'flex gap-0'">
      <div
        :class="[
          'bg-paper-sunk overflow-hidden shrink-0 relative flex items-center justify-center',
          isCard ? 'w-28 h-28' : '',
          isLarge ? 'w-full sm:w-64 aspect-square sm:aspect-auto sm:h-64' : '',
          isPalette ? 'w-16 h-16' : '',
        ]"
      >
        <img
          v-if="oembed?.thumbnail_url"
          :src="oembed.thumbnail_url"
          :alt="oembed.title || item.title || item.body"
          class="w-full h-full object-cover"
          loading="lazy"
        />
        <span v-else class="text-faint" style="font-size: 1.75rem;" aria-hidden="true">&#9835;</span>
        <span
          v-if="oembed?.thumbnail_url"
          class="absolute inset-0 flex items-center justify-center bg-black/10 text-white"
          aria-hidden="true"
        ><span style="font-size: 1rem;">&#9658;</span></span>
      </div>
      <div class="p-3 sm:p-4 min-w-0 flex-1">
        <p class="text-ink truncate" :class="isLarge ? 'text-xl' : ''">{{ oembed?.title || item.title || item.body }}</p>
        <MonoLabel v-if="oembed?.author_name || item.creator" class="mt-1">{{ oembed?.author_name || item.creator }}</MonoLabel>
        <p v-if="isLarge && item.note" class="mt-3 text-body italic">{{ item.note }}</p>
      </div>
    </div>

    <!-- REFERENCE — typed index-card row; deliberately un-quote, un-music. -->
    <div v-else :class="isPalette ? 'py-2 border-b border-rule' : 'p-4 sm:p-5'">
      <MonoLabel accent class="font-bold">Reference</MonoLabel>
      <p class="mt-1 text-ink" :class="isLarge ? 'text-xl' : (isCard ? 'line-clamp-3' : '')">
        {{ item.title || item.body }}
      </p>
      <p v-if="item.title && isLarge" class="mt-1 text-body">{{ item.body }}</p>
      <div class="mt-1 flex flex-wrap items-baseline gap-x-2">
        <MonoLabel v-if="item.creator">{{ item.creator }}</MonoLabel>
        <a
          v-if="item.source_url"
          :href="item.source_url"
          target="_blank"
          rel="noopener noreferrer"
          class="font-mono text-mute hover:text-accent-ink"
          style="font-size: 10px; letter-spacing: 0.1em;"
          @click.stop
        >source&nbsp;&#8599;</a>
      </div>
      <p v-if="isLarge && item.note" class="mt-3 text-body italic">{{ item.note }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TasteItem } from '~/types/taste'

const props = withDefaults(
  defineProps<{
    item: TasteItem
    /** 'card' = library grid, 'large' = item detail page, 'palette' = canon view (airy, unframed). */
    variant?: 'card' | 'large' | 'palette'
  }>(),
  { variant: 'card' }
)

const isCard = computed(() => props.variant === 'card')
const isLarge = computed(() => props.variant === 'large')
const isPalette = computed(() => props.variant === 'palette')
// Palette reads as a constellation, not a grid — no card frame there.
const framed = computed(() => !isPalette.value)

// Quote type scale by passage length: short quotes keep the loud pull-quote
// treatment; longer ones trade size for completeness. The clamp ceilings are
// the "three whole pages" guard — roughly 1000+ visible chars before cutoff.
const quoteTier = computed<'short' | 'medium' | 'long'>(() => {
  const len = props.item.body?.length ?? 0
  return len <= 180 ? 'short' : len <= 600 ? 'medium' : 'long'
})
const quoteCardClasses = computed(() => ({
  short: 'text-base sm:text-lg leading-snug',
  medium: 'text-sm sm:text-base leading-normal',
  long: 'text-sm leading-normal',
})[quoteTier.value] + ' line-clamp-[16]')
const quoteLargeClasses = computed(() => ({
  short: 'text-2xl sm:text-3xl leading-snug',
  medium: 'text-xl sm:text-2xl leading-snug',
  long: 'text-base sm:text-lg leading-normal',
})[quoteTier.value])
const quotePaletteClasses = computed(() => ({
  short: 'text-2xl sm:text-3xl leading-snug',
  medium: 'text-xl sm:text-2xl leading-snug',
  long: 'text-base sm:text-lg leading-normal line-clamp-[12]',
})[quoteTier.value])

const imgFailed = ref(false)

interface OEmbedData {
  title?: string
  thumbnail_url?: string
  author_name?: string
}
const oembed = ref<OEmbedData | null>(null)

// Public, no-auth oEmbed endpoints for a thumbnail lookup only — this is
// deliberately NOT URL auto-extraction (that's out of scope for v1).
function oembedEndpoint(url: string): string | null {
  if (/youtu\.be\/|youtube\.com\/(watch|embed|shorts)/i.test(url)) {
    return `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
  }
  if (/open\.spotify\.com\//i.test(url)) {
    return `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`
  }
  return null
}

async function loadOEmbed() {
  oembed.value = null
  if (props.item.kind !== 'music' || !props.item.source_url) return
  const endpoint = oembedEndpoint(props.item.source_url)
  if (!endpoint) return // graceful fallback to the music glyph — not every source resolves
  try {
    oembed.value = await $fetch<OEmbedData>(endpoint, { timeout: 6000 } as any)
  } catch {
    oembed.value = null // fallback glyph card
  }
}

onMounted(() => {
  if (import.meta.client) loadOEmbed()
})
watch(
  () => props.item.source_url,
  () => {
    if (import.meta.client) loadOEmbed()
  }
)
</script>

<template>
  <header class="max-w-2xl mx-auto px-5 pt-6">
    <div class="flex items-center justify-between gap-4">
      <NuxtLink to="/" class="no-underline">
        <MonoLabel dash>taste-maker</MonoLabel>
      </NuxtLink>
      <nav class="flex items-center gap-4" aria-label="Main">
        <NuxtLink
          v-for="link in LINKS"
          :key="link.to"
          :to="link.to"
          class="font-mono uppercase transition-colors"
          :class="isActive(link.to) ? 'text-accent-ink' : 'text-mute hover:text-ink'"
          style="font-size: 10px; letter-spacing: 0.16em;"
        >{{ link.label }}</NuxtLink>
      </nav>
    </div>
    <HairlineRule class="mt-4" />
  </header>
</template>

<script setup lang="ts">
const route = useRoute()

const LINKS = [
  { to: '/', label: 'Library' },
  { to: '/capture', label: 'Capture' },
  { to: '/refine', label: 'Refine' },
  { to: '/palette', label: 'Palette' },
]

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}
</script>

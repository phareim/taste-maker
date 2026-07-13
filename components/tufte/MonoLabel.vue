<template>
  <span
    class="font-mono uppercase text-mute"
    :class="accent ? 'text-accent-ink' : ''"
    style="font-size: 10px; letter-spacing: 0.16em;"
  ><template v-if="dash">&mdash;&nbsp;</template><slot /></span>
</template>

<script setup lang="ts">
defineProps<{
  /** Leading em-dash, the Tufte/Almanac section-label convention. */
  dash?: boolean
  /** Promote to the screen's single accent. */
  accent?: boolean
}>()
</script>

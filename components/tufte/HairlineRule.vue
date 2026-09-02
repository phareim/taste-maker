<template>
  <hr class="hairline border-0 border-t" :class="[strong ? 'border-rule-strong' : 'border-rule', desk ? 'hairline--desk' : '']" />
</template>

<script setup lang="ts">
defineProps<{
  strong?: boolean
  /** The rule sits on the desk, not on a sheet — embossed instead of debossed under the tactile layer. */
  desk?: boolean
}>()
</script>

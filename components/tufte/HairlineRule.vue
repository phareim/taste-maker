<template>
  <hr class="border-0 border-t" :class="strong ? 'border-rule-strong' : 'border-rule'" />
</template>

<script setup lang="ts">
defineProps<{ strong?: boolean }>()
</script>

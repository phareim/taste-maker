<template>
  <Transition name="toast">
    <div
      v-if="success || error"
      class="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 border bg-paper-raised px-4 py-2"
      :class="error ? 'border-accent' : 'border-rule-strong'"
    >
      <MonoLabel :accent="!!error" dash>{{ success || error }}</MonoLabel>
    </div>
  </Transition>
</template>

<script setup lang="ts">
const { success, error } = useToast()
</script>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 6px); }
</style>

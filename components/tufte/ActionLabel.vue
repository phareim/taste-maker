<template>
  <button
    type="button"
    class="border font-mono uppercase transition-colors duration-150 select-none disabled:opacity-40 disabled:cursor-not-allowed"
    :class="[
      accent
        ? 'border-accent text-accent-ink'
        : 'border-rule text-mute hover:border-rule-strong hover:text-ink',
      $slots.icon ? 'px-2.5 py-1.5 sm:px-3' : 'px-3 py-1.5',
    ]"
    style="font-size: 10px; letter-spacing: 0.16em; border-radius: 0;"
    :disabled="disabled"
    @click="emit('click')"
  ><!-- With an icon slot, the glyph carries the button on narrow screens and
       the text label takes over from sm: up. Without one, text label always. -->
    <span v-if="$slots.icon" class="flex items-center justify-center sm:hidden" aria-hidden="true"><slot name="icon" /></span>
    <span :class="$slots.icon ? 'hidden sm:inline' : undefined">&mdash;&nbsp;<slot /></span>
  </button>
</template>

<script setup lang="ts">
defineProps<{ accent?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ click: [] }>()
</script>

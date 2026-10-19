<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
defineProps<{ titulo: string }>();
const emit = defineEmits<{ fechar: [] }>();
const dialog = ref<HTMLDialogElement>();
// <dialog> nativo: foco preso, ESC e acessibilidade de graça
onMounted(() => dialog.value?.showModal());
onUnmounted(() => dialog.value?.close());
</script>

<template>
  <dialog ref="dialog" class="modal" @cancel.prevent="emit('fechar')" @click.self="emit('fechar')">
    <div class="corpo">
      <header>
        <h2>{{ titulo }}</h2>
        <button class="btn link" type="button" @click="emit('fechar')">Fechar</button>
      </header>
      <slot />
    </div>
  </dialog>
</template>

<style scoped>
.modal { border: 0; padding: 0; background: transparent; max-width: 560px; width: calc(100vw - 24px); max-height: calc(100dvh - 24px); }
.modal::backdrop { background: rgba(12, 22, 21, 0.5); }
.corpo { background: var(--surface); color: var(--ink); border-radius: var(--raio-m); padding: 20px; display: grid; gap: 16px; }
header { display: flex; justify-content: space-between; align-items: center; }
@media (max-width: 760px) {
  .modal { margin: auto 0 0; width: 100vw; max-width: 100vw; }
  .corpo { border-radius: var(--raio-m) var(--raio-m) 0 0; padding-bottom: calc(20px + env(safe-area-inset-bottom)); }
}
</style>

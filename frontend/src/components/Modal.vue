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
        <button class="fechar" type="button" aria-label="Fechar" @click="emit('fechar')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div class="conteudo"><slot /></div>
    </div>
  </dialog>
</template>

<style scoped>
.modal { border: 0; padding: 0; background: transparent; max-width: 580px; width: calc(100vw - 32px); max-height: calc(100dvh - 48px); overflow: visible; }
.modal::backdrop { background: rgba(10, 22, 18, 0.45); backdrop-filter: blur(2px); }
.modal[open] { animation: entra 0.18s ease-out; }
@keyframes entra { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
.corpo {
  background: var(--surface); color: var(--ink); border-radius: var(--raio-l); box-shadow: var(--sombra-flutuante);
  display: flex; flex-direction: column; max-height: calc(100dvh - 48px);
}
header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 20px 24px 14px; }
header h2 { font-size: 1.2rem; }
.conteudo { padding: 4px 24px 24px; overflow-y: auto; }
.fechar { width: 36px; height: 36px; border-radius: 10px; border: 0; background: var(--surface-3); color: var(--ink-2); display: grid; place-items: center; cursor: pointer; flex: none; }
.fechar:hover { color: var(--ink); background: var(--line); }
.fechar svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
@media (max-width: 760px) {
  .modal { margin: auto 0 0; width: 100vw; max-width: 100vw; max-height: 94dvh; }
  .modal[open] { animation-name: sobe; }
  @keyframes sobe { from { transform: translateY(24px); opacity: 0.6; } }
  .corpo { border-radius: var(--raio-l) var(--raio-l) 0 0; max-height: 94dvh; }
  header { padding: 18px 18px 10px; }
  .conteudo { padding: 4px 18px calc(18px + env(safe-area-inset-bottom)); }
}
</style>

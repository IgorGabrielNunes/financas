<script setup lang="ts">
// Entrada estilo caixa eletrônico: o usuário digita só números e o valor "anda" da direita
// (1 → 0,01 → 0,12 → 1,23). Sem vírgula/ponto para errar no teclado do celular.
import { computed } from 'vue';
const model = defineModel<number>({ required: true }); // centavos
const props = defineProps<{ id?: string; grande?: boolean }>();
const exibido = computed(() => (model.value / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  const digitos = el.value.replace(/\D/g, '').slice(0, 13);
  model.value = Number(digitos || '0');
  el.value = exibido.value;
}
</script>

<template>
  <div :class="['moeda', { grande: props.grande }]">
    <span aria-hidden="true">R$</span>
    <input :id="id" inputmode="numeric" autocomplete="off" :value="exibido" @input="onInput" />
  </div>
</template>

<style scoped>
.moeda { display: flex; align-items: center; border: 1px solid var(--line); border-radius: var(--raio-s); padding-left: 12px; background: var(--surface); }
.moeda:focus-within { outline: 2px solid var(--foco); outline-offset: -1px; }
.moeda span { color: var(--ink-3); font-weight: 600; }
.moeda input { border: 0; outline: none; text-align: right; font-weight: 600; }
.moeda input:focus { outline: none; }
.grande input { font: 700 2rem var(--display); padding: 8px 12px; }
</style>

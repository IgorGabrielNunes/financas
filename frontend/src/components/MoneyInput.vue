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
.moeda { display: flex; align-items: center; border: 1px solid var(--line-2); border-radius: var(--raio-s); padding-left: 14px; background: var(--surface); transition: border-color 0.12s, box-shadow 0.12s; }
.moeda:hover { border-color: var(--ink-3); }
.moeda:focus-within { border-color: var(--foco); box-shadow: 0 0 0 3px color-mix(in srgb, var(--foco) 22%, transparent); }
.moeda span { color: var(--ink-3); font-weight: 600; }
.moeda input { border: 0; outline: none; text-align: right; font-weight: 600; box-shadow: none !important; }
.moeda input:focus { outline: none; }
.grande { background: var(--surface-2); }
.grande input { font: 750 2.2rem var(--fonte); letter-spacing: -0.03em; padding: 10px 14px; background: transparent; }
.grande span { font-size: 1.1rem; }
</style>

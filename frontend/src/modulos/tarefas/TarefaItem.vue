<script setup lang="ts">
import { ref } from 'vue';
import { alternarFeita, type Tarefa } from './tipos';
import { avisar, avisarMudanca } from '../../core/store';
import { dataCurta, hoje } from '../../core/format';

const props = defineProps<{ t: Tarefa; mostrarData?: boolean }>();
const emit = defineEmits<{ abrir: [t: Tarefa] }>();
const ocupado = ref(false);

async function marcar() {
  if (ocupado.value) return;
  ocupado.value = true;
  try {
    await alternarFeita(props.t);
    avisarMudanca();
  } catch (e) { avisar((e as Error).message, 'erro'); } finally { ocupado.value = false; }
}
const quando = (d?: string | null) => {
  if (!d) return '';
  const h = hoje();
  if (d === h) return 'hoje';
  return dataCurta(d);
};
</script>

<template>
  <li :class="['tarefa', { feita: t.feita, atrasada: t.atrasada }]">
    <button class="check" :style="{ '--c': t.area_cor ?? 'var(--ink-3)' }" :aria-pressed="!!t.feita"
      :aria-label="t.feita ? `Desmarcar ${t.titulo}` : `Concluir ${t.titulo}`" :disabled="ocupado" @click="marcar">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>
    </button>
    <div class="corpo" @click="emit('abrir', t)">
      <div class="titulo">
        <span v-if="t.prioridade === 1" class="alta" title="Prioridade alta">!</span>{{ t.titulo }}
      </div>
      <div class="meta">
        <span v-if="t.atrasada" class="sai">atrasada desde {{ dataCurta(t.ocorrencia!) }}</span>
        <span v-else-if="mostrarData && t.ocorrencia">{{ quando(t.ocorrencia) }}</span>
        <span v-if="t.area_nome">{{ t.area_nome }}</span>
        <span v-if="t.descricao_repeticao">{{ t.descricao_repeticao }}</span>
        <span v-if="t.compartilhada" class="casa">da casa</span>
        <span v-if="t.responsavel_nome">com {{ t.responsavel_nome }}</span>
        <span v-if="t.feita && t.feita_por_nome">feita por {{ t.feita_por_nome }}</span>
      </div>
    </div>
  </li>
</template>

<style scoped>
.tarefa { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: center; padding: 10px 18px; position: relative; }
.tarefa + .tarefa::before { content: ''; position: absolute; top: 0; left: 58px; right: 18px; border-top: 1px solid var(--line); }
.corpo { cursor: pointer; min-width: 0; padding: 2px 0; }
.titulo { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { display: flex; flex-wrap: wrap; gap: 2px 10px; color: var(--ink-3); font-size: 0.8125rem; margin-top: 1px; }
.casa { color: var(--marca-tint-ink); font-weight: 600; }
.alta { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 6px; background: var(--sai-tint); color: var(--sai); font-weight: 800; font-size: 0.75rem; margin-right: 6px; vertical-align: 1px; }
.check {
  width: 28px; height: 28px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--c) 70%, var(--line-2));
  background: var(--surface); display: grid; place-items: center; cursor: pointer; padding: 0; color: transparent;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}
.check:hover { background: color-mix(in srgb, var(--c) 12%, var(--surface)); color: color-mix(in srgb, var(--c) 60%, transparent); }
.check svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.check[aria-pressed='true'] { background: var(--c); border-color: var(--c); color: #fff; }
.feita .titulo { text-decoration: line-through; color: var(--ink-3); }
.atrasada .check { border-color: var(--sai); }
/* toque: o círculo continua com 28px, mas a área clicável vira 44px */
.check { position: relative; }
.check::after { content: ''; position: absolute; inset: -10px; } /* 24px internos + 2×10 = 44px */
</style>

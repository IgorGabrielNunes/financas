<script setup lang="ts">
// Gráfico de linhas leve (SVG, sem biblioteca). Eixo Y começa no menor valor arredondado para baixo,
// com 4 linhas de grade; passar o dedo/mouse mostra os valores do ponto mais próximo.
import { computed, ref } from 'vue';

const props = defineProps<{
  series: { nome: string; cor: string; valores: number[]; tracejada?: boolean }[];
  rotulos: string[];                       // um por ponto (eixo X)
  formatar: (v: number) => string;
  altura?: number;
}>();

const W = 640, H = computed(() => props.altura ?? 220), M = { t: 12, r: 12, b: 26, l: 64 };
const n = computed(() => Math.max(...props.series.map((s) => s.valores.length), 1));
const escala = computed(() => {
  const todos = props.series.flatMap((s) => s.valores);
  let min = Math.min(...todos), max = Math.max(...todos, 1);
  min = min > 0 && min > max * 0.5 ? min * 0.9 : Math.min(min, 0); // aproxima o eixo quando tudo está alto
  const passo = Math.pow(10, Math.floor(Math.log10(Math.max(max - min, 1)))) / 2;
  min = Math.floor(min / passo) * passo; max = Math.ceil(max / passo) * passo;
  return { min, max: max === min ? min + 1 : max };
});
const x = (i: number) => M.l + (n.value <= 1 ? 0 : (i / (n.value - 1)) * (W - M.l - M.r));
const y = (v: number) => M.t + (1 - (v - escala.value.min) / (escala.value.max - escala.value.min)) * (H.value - M.t - M.b);
const grade = computed(() => [0, 1, 2, 3, 4].map((k) => escala.value.min + ((escala.value.max - escala.value.min) * k) / 4));
const caminho = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
const marcasX = computed(() => {
  const k = Math.max(1, Math.ceil(n.value / 6));
  return props.rotulos.map((r, i) => ({ r, i })).filter(({ i }) => i % k === 0 || i === n.value - 1);
});

const foco = ref<number | null>(null);
const svg = ref<SVGSVGElement>();
function mover(e: PointerEvent) {
  const r = svg.value!.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * W;
  const i = Math.round(((px - M.l) / (W - M.l - M.r)) * (n.value - 1));
  foco.value = Math.min(n.value - 1, Math.max(0, i));
}
const resumo = computed(() => props.series.map((s) => `${s.nome}: ${props.formatar(s.valores.at(-1) ?? 0)}`).join('; '));
</script>

<template>
  <figure class="grafico">
    <svg ref="svg" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`Gráfico. Valores finais: ${resumo}`"
      @pointermove="mover" @pointerleave="foco = null" @pointerdown="mover">
      <g class="grade">
        <template v-for="g in grade" :key="g">
          <line :x1="M.l" :x2="W - M.r" :y1="y(g)" :y2="y(g)" />
          <text :x="M.l - 8" :y="y(g) + 4" text-anchor="end">{{ formatar(g) }}</text>
        </template>
        <text v-for="m in marcasX" :key="m.i" :x="x(m.i)" :y="H - 6" :text-anchor="m.i === 0 ? 'start' : m.i === n - 1 ? 'end' : 'middle'">{{ m.r }}</text>
      </g>
      <path v-for="s in series" :key="s.nome" :d="caminho(s.valores)" :stroke="s.cor" :class="{ tracejada: s.tracejada }" />
      <g v-if="foco !== null">
        <line class="guia" :x1="x(foco)" :x2="x(foco)" :y1="M.t" :y2="H - M.b" />
        <circle v-for="s in series" :key="s.nome" :cx="x(foco)" :cy="y(s.valores[foco] ?? 0)" r="4" :fill="s.cor" />
      </g>
    </svg>
    <figcaption>
      <span v-if="foco !== null" class="quando">{{ rotulos[foco] }}</span>
      <span v-for="s in series" :key="s.nome" class="item">
        <i :style="{ background: s.tracejada ? `repeating-linear-gradient(90deg, ${s.cor} 0 4px, transparent 4px 7px)` : s.cor }" />{{ s.nome }}
        <b>{{ formatar(foco !== null ? s.valores[foco] ?? 0 : s.valores.at(-1) ?? 0) }}</b>
      </span>
    </figcaption>
  </figure>
</template>

<style scoped>
.grafico { margin: 0; display: grid; gap: 10px; min-width: 0; }
svg { width: 100%; height: auto; display: block; touch-action: pan-y; }
.grade line { stroke: var(--line); stroke-width: 1; }
.grade text { fill: var(--ink-3); font-size: 11px; font-family: var(--fonte); }
path { fill: none; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
path.tracejada { stroke-dasharray: 6 5; stroke-width: 2; }
.guia { stroke: var(--ink-3); stroke-dasharray: 3 3; }
figcaption { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 0.8125rem; color: var(--ink-2); align-items: center; }
.quando { font-weight: 600; color: var(--ink); }
.item { display: inline-flex; align-items: center; gap: 6px; }
.item i { width: 14px; height: 3px; border-radius: 2px; }
.item b { color: var(--ink); font-weight: 650; }
</style>

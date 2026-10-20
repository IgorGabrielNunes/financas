<script setup lang="ts">
import type { Lancamento } from '../api';
import { dataCurta, dinheiro, MEIOS } from '../format';
import { abrirLancamento } from '../store';
defineProps<{ l: Lancamento; mostrarData?: boolean }>();
defineEmits<{ confirmar: [l: Lancamento] }>();
const inicial = (l: Lancamento) => (l.categoria_nome ?? l.descricao).trim().slice(0, 1).toUpperCase();
</script>

<template>
  <li class="clicavel" @click="abrirLancamento(l.id)">
    <span class="ico" :style="{ '--c': l.categoria_cor ?? 'var(--ink-3)' }">{{ inicial(l) }}</span>
    <div style="min-width: 0">
      <div class="titulo">
        {{ l.descricao }}
        <span v-if="l.parcelas_total > 1" class="parc">{{ l.parcelas_total }}x<template v-if="l.parcelas_pagas_antes">, {{ l.parcelas_pagas_antes }} pagas</template></span>
      </div>
      <div class="meta">
        {{ [
          mostrarData !== false ? dataCurta(l.data) : '',
          l.meio === 'credito' ? l.cartao_nome : MEIOS[l.meio],
          l.categoria_nome ?? '',
        ].filter(Boolean).join(', ') }}
        <svg v-if="l.qtd_comprovantes" class="clipe" viewBox="0 0 24 24" :aria-label="`${l.qtd_comprovantes} comprovante(s)`"><path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" /></svg>
      </div>
    </div>
    <div class="valor">
      <div :class="l.status === 'previsto' ? 'previsto' : l.tipo === 'receita' ? 'entra' : l.meio === 'credito' ? 'sai' : ''">
        {{ l.tipo === 'receita' ? '+' : '−' }} {{ dinheiro(l.valor_centavos) }}
      </div>
      <button v-if="l.status === 'previsto'" class="confirmar" type="button" @click.stop="$emit('confirmar', l)">Confirmar</button>
    </div>
  </li>
</template>

<style scoped>
.parc { font-size: 0.75rem; font-weight: 600; color: var(--ink-3); margin-left: 4px; }
.clipe { width: 14px; height: 14px; vertical-align: -2px; margin-left: 4px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.confirmar {
  margin-top: 4px; font: 600 0.75rem var(--fonte); color: var(--previsto); background: var(--previsto-tint);
  border: 0; border-radius: 999px; padding: 4px 10px; cursor: pointer;
}
.confirmar:hover { background: color-mix(in srgb, var(--previsto) 22%, var(--surface)); }
</style>

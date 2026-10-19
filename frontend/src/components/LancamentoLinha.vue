<script setup lang="ts">
import type { Lancamento } from '../api';
import { dataCurta, dinheiro, MEIOS } from '../format';
import { abrirLancamento } from '../store';
defineProps<{ l: Lancamento; mostrarData?: boolean }>();
defineEmits<{ confirmar: [l: Lancamento] }>();
</script>

<template>
  <li class="clicavel" @click="abrirLancamento(l.id)">
    <span class="pin" :style="{ background: l.categoria_cor ?? 'var(--line)' }" />
    <div style="min-width: 0">
      <div class="titulo">
        {{ l.descricao }}
        <span v-if="l.parcelas_total > 1" class="suave miudo">em {{ l.parcelas_total }}x<template v-if="l.parcelas_pagas_antes">, {{ l.parcelas_pagas_antes }} já pagas</template></span>
      </div>
      <div class="meta">
        <template v-if="mostrarData !== false">{{ dataCurta(l.data) }}, </template>
        {{ l.meio === 'credito' ? l.cartao_nome : MEIOS[l.meio] }}<template v-if="l.categoria_nome">, {{ l.categoria_nome }}</template>
        <template v-if="l.qtd_comprovantes">, {{ l.qtd_comprovantes }} comprovante{{ l.qtd_comprovantes > 1 ? 's' : '' }}</template>
      </div>
    </div>
    <div class="valor">
      <div :class="l.status === 'previsto' ? 'previsto' : l.tipo === 'receita' ? 'entra' : l.meio === 'credito' ? 'sai' : ''">
        {{ l.tipo === 'receita' ? '+' : '−' }}{{ dinheiro(l.valor_centavos) }}
      </div>
      <button v-if="l.status === 'previsto'" class="btn link miudo" type="button" @click.stop="$emit('confirmar', l)">
        Confirmar
      </button>
    </div>
  </li>
</template>

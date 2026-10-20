<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, type Fatura } from '../../../core/api';
import { abrirLancamento, cadastros, versao } from '../../../core/store';
import { dataBR, dataCurta, dinheiro, mesAno, STATUS_FATURA } from '../../../core/format';
import PagamentoForm from '../componentes/PagamentoForm.vue';

type Item = {
  numero: number; valor_centavos: number; lancamento_id: string; descricao: string; data: string; parcelas_total: number;
  status: string; categoria_nome: string | null; categoria_cor: string | null; qtd_comprovantes: number;
};
const route = useRoute();
const f = ref<(Fatura & { itens: Item[] }) | null>(null);
const pagar = ref(false);
watch([() => route.params.id, versao], async () => { f.value = await api.get(`/faturas/${route.params.id}`); }, { immediate: true });
const contaPadrao = (cartaoId: string) => cadastros.cartoes.find((c) => c.id === cartaoId)?.conta_pagamento_id ?? null;
</script>

<template>
  <div v-if="f" class="pagina">
    <header class="cabecalho">
      <div>
        <RouterLink class="btn link" :to="`/financas/cartoes/${f.cartao_id}`">{{ f.cartao_nome }}</RouterLink>
        <h1>Fatura de {{ mesAno(f.competencia) }}</h1>
        <p>Fecha {{ dataCurta(f.data_fechamento) }}, vence {{ dataCurta(f.data_vencimento) }}</p>
      </div>
      <button v-if="f.total_centavos > 0" class="btn primario" @click="pagar = true">
        {{ f.valor_pago_centavos > 0 ? 'Ajustar pagamento' : 'Registrar pagamento' }}
      </button>
    </header>

    <section class="kpis">
      <div><span>Total</span><b class="sai">{{ dinheiro(f.total_centavos) }}</b></div>
      <div><span>Pago</span><b>{{ dinheiro(f.valor_pago_centavos) }}</b><small v-if="f.pago_em">em {{ dataBR(f.pago_em) }}</small></div>
      <div><span>Situação</span><b><span :class="['selo', f.status]">{{ STATUS_FATURA[f.status] }}</span></b></div>
    </section>

    <section class="secao">
      <header><h2>Itens</h2><span>{{ f.itens.length }}</span></header>
      <ul v-if="f.itens.length" class="lista painel">
        <li v-for="i in f.itens" :key="i.lancamento_id + i.numero" class="clicavel" @click="abrirLancamento(i.lancamento_id)">
          <span class="pin" :style="{ background: i.categoria_cor ?? 'var(--line)' }" />
          <div style="min-width: 0">
            <div class="titulo">
              {{ i.descricao }}
              <span v-if="i.parcelas_total > 1" class="suave miudo">parcela {{ i.numero }} de {{ i.parcelas_total }}</span>
            </div>
            <div class="meta">
              Comprado em {{ dataCurta(i.data) }}<template v-if="i.categoria_nome">, {{ i.categoria_nome }}</template>
              <template v-if="i.status === 'previsto'">, assinatura prevista</template>
              <template v-if="i.qtd_comprovantes">, com comprovante</template>
            </div>
          </div>
          <div class="valor">{{ dinheiro(i.valor_centavos) }}</div>
        </li>
      </ul>
      <p v-else class="painel vazio">Nenhuma compra nesta fatura.</p>
    </section>

    <PagamentoForm v-if="pagar" :fatura="f" :conta-padrao="contaPadrao(f.cartao_id)" @fechar="pagar = false" />
  </div>
</template>


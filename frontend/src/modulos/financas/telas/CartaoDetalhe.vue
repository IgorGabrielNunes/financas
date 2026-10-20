<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, type Cartao, type Fatura } from '../../../core/api';
import { abrirLancamento, versao } from '../../../core/store';
import { dataCurta, dinheiro, mesAno, STATUS_FATURA } from '../../../core/format';
import CartaoVisual from '../componentes/CartaoVisual.vue';
import CartaoForm from '../componentes/CartaoForm.vue';
import PagamentoForm from '../componentes/PagamentoForm.vue';

const route = useRoute();
const cartao = ref<Cartao | null>(null);
const faturas = ref<Fatura[]>([]);
const editar = ref(false);
const pagar = ref<Fatura | null>(null);
const aba = ref<'abertas' | 'pagas'>('abertas');

async function carregar() {
  const id = route.params.id as string;
  const [cs, fs] = await Promise.all([api.get<Cartao[]>('/cartoes'), api.get<Fatura[]>(`/cartoes/${id}/faturas`)]);
  cartao.value = cs.find((c) => c.id === id) ?? null;
  faturas.value = fs;
}
watch([() => route.params.id, versao], carregar, { immediate: true });

const lista = computed(() =>
  aba.value === 'abertas'
    ? faturas.value.filter((f) => f.status !== 'paga')
    : faturas.value.filter((f) => f.status === 'paga').reverse(),
);
const maior = computed(() => Math.max(1, ...lista.value.map((f) => f.total_centavos)));
</script>

<template>
  <div v-if="cartao" class="pagina">
    <header class="cabecalho">
      <div>
        <RouterLink class="btn link" to="/financas/cartoes">Central de cartões</RouterLink>
        <h1>{{ cartao.nome }}</h1>
      </div>
      <div class="acoes">
        <button class="btn" @click="editar = true">Editar cartão</button>
        <button class="btn primario" @click="abrirLancamento(null, { meio: 'credito', cartao_id: cartao.id })">Lançar compra</button>
      </div>
    </header>

    <div class="topo">
      <CartaoVisual :cartao="cartao" />
      <dl class="painel recheado">
        <div><dt>Limite</dt><dd>{{ dinheiro(cartao.limite_centavos) }}</dd></div>
        <div><dt>Usado (todas as faturas em aberto)</dt><dd class="sai">{{ dinheiro(cartao.usado_centavos) }}</dd></div>
        <div><dt>Livre</dt><dd>{{ dinheiro(cartao.livre_centavos) }}</dd></div>
        <div><dt>Fatura atual fecha em</dt><dd>{{ dataCurta(cartao.fatura_atual.data_fechamento) }}</dd></div>
        <div><dt>Melhor dia de compra</dt><dd>dia {{ cartao.dia_fechamento }}</dd></div>
      </dl>
    </div>

    <section class="secao">
      <header>
        <h2>Faturas</h2>
        <div class="segmentado" role="group" aria-label="Filtro">
          <button :aria-pressed="aba === 'abertas'" @click="aba = 'abertas'">Atuais e futuras</button>
          <button :aria-pressed="aba === 'pagas'" @click="aba = 'pagas'">Pagas</button>
        </div>
      </header>
      <ul v-if="lista.length" class="lista painel">
        <li v-for="f in lista" :key="f.id" class="clicavel" @click="$router.push(`/financas/faturas/${f.id}`)">
          <span :class="['selo', f.status]">{{ STATUS_FATURA[f.status] }}</span>
          <div>
            <div class="titulo">{{ mesAno(f.competencia) }}</div>
            <div class="meta">Fecha {{ dataCurta(f.data_fechamento) }}, vence {{ dataCurta(f.data_vencimento) }}</div>
            <div class="medidor"><i :style="{ width: (f.total_centavos / maior) * 100 + '%' }" /></div>
          </div>
          <div class="valor">
            {{ dinheiro(f.total_centavos) }}
            <div v-if="f.status === 'fechada' || f.status === 'vencida' || f.status === 'parcial'">
              <button class="btn link miudo" @click.stop="pagar = f">Pagar</button>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="painel vazio">Nenhuma fatura aqui.</p>
    </section>

    <CartaoForm v-if="editar" :cartao="cartao" @fechar="editar = false" />
    <PagamentoForm v-if="pagar" :fatura="pagar" :conta-padrao="cartao.conta_pagamento_id" @fechar="pagar = null" />
  </div>
</template>

<style scoped>
.topo { display: grid; gap: 24px; grid-template-columns: minmax(260px, 360px) 1fr; align-items: start; }
@media (max-width: 760px) { .topo { grid-template-columns: 1fr; } }
dl { margin: 0; display: grid; }
dl div { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
dl div:last-child { border-bottom: 0; }
dt { color: var(--ink-2); }
dd { margin: 0; font-weight: 600; }
.medidor { margin-top: 6px; max-width: 260px; }
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, type Cartao } from '../api';
import { abrirLancamento, versao } from '../store';
import { dataCurta, dinheiro, mesAno } from '../format';
import CartaoVisual from '../components/CartaoVisual.vue';
import CartaoForm from '../components/CartaoForm.vue';

const cartoes = ref<Cartao[]>([]);
const form = ref<{ aberto: boolean; cartao: Cartao | null }>({ aberto: false, cartao: null });
watch(versao, async () => { cartoes.value = await api.get<Cartao[]>('/cartoes'); }, { immediate: true });

const ativos = computed(() => cartoes.value.filter((c) => c.ativo));
const inativos = computed(() => cartoes.value.filter((c) => !c.ativo));
const tot = computed(() => ({
  limite: ativos.value.reduce((s, c) => s + c.limite_centavos, 0),
  usado: ativos.value.reduce((s, c) => s + c.usado_centavos, 0),
  futuras: ativos.value.reduce((s, c) => s + c.futuras_centavos, 0),
}));
</script>

<template>
  <div class="pagina">
    <header class="cabecalho">
      <div>
        <h1>Central de cartões</h1>
        <p v-if="ativos.length">
          {{ dinheiro(tot.usado) }} comprometidos de {{ dinheiro(tot.limite) }} de limite,
          {{ dinheiro(tot.futuras) }} já em faturas futuras.
        </p>
      </div>
      <button class="btn primario" @click="form = { aberto: true, cartao: null }">Adicionar cartão</button>
    </header>

    <div v-if="!cartoes.length" class="painel vazio">
      <h2>Nenhum cartão cadastrado</h2>
      <p>Cadastre os cartões que você tem hoje, com limite e dias de fechamento e vencimento. Depois lance as compras parceladas em aberto para ver o tamanho real das faturas futuras.</p>
      <button class="btn primario" @click="form = { aberto: true, cartao: null }">Adicionar cartão</button>
    </div>

    <div class="grade-cartoes">
      <article v-for="c in ativos" :key="c.id" class="item">
        <RouterLink :to="`/cartoes/${c.id}`" class="sem-link"><CartaoVisual :cartao="c" /></RouterLink>
        <dl>
          <div><dt>Fatura atual ({{ mesAno(c.fatura_atual.competencia) }})</dt><dd>{{ dinheiro(c.fatura_atual.total_centavos) }}</dd></div>
          <div><dt>Fecha em</dt><dd>{{ dataCurta(c.fatura_atual.data_fechamento) }}</dd></div>
          <div v-if="c.fatura_a_pagar"><dt>A pagar até {{ dataCurta(c.fatura_a_pagar.data_vencimento) }}</dt><dd class="sai">{{ dinheiro(c.fatura_a_pagar.em_aberto_centavos) }}</dd></div>
          <div><dt>Faturas futuras</dt><dd>{{ dinheiro(c.futuras_centavos) }}</dd></div>
          <div><dt>Limite usado</dt><dd>{{ dinheiro(c.usado_centavos) }} de {{ dinheiro(c.limite_centavos) }}</dd></div>
        </dl>
        <div class="acoes">
          <button class="btn" @click="form = { aberto: true, cartao: c }">Editar</button>
          <button class="btn" @click="abrirLancamento(null, { meio: 'credito', cartao_id: c.id })">Lançar compra</button>
        </div>
      </article>
    </div>

    <section v-if="inativos.length" class="secao">
      <header><h2>Cancelados ou guardados</h2></header>
      <ul class="lista painel">
        <li v-for="c in inativos" :key="c.id" class="clicavel" @click="$router.push(`/cartoes/${c.id}`)">
          <span class="pin" :style="{ background: c.cor }" />
          <div class="titulo">{{ c.nome }}</div>
          <div class="valor">{{ c.usado_centavos ? dinheiro(c.usado_centavos) + ' a pagar' : 'Quitado' }}</div>
        </li>
      </ul>
    </section>

    <CartaoForm v-if="form.aberto" :cartao="form.cartao" @fechar="form.aberto = false" />
  </div>
</template>

<style scoped>
.grade-cartoes { display: grid; gap: 24px; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); }
.item { display: grid; gap: 14px; align-content: start; background: var(--surface); border: 1px solid var(--line); border-radius: var(--raio-l); padding: 12px 12px 14px; }
.item dl { padding: 0 6px; }
.item .acoes { padding: 0 6px; }
.sem-link { text-decoration: none; }
dl { margin: 0; display: grid; }
dl div { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 0.9rem; }
dl div:last-child { border-bottom: 0; }
dt { color: var(--ink-2); }
dd { margin: 0; font-weight: 600; text-align: right; }
.acoes { justify-content: flex-start; }
</style>

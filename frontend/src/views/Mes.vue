<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Fatura, type Lancamento } from '../api';
import { abrirLancamento, versao } from '../store';
import { dataCurta, dinheiro, hoje, mesLongo, STATUS_FATURA } from '../format';
import LancamentoLinha from '../components/LancamentoLinha.vue';

type Visao = {
  competencia: string;
  totais: {
    receitas_centavos: number; receitas_realizadas_centavos: number; despesas_centavos: number;
    despesas_realizadas_centavos: number; faturas_centavos: number; compras_credito_centavos: number; saldo_previsto_centavos: number;
  };
  receitas: Lancamento[]; despesas: Lancamento[]; faturas: Fatura[]; compras_credito: Lancamento[];
};

const route = useRoute();
const router = useRouter();
const ano = computed(() => Number(route.params.ano) || +hoje().slice(0, 4));
const mes = computed(() => Number(route.params.mes) || +hoje().slice(5, 7));
const v = ref<Visao | null>(null);

async function carregar() {
  v.value = await api.get<Visao>(`/mes/${ano.value}/${mes.value}`);
}
watch([ano, mes, versao], carregar, { immediate: true });

function navegar(delta: number) {
  const idx = ano.value * 12 + mes.value - 1 + delta;
  router.push(`/mes/${Math.floor(idx / 12)}/${(idx % 12) + 1}`);
}

const fixas = computed(() => v.value?.despesas.filter((l) => l.recorrencia_id) ?? []);
const avulsas = computed(() => v.value?.despesas.filter((l) => !l.recorrencia_id) ?? []);
const confirmar = (l: Lancamento) => abrirLancamento(l.id, { status: 'realizado' });
</script>

<template>
  <div class="pagina">
    <header class="cabecalho">
      <div class="nav-mes">
        <button class="btn" aria-label="Mês anterior" @click="navegar(-1)">‹</button>
        <h1>{{ mesLongo(ano, mes) }}</h1>
        <button class="btn" aria-label="Próximo mês" @click="navegar(1)">›</button>
      </div>
      <div class="acoes">
        <RouterLink class="btn" to="/fixos">Fixos do mês</RouterLink>
        <RouterLink class="btn" to="/lancamentos">Todos os lançamentos</RouterLink>
      </div>
    </header>

    <template v-if="v">
      <section class="resumo painel">
        <div>
          <span>Entra</span>
          <b class="entra">{{ dinheiro(v.totais.receitas_centavos) }}</b>
          <small>{{ dinheiro(v.totais.receitas_realizadas_centavos) }} já recebido</small>
        </div>
        <div>
          <span>Sai em contas e gastos</span>
          <b>{{ dinheiro(v.totais.despesas_centavos) }}</b>
          <small>{{ dinheiro(v.totais.despesas_realizadas_centavos) }} já pago</small>
        </div>
        <div>
          <span>Sai em faturas</span>
          <b class="sai">{{ dinheiro(v.totais.faturas_centavos) }}</b>
          <small>vencendo neste mês</small>
        </div>
        <div class="saldo">
          <span>Sobra prevista</span>
          <b :class="v.totais.saldo_previsto_centavos < 0 ? 'sai' : 'entra'">{{ dinheiro(v.totais.saldo_previsto_centavos) }}</b>
        </div>
      </section>

      <div class="grade-2">
        <section class="secao">
          <header><h2>Receitas</h2><span>{{ v.receitas.length }}</span></header>
          <ul v-if="v.receitas.length" class="lista painel">
            <LancamentoLinha v-for="l in v.receitas" :key="l.id" :l="l" @confirmar="confirmar" />
          </ul>
          <div v-else class="painel vazio">
            <p>Nenhuma receita neste mês.</p>
            <RouterLink class="btn" to="/fixos">Cadastrar salário como fixo</RouterLink>
          </div>
        </section>

        <section class="secao">
          <header><h2>Contas fixas</h2><span>aluguel, água, luz, internet…</span></header>
          <ul v-if="fixas.length" class="lista painel">
            <LancamentoLinha v-for="l in fixas" :key="l.id" :l="l" @confirmar="confirmar" />
          </ul>
          <div v-else class="painel vazio">
            <p>Os fixos aparecem aqui todo mês, prontos para confirmar.</p>
            <RouterLink class="btn" to="/fixos">Cadastrar fixos</RouterLink>
          </div>
        </section>
      </div>

      <section class="secao">
        <header><h2>Faturas que vencem neste mês</h2><span>{{ dinheiro(v.totais.faturas_centavos) }}</span></header>
        <ul v-if="v.faturas.length" class="lista painel">
          <li v-for="f in v.faturas" :key="f.id" class="clicavel" @click="$router.push(`/faturas/${f.id}`)">
            <span class="pin" :style="{ background: f.cartao_cor }" />
            <div>
              <div class="titulo">{{ f.cartao_nome }}</div>
              <div class="meta">Vence {{ dataCurta(f.data_vencimento) }}, {{ f.qtd_parcelas }} {{ f.qtd_parcelas === 1 ? 'item' : 'itens' }}</div>
            </div>
            <div class="valor">
              <div class="sai">{{ dinheiro(f.total_centavos) }}</div>
              <span :class="['selo', f.status]">{{ STATUS_FATURA[f.status] }}</span>
            </div>
          </li>
        </ul>
        <p v-else class="painel vazio">Nenhuma fatura vence neste mês.</p>
      </section>

      <div class="grade-2">
        <section class="secao">
          <header><h2>Gastos do dia a dia</h2><span>débito, pix, dinheiro</span></header>
          <ul v-if="avulsas.length" class="lista painel">
            <LancamentoLinha v-for="l in avulsas" :key="l.id" :l="l" @confirmar="confirmar" />
          </ul>
          <div v-else class="painel vazio">
            <p>Nada lançado ainda.</p>
            <button class="btn primario" @click="abrirLancamento()">Lançar gasto</button>
          </div>
        </section>

        <section class="secao">
          <header><h2>Compras no crédito</h2><span>{{ dinheiro(v.totais.compras_credito_centavos) }}</span></header>
          <ul v-if="v.compras_credito.length" class="lista painel">
            <LancamentoLinha v-for="l in v.compras_credito" :key="l.id" :l="l" />
          </ul>
          <p v-else class="painel vazio">Nenhuma compra no crédito neste mês.</p>
          <p class="miudo suave">Compras no crédito não saem do caixa agora: elas entram na fatura do mês em que vencem.</p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.nav-mes { display: flex; align-items: center; gap: 10px; }
.nav-mes h1 { min-width: 9ch; text-align: center; }
.nav-mes .btn { font-size: 1.3rem; width: 42px; padding: 0; }
.resumo { display: grid; grid-template-columns: repeat(4, 1fr); }
.resumo > div { display: grid; gap: 2px; padding: 16px 18px; border-left: 1px solid var(--line); }
.resumo > div:first-child { border-left: 0; }
.resumo span { font-size: 0.8125rem; color: var(--ink-2); }
.resumo b { font: 700 1.4rem var(--display); }
.resumo small { color: var(--ink-3); font-size: 0.75rem; }
.resumo .saldo { background: var(--surface-2); border-radius: 0 var(--raio-m) var(--raio-m) 0; }
@media (max-width: 760px) {
  .resumo { grid-template-columns: 1fr 1fr; }
  .resumo > div:nth-child(3) { border-left: 0; }
  .resumo > div:nth-child(n + 3) { border-top: 1px solid var(--line); }
  .resumo .saldo { border-radius: 0 0 var(--raio-m) 0; }
}
</style>

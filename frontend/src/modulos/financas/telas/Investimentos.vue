<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../../core/api';
import { versao } from '../../../core/store';
import { dataCurta, dinheiro, pct } from '../../../core/format';
import InvestimentoForm from '../componentes/InvestimentoForm.vue';
import InvestimentoDetalhe from '../componentes/InvestimentoDetalhe.vue';
import MovInvestForm from '../componentes/MovInvestForm.vue';
import SimuladorInvest from '../componentes/SimuladorInvest.vue';
import TaxasForm from '../componentes/TaxasForm.vue';
import { rotuloModelo, taxa2, TIPOS_INVEST, type Carteira, type Investimento } from '../investir';

const route = useRoute();
const router = useRouter();
const aba = computed(() => (route.query.aba === 'simulador' ? 'simulador' : 'carteira'));
const atualQuery = computed(() => (typeof route.query.atual === 'string' ? route.query.atual : null));

const c = ref<Carteira | null>(null);
const erro = ref('');
watch(versao, async () => {
  try { c.value = await api.get<Carteira>('/investimentos'); } catch (e) { erro.value = (e as Error).message; }
}, { immediate: true });

const ativos = computed(() => c.value?.itens.filter((i) => i.ativo) ?? []);
const encerrados = computed(() => c.value?.itens.filter((i) => !i.ativo) ?? []);
const totalConta = computed(() => Math.max(1, c.value?.por_conta.reduce((s, x) => s + x.saldo_centavos, 0) ?? 1));
const CORES = ['#0f4b3a', '#13805a', '#b46a00', '#2563eb', '#c23a5e', '#6d28d9', '#0e7490'];

const form = ref<{ aberto: boolean; item: Investimento | null }>({ aberto: false, item: null });
const detalhe = ref<string | null>(null);
const mov = ref<{ inv: Investimento; tipo: 'aporte' | 'resgate' | 'saldo' } | null>(null);
const taxasAbertas = ref(false);
function acao(tipo: 'aporte' | 'resgate' | 'saldo' | 'editar', inv: Investimento) {
  if (tipo === 'editar') { detalhe.value = null; form.value = { aberto: true, item: inv }; }
  else mov.value = { inv, tipo };
}
</script>

<template>
  <div class="pagina">
    <header class="cabecalho">
      <div>
        <h1>Investimentos</h1>
        <p v-if="c && c.totais.qtd">
          {{ dinheiro(c.totais.saldo_bruto_centavos) }} aplicados, rendendo cerca de {{ dinheiro(c.totais.rendimento_mes_centavos) }} por mês.
          Esse dinheiro não entra no saldo das contas nem no disponível.
        </p>
        <p v-else>Acompanhe onde seu dinheiro está aplicado e compare com outras opções.</p>
      </div>
      <button class="btn primario" @click="form = { aberto: true, item: null }">Novo investimento</button>
    </header>

    <div class="segmentado abas" role="tablist">
      <button role="tab" :aria-pressed="aba === 'carteira'" @click="router.replace({ query: {} })">Minha carteira</button>
      <button role="tab" :aria-pressed="aba === 'simulador'" @click="router.replace({ query: { aba: 'simulador' } })">Simulador</button>
    </div>

    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <template v-if="c && aba === 'carteira'">
      <div v-if="!c.itens.length" class="painel vazio">
        <h2>Cadastre o que você já tem aplicado</h2>
        <p>Caixinha, CDB, Tesouro, poupança: informe onde está, quanto aplicou e o saldo de hoje no app. O Vida calcula quanto rendeu e quanto rende por mês.</p>
        <button class="btn primario" @click="form = { aberto: true, item: null }">Novo investimento</button>
      </div>

      <template v-else>
        <div class="kpis">
          <div><span>Saldo aplicado</span><b>{{ dinheiro(c.totais.saldo_bruto_centavos) }}</b><small>{{ c.totais.qtd }} {{ c.totais.qtd === 1 ? 'investimento' : 'investimentos' }}</small></div>
          <div><span>Já rendeu</span><b class="entra">+ {{ dinheiro(c.totais.rendimento_bruto_centavos) }}</b><small>{{ dinheiro(c.totais.rendimento_liquido_centavos) }} sem IR</small></div>
          <div><span>Rende por mês</span><b>{{ dinheiro(c.totais.rendimento_mes_centavos) }}</b><small>bruto, nas taxas de hoje</small></div>
          <div><span>Seu dinheiro aplicado</span><b>{{ dinheiro(c.totais.investido_centavos) }}</b><small>sem o rendimento</small></div>
        </div>

        <section v-if="c.por_conta.length > 0" class="secao">
          <header><h2>Onde está</h2></header>
          <div class="painel onde">
            <div class="pilha" role="img" :aria-label="c.por_conta.map((x) => `${x.conta_nome} ${dinheiro(x.saldo_centavos)}`).join(', ')">
              <i v-for="(x, k) in c.por_conta" :key="x.conta_id ?? k" :style="{ width: (x.saldo_centavos / totalConta) * 100 + '%', background: x.conta_cor ?? CORES[k % CORES.length] }" />
            </div>
            <ul>
              <li v-for="(x, k) in c.por_conta" :key="x.conta_id ?? k">
                <i :style="{ background: x.conta_cor ?? CORES[k % CORES.length] }" />{{ x.conta_nome }}
                <b>{{ dinheiro(x.saldo_centavos) }}</b><small>{{ pct((x.saldo_centavos / totalConta) * 100) }}</small>
              </li>
            </ul>
          </div>
        </section>

        <section class="secao">
          <header><h2>Aplicações</h2></header>
          <div class="cartelas">
            <article v-for="i in ativos" :key="i.id" class="painel cartela">
              <button class="abrir" type="button" :aria-label="`Ver ${i.nome}`" @click="detalhe = i.id" />
              <header>
                <div>
                  <h3>{{ i.nome }}</h3>
                  <p class="meta">{{ TIPOS_INVEST[i.tipo]?.nome }} · {{ rotuloModelo(i) }} · {{ i.conta_nome ?? 'sem conta' }}<template v-if="i.usuario_nome"> · {{ i.usuario_nome }}</template></p>
                </div>
                <b>{{ dinheiro(i.posicao.saldo_bruto_centavos) }}</b>
              </header>
              <dl>
                <div><dt>Rendeu</dt><dd class="entra">+ {{ dinheiro(i.posicao.rendimento_bruto_centavos) }} <small>({{ pct(i.posicao.rentabilidade_pct) }})</small></dd></div>
                <div v-if="i.indexador !== 'nenhum'"><dt>Rende por mês</dt><dd>~ {{ dinheiro(i.posicao.rendimento_mes_centavos) }} <small>({{ taxa2(i.posicao.taxa_aa_pct) }} a.a.)</small></dd></div>
                <div v-if="i.meta_nome"><dt>Meta</dt><dd>{{ i.meta_nome }}</dd></div>
              </dl>
              <p class="origem">
                <span :class="['selo', { paga: i.posicao.origem === 'informado' }]">
                  {{ i.posicao.origem === 'informado' ? `Saldo real de ${dataCurta(i.posicao.saldo_informado!.data)}` : 'Estimado' }}
                </span>
                <template v-if="i.liquidez === 'vencimento'"><span class="selo">{{ i.vencimento ? `Vence ${dataCurta(i.vencimento)}` : 'No vencimento' }}</span></template>
              </p>
              <div class="acoes-cartela">
                <button class="btn" type="button" @click="acao('aporte', i)">Aplicar</button>
                <button class="btn" type="button" @click="acao('resgate', i)">Resgatar</button>
                <button class="btn link" type="button" @click="acao('saldo', i)">Informar saldo</button>
              </div>
            </article>
          </div>
        </section>

        <details v-if="encerrados.length" class="painel encerrados">
          <summary>Encerrados ({{ encerrados.length }})</summary>
          <ul class="lista">
            <li v-for="i in encerrados" :key="i.id" class="clicavel" @click="detalhe = i.id">
              <span class="pin" />
              <div><div class="titulo">{{ i.nome }}</div><div class="meta">{{ rotuloModelo(i) }}</div></div>
              <div class="valor">{{ dinheiro(i.posicao.saldo_bruto_centavos) }}</div>
            </li>
          </ul>
        </details>
      </template>

      <section class="painel taxas">
        <div>
          <b>Taxas de hoje</b>
          <span>CDI {{ taxa2(c.taxas.cdi_aa) }} · Selic {{ taxa2(c.taxas.selic_aa) }} · IPCA {{ taxa2(c.taxas.ipca_aa) }} · TR {{ c.taxas.tr_am.toLocaleString('pt-BR') }}% a.m.</span>
          <small>{{ c.taxas.fonte === 'bcb' ? `Banco Central, atualizado ${dataCurta(c.taxas.atualizado_em.slice(0, 10))}` : c.taxas.fonte === 'manual' ? 'Ajustadas por você' : 'Valores padrão (Banco Central indisponível)' }}</small>
        </div>
        <button class="btn" type="button" @click="taxasAbertas = true">Ajustar</button>
      </section>
      <p class="miudo suave">
        O rendimento é estimado pelo modelo de cada aplicação (dias úteis, IR regressivo e IOF) usando as taxas de hoje.
        Para ver o valor exato, use "Informar saldo" com o que o app do banco mostra: o Vida corrige a partir dali.
      </p>
    </template>

    <SimuladorInvest v-if="c && aba === 'simulador'" :itens="c.itens" :atual-inicial="atualQuery" />

    <InvestimentoForm v-if="form.aberto" :investimento="form.item" @fechar="form.aberto = false" />
    <InvestimentoDetalhe v-if="detalhe" :id="detalhe" @fechar="detalhe = null" @acao="acao" />
    <MovInvestForm v-if="mov" :investimento="mov.inv" :tipo="mov.tipo" @fechar="mov = null" />
    <TaxasForm v-if="taxasAbertas && c" :taxas="c.taxas" @fechar="taxasAbertas = false" />
  </div>
</template>

<style scoped>
.abas { max-width: 420px; }
.onde { padding: 18px; display: grid; gap: 14px; }
.pilha { display: flex; height: 12px; border-radius: 6px; overflow: hidden; gap: 2px; background: var(--surface-3); }
.pilha i { display: block; height: 100%; min-width: 4px; }
.onde ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 24px; }
.onde li { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; }
.onde li i { width: 10px; height: 10px; border-radius: 3px; }
.onde li small { color: var(--ink-3); }

.cartelas { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); align-items: start; }
.cartela { padding: 18px; display: grid; gap: 10px; position: relative; }
.cartela:hover { border-color: var(--ink-3); }
.abrir { position: absolute; inset: 0; border: 0; background: transparent; border-radius: inherit; cursor: pointer; }
.cartela header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.cartela header > div { min-width: 0; }
.cartela h3 { font-size: 1rem; }
.cartela header b { font: 700 1.25rem var(--fonte); white-space: nowrap; letter-spacing: -0.02em; }
.meta { color: var(--ink-3); font-size: 0.8125rem; }
dl { margin: 0; }
dl div { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-top: 1px solid var(--line); font-size: 0.875rem; }
dt { color: var(--ink-2); }
dd { margin: 0; font-weight: 600; text-align: right; }
dd small { color: var(--ink-3); font-weight: 500; }
.origem { display: flex; gap: 6px; flex-wrap: wrap; }
.acoes-cartela { display: flex; gap: 8px; flex-wrap: wrap; position: relative; z-index: 1; }
.acoes-cartela .btn { min-height: 40px; }

.encerrados summary { padding: 14px 18px; cursor: pointer; font-weight: 600; }
.taxas { padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.taxas > div { display: grid; gap: 2px; }
.taxas span { font-size: 0.9rem; }
.taxas small { color: var(--ink-3); font-size: 0.8125rem; }
</style>

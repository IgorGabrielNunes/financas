<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, type Cartao, type Conta, type Fatura } from '../../../core/api';
import { abrirLancamento, versao } from '../../../core/store';
import { dataCurta, diasAte, dinheiro, mesAno, pct } from '../../../core/format';

type Dash = {
  hoje: string;
  horizonte: string;
  proxima_receita: { data: string; descricao: string } | null;
  receitas_a_confirmar: { id: string; descricao: string; valor_centavos: number; data: string }[];
  disponivel: {
    disponivel_centavos: number; saldo_contas_centavos: number; receitas_previstas_centavos: number;
    despesas_previstas_centavos: number; faturas_a_pagar_centavos: number; faturas: Fatura[];
  };
  contas: Conta[];
  cartoes: (Cartao & { gasto_seguro_centavos: number })[];
  dividas: {
    qtd: number; saldo_centavos: number; parcelas_mensais_centavos: number; desconto_folha_centavos: number;
    renda_mensal_centavos: number; comprometimento_pct: number | null; inadimplencias_qtd: number; inadimplencias_em_aberto_centavos: number;
  };
  projecao: { competencia: string; receitas_centavos: number; despesas_centavos: number; faturas_centavos: number; saldo_centavos: number; comprometido_pct: number | null }[];
};

const d = ref<Dash | null>(null);
const erro = ref('');
async function carregar() {
  try { d.value = await api.get<Dash>('/dashboard'); } catch (e) { erro.value = (e as Error).message; }
}
watch(versao, carregar, { immediate: true });

const disp = computed(() => d.value?.disponivel);
const dias = computed(() => (d.value ? diasAte(d.value.horizonte) : 0));
const porDia = computed(() => (disp.value && dias.value > 0 ? Math.max(0, disp.value.disponivel_centavos) / dias.value : 0));

// Régua: o que você tem (saldo + a receber) e o que já está comprometido dentro disso
const regua = computed(() => {
  const x = disp.value;
  if (!x) return null;
  const temos = Math.max(x.saldo_contas_centavos + x.receitas_previstas_centavos, 1);
  const total = Math.max(temos, x.despesas_previstas_centavos + x.faturas_a_pagar_centavos);
  const largura = (v: number) => `${(Math.max(v, 0) / total) * 100}%`;
  return {
    fixos: largura(x.despesas_previstas_centavos),
    faturas: largura(x.faturas_a_pagar_centavos),
    livre: largura(x.disponivel_centavos),
    falta: x.disponivel_centavos < 0,
  };
});

const maiorMes = computed(() => Math.max(1, ...(d.value?.projecao.map((p) => Math.max(p.receitas_centavos, p.despesas_centavos + p.faturas_centavos)) ?? [1])));
const contasAtivas = computed(() => d.value?.contas.filter((c) => c.ativa) ?? []);
const semCadastro = computed(() => d.value && !d.value.contas.length);
</script>

<template>
  <div class="pagina">
    <header class="topo">
      <div>
        <p class="suave data">Finanças da casa</p>
        <h1>Visão geral</h1>
      </div>
      <button class="btn primario so-desktop" @click="abrirLancamento()">Lançar</button>
    </header>

    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <section v-if="semCadastro" class="painel vazio">
      <h2>Comece pela sua conta</h2>
      <p>Cadastre a conta onde o salário cai e o saldo de hoje. Depois, os cartões e os fixos do mês.</p>
      <RouterLink class="btn primario" to="/financas/carteira">Cadastrar conta</RouterLink>
    </section>

    <template v-if="d && disp && regua">
      <!-- A resposta principal do app: quanto dá para gastar sem comprometer o que já está prometido -->
      <section :class="['destaque', { negativo: disp.disponivel_centavos < 0 }]">
        <div class="principal">
          <p class="rotulo">
            Livre para gastar até {{ d.proxima_receita ? dataCurta(d.horizonte) : 'o fim do mês' }}
            <span>{{ dias }} {{ dias === 1 ? 'dia' : 'dias' }}</span>
          </p>
          <p class="numero">{{ dinheiro(disp.disponivel_centavos) }}</p>
          <p v-if="disp.disponivel_centavos > 0 && dias > 0" class="apoio">
            {{ dinheiro(porDia) }} por dia<template v-if="d.proxima_receita">, até {{ d.proxima_receita.descricao }}</template>
          </p>
          <p v-else-if="disp.disponivel_centavos < 0" class="apoio">O que já está comprometido passa do que você tem. Segure gastos novos.</p>

          <div class="regua" role="img" :aria-label="`Fixos ${dinheiro(disp.despesas_previstas_centavos)}, faturas ${dinheiro(disp.faturas_a_pagar_centavos)}, livre ${dinheiro(disp.disponivel_centavos)}`">
            <i class="fixos" :style="{ width: regua.fixos }" />
            <i class="faturas" :style="{ width: regua.faturas }" />
            <i class="livre" :style="{ width: regua.livre }" />
          </div>
        </div>

        <dl class="conta">
          <div><dt>Nas contas hoje</dt><dd>{{ dinheiro(disp.saldo_contas_centavos) }}</dd></div>
          <div><dt>A receber até lá</dt><dd>+ {{ dinheiro(disp.receitas_previstas_centavos) }}</dd></div>
          <div><dt><i class="pino fixos" />Contas e fixos</dt><dd>− {{ dinheiro(disp.despesas_previstas_centavos) }}</dd></div>
          <div><dt><i class="pino faturas" />Faturas que vencem</dt><dd>− {{ dinheiro(disp.faturas_a_pagar_centavos) }}</dd></div>
        </dl>
      </section>

      <div v-if="d.receitas_a_confirmar.length" class="pendencia">
        <p>
          <b>Entrada não confirmada:</b>
          <template v-for="(r, i) in d.receitas_a_confirmar" :key="r.id">{{ i ? ', ' : ' ' }}{{ r.descricao }} de {{ dataCurta(r.data) }} ({{ dinheiro(r.valor_centavos) }})</template>.
          Fica fora do valor acima até você confirmar.
        </p>
        <button v-for="r in d.receitas_a_confirmar" :key="r.id" class="btn" @click="abrirLancamento(r.id, { status: 'realizado' })">Confirmar {{ r.descricao }}</button>
      </div>

      <div class="grade-2">
        <section class="secao">
          <header><h2>Cartões</h2><RouterLink class="btn link" to="/financas/cartoes">Ver todos</RouterLink></header>
          <ul v-if="d.cartoes.length" class="lista painel">
            <li v-for="c in d.cartoes" :key="c.id" class="clicavel" @click="$router.push(`/financas/cartoes/${c.id}`)">
              <span class="ico" :style="{ '--c': c.cor }"><svg viewBox="0 0 24 24"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5zM3 10.5h18" /></svg></span>
              <div>
                <div class="titulo">{{ c.nome }}</div>
                <div class="meta">Fatura de {{ mesAno(c.fatura_atual.competencia) }}: {{ dinheiro(c.fatura_atual.total_centavos) }}</div>
              </div>
              <div class="valor">
                <div class="meta">pode passar</div>
                {{ dinheiro(c.gasto_seguro_centavos) }}
              </div>
            </li>
          </ul>
          <p v-else class="painel vazio">Nenhum cartão ativo. Esse é o objetivo, não é?</p>
          <p class="miudo suave">"Pode passar" é o menor entre o limite livre e o que sobra no seu caixa. Limite não é dinheiro.</p>
        </section>

        <section class="secao">
          <header><h2>Contas</h2><RouterLink class="btn link" to="/financas/carteira">Carteira</RouterLink></header>
          <ul class="lista painel">
            <li v-for="c in contasAtivas" :key="c.id">
              <span class="ico" :style="{ '--c': c.cor }">{{ c.nome.slice(0, 1).toUpperCase() }}</span>
              <div>
                <div class="titulo">{{ c.nome }}</div>
                <div v-if="c.pessoa_nome" class="meta">{{ c.pessoa_nome }}</div>
              </div>
              <div :class="['valor', { sai: c.saldo_centavos < 0 }]">{{ dinheiro(c.saldo_centavos) }}</div>
            </li>
          </ul>
        </section>
      </div>

      <section v-if="d.dividas.qtd || d.dividas.inadimplencias_qtd || d.dividas.renda_mensal_centavos" class="secao">
        <header><h2>Renda e dívidas</h2><RouterLink class="btn link" to="/financas/dividas">Dívidas</RouterLink></header>
        <div class="kpis">
          <div><span>Renda líquida da casa</span><b>{{ dinheiro(d.dividas.renda_mensal_centavos) }}</b><small>por mês</small></div>
          <div>
            <span>Parcelas de dívidas</span>
            <b>{{ dinheiro(d.dividas.parcelas_mensais_centavos) }}</b>
            <small v-if="d.dividas.comprometimento_pct !== null" :class="{ sai: d.dividas.comprometimento_pct > 30 }">{{ pct(d.dividas.comprometimento_pct) }} da renda</small>
            <small v-if="d.dividas.desconto_folha_centavos">+ {{ dinheiro(d.dividas.desconto_folha_centavos) }} em folha</small>
          </div>
          <div><span>Falta pagar em dívidas</span><b class="sai">{{ dinheiro(d.dividas.saldo_centavos) }}</b></div>
          <RouterLink to="/financas/dividas?aba=inadimplencia" class="atalho">
            <span>Em atraso</span>
            <b :class="{ sai: d.dividas.inadimplencias_qtd }">{{ d.dividas.inadimplencias_qtd ? dinheiro(d.dividas.inadimplencias_em_aberto_centavos) : 'Nada' }}</b>
            <small v-if="d.dividas.inadimplencias_qtd">{{ d.dividas.inadimplencias_qtd }} {{ d.dividas.inadimplencias_qtd === 1 ? 'pendência' : 'pendências' }}</small>
          </RouterLink>
        </div>
      </section>

      <section class="secao">
        <header>
          <h2>Próximos 6 meses</h2>
          <span>quanto da receita já está prometido</span>
        </header>
        <div class="painel recheado">
          <div class="meses">
            <RouterLink v-for="p in d.projecao" :key="p.competencia" class="mes" :to="`/financas/mes/${p.competencia.slice(0, 4)}/${+p.competencia.slice(5, 7)}`">
              <div class="barras">
                <div class="receita" :style="{ height: (p.receitas_centavos / maiorMes) * 100 + '%' }" />
                <div class="saida">
                  <i class="faturas" :style="{ height: (p.faturas_centavos / maiorMes) * 100 + '%' }" />
                  <i class="fixos" :style="{ height: (p.despesas_centavos / maiorMes) * 100 + '%' }" />
                </div>
              </div>
              <b>{{ mesAno(p.competencia) }}</b>
              <span :class="['pct', { sai: p.saldo_centavos < 0 }]">{{ p.comprometido_pct === null ? 'sem receita' : pct(p.comprometido_pct) }}</span>
            </RouterLink>
          </div>
          <ul class="legenda">
            <li><i class="receita-l" />Receitas previstas</li>
            <li><i class="fixos" />Contas e fixos</li>
            <li><i class="faturas" />Faturas</li>
          </ul>
        </div>
      </section>

      <section v-if="disp.faturas.length" class="secao">
        <header><h2>Faturas até {{ dataCurta(d.horizonte) }}</h2></header>
        <ul class="lista painel">
          <li v-for="f in disp.faturas" :key="f.id" class="clicavel" @click="$router.push(`/financas/faturas/${f.id}`)">
            <span class="ico" :style="{ '--c': f.cartao_cor }"><svg viewBox="0 0 24 24"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5zM3 10.5h18" /></svg></span>
            <div>
              <div class="titulo">{{ f.cartao_nome }}, fatura de {{ mesAno(f.competencia) }}</div>
              <div class="meta">Vence {{ dataCurta(f.data_vencimento) }}</div>
            </div>
            <div class="valor sai">{{ dinheiro(f.em_aberto_centavos) }}</div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.topo { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
.topo .data { font-size: 0.875rem; margin-bottom: 4px; }
.topo .data::first-letter { text-transform: uppercase; }

/* ---------------------------------------------------- painel de destaque */
.destaque {
  --t: rgba(255, 255, 255, 0.72);
  background: var(--marca); color: #fff; border-radius: var(--raio-l);
  padding: 28px 30px; display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr); gap: 28px 40px; align-items: end;
  box-shadow: 0 1px 2px rgba(15, 75, 58, 0.2), 0 18px 40px -18px rgba(15, 75, 58, 0.55);
}
.destaque.negativo { background: #7a2238; }
.principal { display: grid; gap: 6px; min-width: 0; }
.rotulo { color: var(--t); font-weight: 500; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rotulo span { font-size: 0.75rem; font-weight: 600; color: #fff; background: rgba(255, 255, 255, 0.14); padding: 3px 9px; border-radius: 999px; }
.numero { font-size: clamp(2.6rem, 8vw, 4.4rem); font-weight: 750; letter-spacing: -0.045em; line-height: 1.02; }
.apoio { color: var(--t); }
.regua { display: flex; height: 10px; border-radius: 6px; overflow: hidden; background: rgba(255, 255, 255, 0.14); margin-top: 16px; gap: 2px; }
.regua i { display: block; height: 100%; }
.regua i:first-child { border-radius: 6px 0 0 6px; }
.regua .fixos { background: #f2b25b; }
.regua .faturas { background: #f28aa5; }
.regua .livre { background: #8fe0bd; }

.conta { margin: 0; display: grid; gap: 0; }
.conta div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 9px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.12); }
.conta div:last-child { border-bottom: 0; }
.conta dt { color: var(--t); font-size: 0.875rem; display: flex; align-items: center; gap: 8px; }
.conta dd { margin: 0; font-weight: 650; white-space: nowrap; }
.pino { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.pino.fixos { background: #f2b25b; }
.pino.faturas { background: #f28aa5; }
@media (max-width: 760px) {
  .destaque { grid-template-columns: 1fr; padding: 22px 20px; border-radius: var(--raio-m); gap: 18px; }
}

.pendencia {
  display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; padding: 14px 16px;
  background: var(--previsto-tint); border-radius: var(--raio-m); font-size: 0.9rem;
}
.pendencia p { flex: 1 1 320px; }

.atalho:hover { background: var(--surface-2); }

/* ------------------------------------------------------------ projeção */
.meses { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.mes { display: grid; gap: 4px; justify-items: center; text-decoration: none; font-size: 0.8125rem; padding: 8px 4px 6px; border-radius: var(--raio-s); }
.mes:hover { background: var(--surface-2); }
.mes b { font-weight: 600; }
.pct { color: var(--ink-3); font-size: 0.8125rem; }
.barras { height: 128px; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 4px; margin-bottom: 6px; }
.receita { width: 16px; background: color-mix(in srgb, var(--entra) 28%, var(--surface)); border-radius: 5px 5px 2px 2px; }
.saida { width: 16px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; }
.saida i { display: block; }
.saida i:first-child { border-radius: 5px 5px 0 0; }
.saida .fixos, .legenda .fixos { background: var(--previsto); }
.saida .faturas, .legenda .faturas { background: var(--sai); }
.legenda { list-style: none; margin: 16px 0 0; padding: 14px 0 0; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--ink-2); font-size: 0.8125rem; }
.legenda li { display: flex; align-items: center; gap: 8px; }
.legenda i { width: 10px; height: 10px; border-radius: 3px; }
.legenda .receita-l { background: color-mix(in srgb, var(--entra) 28%, var(--surface)); }
@media (max-width: 760px) {
  .meses { gap: 0; }
  .mes { font-size: 0.72rem; padding: 6px 0; }
  .receita, .saida { width: 12px; }
}
</style>

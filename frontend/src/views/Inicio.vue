<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, type Cartao, type Conta, type Fatura } from '../api';
import { abrirLancamento, versao } from '../store';
import { dataCurta, diasAte, dinheiro, mesAno, pct } from '../format';

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
    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <section v-if="semCadastro" class="painel recheado vazio">
      <h2>Comece pela sua conta</h2>
      <p>Cadastre a conta onde o salário cai e o saldo de hoje. Depois, os cartões e os fixos do mês.</p>
      <RouterLink class="btn primario" to="/carteira">Cadastrar conta</RouterLink>
    </section>

    <template v-if="d && disp && regua">
      <!-- A resposta principal do app: quanto dá para gastar sem comprometer o que já está prometido -->
      <section class="hero">
        <p class="contexto">
          Até {{ d.proxima_receita ? dataCurta(d.horizonte) : 'o fim do mês' }}
          <span class="suave">({{ dias }} {{ dias === 1 ? 'dia' : 'dias' }})</span>, dá para gastar
        </p>
        <h1 :class="['numero', { negativo: disp.disponivel_centavos < 0 }]">{{ dinheiro(disp.disponivel_centavos) }}</h1>
        <p v-if="disp.disponivel_centavos > 0 && dias > 0" class="suave">
          Isso dá {{ dinheiro(porDia) }} por dia<template v-if="d.proxima_receita">. Próxima entrada: {{ d.proxima_receita.descricao }}</template>.
        </p>
        <p v-else-if="disp.disponivel_centavos < 0" class="sai">O que já está comprometido passa do que você tem. Segure gastos novos.</p>

        <div v-if="d.receitas_a_confirmar.length" class="pendencia">
          <p>
            <b>Entrada não confirmada:</b>
            <template v-for="(r, i) in d.receitas_a_confirmar" :key="r.id">{{ i ? ', ' : ' ' }}{{ r.descricao }} de {{ dataCurta(r.data) }} ({{ dinheiro(r.valor_centavos) }})</template>.
            Enquanto não confirmar, ela fica fora do valor acima.
          </p>
          <button v-for="r in d.receitas_a_confirmar" :key="r.id" class="btn" @click="abrirLancamento(r.id, { status: 'realizado' })">Confirmar {{ r.descricao }}</button>
        </div>

        <div class="regua" role="img" :aria-label="`Fixos ${dinheiro(disp.despesas_previstas_centavos)}, faturas ${dinheiro(disp.faturas_a_pagar_centavos)}, livre ${dinheiro(disp.disponivel_centavos)}`">
          <i class="fixos" :style="{ width: regua.fixos }" />
          <i class="faturas" :style="{ width: regua.faturas }" />
          <i class="livre" :style="{ width: regua.livre }" />
        </div>

        <dl class="conta">
          <div><dt>Nas contas hoje</dt><dd>{{ dinheiro(disp.saldo_contas_centavos) }}</dd></div>
          <div><dt>A receber até lá</dt><dd class="entra">+ {{ dinheiro(disp.receitas_previstas_centavos) }}</dd></div>
          <div><dt><i class="pino fixos" />Contas e fixos a pagar</dt><dd class="previsto">− {{ dinheiro(disp.despesas_previstas_centavos) }}</dd></div>
          <div><dt><i class="pino faturas" />Faturas que vencem</dt><dd class="sai">− {{ dinheiro(disp.faturas_a_pagar_centavos) }}</dd></div>
        </dl>
      </section>

      <div class="grade-2">
        <section class="secao">
          <header><h2>Cartões</h2><RouterLink class="btn link" to="/cartoes">Central de cartões</RouterLink></header>
          <ul v-if="d.cartoes.length" class="lista painel">
            <li v-for="c in d.cartoes" :key="c.id" class="clicavel" @click="$router.push(`/cartoes/${c.id}`)">
              <span class="pin" :style="{ background: c.cor }" />
              <div>
                <div class="titulo">{{ c.nome }}</div>
                <div class="meta">Fatura de {{ mesAno(c.fatura_atual.competencia) }}: {{ dinheiro(c.fatura_atual.total_centavos) }}, livre {{ dinheiro(c.livre_centavos) }}</div>
              </div>
              <div class="valor">
                <div class="miudo suave">pode passar</div>
                {{ dinheiro(c.gasto_seguro_centavos) }}
              </div>
            </li>
          </ul>
          <p v-else class="painel vazio">Nenhum cartão ativo. Esse é o objetivo, não é?</p>
          <p class="miudo suave">"Pode passar" é o menor entre o limite livre e o que sobra no seu caixa. Limite não é dinheiro.</p>
        </section>

        <section class="secao">
          <header><h2>Contas</h2><RouterLink class="btn link" to="/carteira">Carteira</RouterLink></header>
          <ul class="lista painel">
            <li v-for="c in contasAtivas" :key="c.id">
              <span class="pin" :style="{ background: c.cor }" />
              <div class="titulo">{{ c.nome }}</div>
              <div :class="['valor', { sai: c.saldo_centavos < 0 }]">{{ dinheiro(c.saldo_centavos) }}</div>
            </li>
          </ul>
        </section>
      </div>

      <section v-if="d.dividas.qtd || d.dividas.inadimplencias_qtd || d.dividas.renda_mensal_centavos" class="secao">
        <header><h2>Renda e dívidas</h2><RouterLink class="btn link" to="/dividas">Dívidas</RouterLink></header>
        <div class="painel faixa">
          <div><span>Renda líquida da casa</span><b>{{ dinheiro(d.dividas.renda_mensal_centavos) }}</b></div>
          <div>
            <span>Parcelas de dívidas por mês</span>
            <b>{{ dinheiro(d.dividas.parcelas_mensais_centavos) }}</b>
            <small v-if="d.dividas.comprometimento_pct !== null" :class="{ sai: d.dividas.comprometimento_pct > 30 }">{{ pct(d.dividas.comprometimento_pct) }} da renda</small>
            <small v-if="d.dividas.desconto_folha_centavos">+ {{ dinheiro(d.dividas.desconto_folha_centavos) }} descontados em folha</small>
          </div>
          <div><span>Falta pagar em dívidas</span><b class="sai">{{ dinheiro(d.dividas.saldo_centavos) }}</b></div>
          <RouterLink to="/dividas?aba=inadimplencia" class="sem-sublinhado">
            <span>Em atraso</span>
            <b :class="{ sai: d.dividas.inadimplencias_qtd }">{{ d.dividas.inadimplencias_qtd ? dinheiro(d.dividas.inadimplencias_em_aberto_centavos) : 'Nada' }}</b>
            <small v-if="d.dividas.inadimplencias_qtd">{{ d.dividas.inadimplencias_qtd }} {{ d.dividas.inadimplencias_qtd === 1 ? 'pendência' : 'pendências' }}</small>
          </RouterLink>
        </div>
      </section>

      <section class="secao">
        <header>
          <h2>Próximos 6 meses</h2>
          <span>Quanto da receita de cada mês já está prometido</span>
        </header>
        <div class="painel recheado meses">
          <RouterLink v-for="p in d.projecao" :key="p.competencia" class="mes" :to="`/mes/${p.competencia.slice(0, 4)}/${+p.competencia.slice(5, 7)}`">
            <div class="barras">
              <div class="receita" :style="{ height: (p.receitas_centavos / maiorMes) * 100 + '%' }" />
              <div class="saida">
                <i class="faturas" :style="{ height: (p.faturas_centavos / maiorMes) * 100 + '%' }" />
                <i class="fixos" :style="{ height: (p.despesas_centavos / maiorMes) * 100 + '%' }" />
              </div>
            </div>
            <b>{{ mesAno(p.competencia) }}</b>
            <span :class="p.saldo_centavos < 0 ? 'sai' : 'suave'">{{ p.comprometido_pct === null ? 'sem receita' : pct(p.comprometido_pct) }}</span>
          </RouterLink>
        </div>
        <p class="miudo suave">Barra clara: receitas previstas. Barra escura: fixos (âmbar) e faturas (vinho). Parcelas futuras aparecem aqui antes de virarem problema.</p>
      </section>

      <section v-if="disp.faturas.length" class="secao">
        <header><h2>Faturas até {{ dataCurta(d.horizonte) }}</h2></header>
        <ul class="lista painel">
          <li v-for="f in disp.faturas" :key="f.id" class="clicavel" @click="$router.push(`/faturas/${f.id}`)">
            <span class="pin" :style="{ background: f.cartao_cor }" />
            <div>
              <div class="titulo">{{ f.cartao_nome }}, {{ mesAno(f.competencia) }}</div>
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
.hero { display: grid; gap: 10px; padding: 8px 0 4px; }
.contexto { font-size: 1.05rem; max-width: 40ch; }
.numero { font-size: clamp(2.8rem, 11vw, 4.75rem); font-weight: 700; letter-spacing: -0.035em; line-height: 1; color: var(--entra); }
.numero.negativo { color: var(--sai); }

.pendencia { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 10px 14px; border-left: 3px solid var(--previsto); background: var(--surface); border-radius: 0 var(--raio-s) var(--raio-s) 0; font-size: 0.9rem; }
.pendencia p { flex: 1 1 320px; }
.regua { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: var(--surface-2); border: 1px solid var(--line); margin-top: 8px; }
.regua i { display: block; height: 100%; }
.fixos { background: var(--previsto); }
.faturas { background: var(--sai); }
.livre { background: var(--entra); }

.conta { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr)); gap: 4px 24px; margin: 4px 0 0; }
.conta div { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--line); }
.conta dt { color: var(--ink-2); font-size: 0.875rem; display: flex; align-items: center; gap: 6px; }
.conta dd { margin: 0; font-weight: 600; white-space: nowrap; }
.conta div { align-items: baseline; }
.pino { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }

.faixa { display: grid; grid-template-columns: repeat(4, 1fr); }
.faixa > * { display: grid; gap: 2px; align-content: start; padding: 16px 18px; border-left: 1px solid var(--line); color: inherit; }
.faixa > :first-child { border-left: 0; }
.faixa span { font-size: 0.8125rem; color: var(--ink-2); }
.faixa b { font: 700 1.3rem var(--display); }
.faixa small { font-size: 0.75rem; color: var(--ink-3); }
.faixa small.sai { color: var(--sai); }
.sem-sublinhado { text-decoration: none; }
.sem-sublinhado:hover { background: var(--surface-2); }
@media (max-width: 760px) {
  .faixa { grid-template-columns: 1fr 1fr; }
  .faixa > :nth-child(3) { border-left: 0; }
  .faixa > :nth-child(n + 3) { border-top: 1px solid var(--line); }
}
.meses { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
@media (max-width: 760px) { .meses { gap: 2px; padding: 12px 8px; } .mes { font-size: 0.75rem; padding: 4px 0; } }
.mes { display: grid; gap: 4px; justify-items: center; text-decoration: none; font-size: 0.8125rem; padding: 4px; border-radius: var(--raio-s); }
.mes:hover { background: var(--surface-2); }
.barras { height: 120px; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 3px; }
.receita { width: 14px; background: color-mix(in srgb, var(--entra) 35%, transparent); border-radius: 3px 3px 0 0; }
.saida { width: 14px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; }
.saida i { display: block; }
.saida i:first-child { border-radius: 3px 3px 0 0; }
</style>

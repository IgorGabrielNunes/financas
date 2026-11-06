<script setup lang="ts">
// Simulador: compara onde aplicar (valor inicial + aporte mensal por N meses) contra o seu modelo atual.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../../core/api';
import { dataCurta, dinheiro, pct } from '../../../core/format';
import MoneyInput from '../../../ui/MoneyInput.vue';
import GraficoLinhas from '../../../ui/GraficoLinhas.vue';
import { INDEXADORES, numero, rotuloModelo, taxa2, type Investimento, type Opcao, type Resultado, type Simulacao } from '../investir';

const props = defineProps<{ itens: Investimento[]; atualInicial?: string | null }>();
const CHAVE = 'vida.simulador.opcoes';

const projetaveis = computed(() => props.itens.filter((i) => i.ativo && i.indexador !== 'nenhum'));
const maior = computed(() => [...projetaveis.value].sort((a, b) => b.posicao.saldo_bruto_centavos - a.posicao.saldo_bruto_centavos)[0]);
const f = reactive({
  inicial_centavos: 1_000_000,
  mensal_centavos: 50_000,
  meses: 24,
  atual_id: (props.atualInicial ?? null) as string | null,
});
const PRAZOS = [3, 6, 12, 18, 24, 36, 48, 60, 120, 240, 360];
const rotuloPrazo = (m: number) => (m === 1 ? '1 mês' : m < 12 ? `${m} meses` : m % 12 ? `${m} meses` : m === 12 ? '1 ano' : `${m / 12} anos`);

// opções editáveis (ficam salvas neste navegador)
const opcoes = ref<Opcao[]>([]);
const editando = ref(false);
function salvarOpcoes() { try { localStorage.setItem(CHAVE, JSON.stringify(opcoes.value)); } catch { /* sem storage */ } }
async function padrao() { opcoes.value = await api.get<Opcao[]>('/investimentos/opcoes'); salvarOpcoes(); }
onMounted(async () => {
  let salvas: Opcao[] | null = null;
  try { salvas = JSON.parse(localStorage.getItem(CHAVE) ?? 'null'); } catch { salvas = null; }
  if (Array.isArray(salvas) && salvas.length) opcoes.value = salvas; else await padrao();
  if (!f.atual_id && maior.value) f.atual_id = maior.value.id;
  if (f.atual_id) usarSaldoAtual(false);
});
watch(() => props.atualInicial, (v) => { if (v) { f.atual_id = v; usarSaldoAtual(false); } });

const atualInv = computed(() => props.itens.find((i) => i.id === f.atual_id) ?? null);
function usarSaldoAtual(forcar = true) {
  const s = atualInv.value?.posicao.saldo_bruto_centavos;
  if (s && (forcar || s > 0)) f.inicial_centavos = s;
}
function adicionar() {
  opcoes.value.push({ chave: `minha-${Date.now()}`, nome: 'Minha opção', modelo: { indexador: 'cdi', taxa: 100, isento_ir: false }, liquidez: 'diaria', nota: 'Opção personalizada.' });
  salvarOpcoes();
}
function remover(k: string) { opcoes.value = opcoes.value.filter((o) => o.chave !== k); salvarOpcoes(); }
function taxa(o: Opcao, v: string) { const x = numero(v); if (x !== null) { o.modelo.taxa = x; salvarOpcoes(); } }

// simulação no servidor (a mesma conta usada no resto do app), com debounce
const r = ref<Simulacao | null>(null);
const carregando = ref(false);
const erro = ref('');
let t: ReturnType<typeof setTimeout> | undefined;
watch([f, opcoes], () => {
  clearTimeout(t);
  t = setTimeout(async () => {
    if (!opcoes.value.length) return;
    carregando.value = true;
    try {
      r.value = await api.post<Simulacao>('/investimentos/simular', {
        ...f, opcoes: opcoes.value.map((o) => ({ chave: o.chave, nome: o.nome, modelo: o.modelo })),
      });
      erro.value = '';
    } catch (e) { erro.value = (e as Error).message; } finally { carregando.value = false; }
  }, 350);
}, { deep: true, immediate: true });

const extra = (k: string) => opcoes.value.find((o) => o.chave === k);
const melhor = computed(() => r.value?.resultados[0] ?? null);
const maxLiq = computed(() => Math.max(1, ...(r.value?.resultados.map((x) => x.liquido_centavos) ?? [1]), r.value?.atual?.liquido_centavos ?? 1));
const minLiq = computed(() => Math.min(...(r.value?.resultados.map((x) => x.investido_centavos) ?? [0])));
const largura = (v: number) => `${Math.max(4, ((v - minLiq.value) / Math.max(1, maxLiq.value - minLiq.value)) * 100)}%`;
const dif = (x: Resultado) => (r.value?.atual ? x.liquido_centavos - r.value.atual.liquido_centavos : null);
const sinal = (v: number) => (v > 0 ? `+ ${dinheiro(v)}` : v < 0 ? `− ${dinheiro(-v)}` : 'igual');

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const grafico = computed(() => {
  const x = r.value;
  if (!x?.resultados.length) return null;
  const linhas: { nome: string; cor: string; valores: number[]; tracejada?: boolean }[] = [];
  const ref0 = x.atual ?? x.resultados[0];
  if (x.atual) linhas.push({ nome: `Atual: ${x.atual.nome}`, cor: 'var(--marca)', valores: x.atual.serie.map((s) => s.liquido_centavos) });
  const top = x.resultados[0];
  if (!x.atual || top.liquido_centavos > x.atual.liquido_centavos) linhas.push({ nome: top.nome, cor: 'var(--entra)', valores: top.serie.map((s) => s.liquido_centavos) });
  const poup = x.resultados.find((o) => o.modelo.indexador === 'poupanca');
  if (poup && poup !== top) linhas.push({ nome: poup.nome, cor: 'var(--previsto)', valores: poup.serie.map((s) => s.liquido_centavos) });
  linhas.push({ nome: 'Só guardando', cor: 'var(--ink-3)', valores: ref0.serie.map((s) => s.investido_centavos), tracejada: true });
  return { linhas, rotulos: ref0.serie.map((s) => rotuloPrazo(s.mes)) };
});
</script>

<template>
  <div class="sim">
    <section class="painel entradas form">
      <div class="linha">
        <label class="campo"><span>Valor inicial</span><MoneyInput v-model="f.inicial_centavos" /></label>
        <label class="campo"><span>Aporte por mês</span><MoneyInput v-model="f.mensal_centavos" /></label>
        <label class="campo"><span>Por quanto tempo</span>
          <select v-model.number="f.meses"><option v-for="m in PRAZOS" :key="m" :value="m">{{ rotuloPrazo(m) }}</option></select>
        </label>
      </div>
      <div class="linha atual">
        <label class="campo"><span>Seu modelo atual (para comparar)</span>
          <select v-model="f.atual_id">
            <option :value="null">Nenhum</option>
            <option v-for="i in projetaveis" :key="i.id" :value="i.id">{{ i.nome }} · {{ rotuloModelo(i) }}</option>
          </select>
        </label>
        <button v-if="atualInv && atualInv.posicao.saldo_bruto_centavos !== f.inicial_centavos" type="button" class="btn" @click="usarSaldoAtual()">
          Usar o saldo dele ({{ dinheiro(atualInv.posicao.saldo_bruto_centavos) }})
        </button>
      </div>
    </section>

    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <template v-if="r && r.resultados.length">
      <section :class="['veredito', { carregando }]">
        <template v-if="r.atual && melhor">
          <p class="rotulo">Mantendo {{ r.atual.nome }} ({{ rotuloModelo(r.atual.modelo) }}), em {{ rotuloPrazo(f.meses) }} você teria</p>
          <p class="numero">{{ dinheiro(r.atual.liquido_centavos) }}</p>
          <p class="apoio">
            {{ dinheiro(r.atual.rendimento_liquido_centavos) }} de rendimento já sem IR, {{ taxa2(r.atual.taxa_liquida_aa_pct) }} ao ano líquido.
            <template v-if="melhor.liquido_centavos - r.atual.liquido_centavos > 100">
              <b>{{ melhor.nome }}</b> daria {{ dinheiro(melhor.liquido_centavos - r.atual.liquido_centavos) }} a mais.
            </template>
            <template v-else><b>Seu modelo está entre os melhores</b> das opções comparadas.</template>
          </p>
        </template>
        <template v-else-if="melhor">
          <p class="rotulo">Melhor resultado em {{ rotuloPrazo(f.meses) }}</p>
          <p class="numero">{{ dinheiro(melhor.liquido_centavos) }}</p>
          <p class="apoio">{{ melhor.nome }}: {{ dinheiro(melhor.rendimento_liquido_centavos) }} de rendimento já sem IR, sobre {{ dinheiro(melhor.investido_centavos) }} guardados.</p>
        </template>
      </section>

      <section class="secao">
        <header>
          <h2>Comparação</h2>
          <button class="btn link" type="button" @click="editando = !editando">{{ editando ? 'Pronto' : 'Ajustar taxas' }}</button>
        </header>
        <ol class="ranking painel">
          <li v-if="r.atual" class="linha-atual">
            <div class="nome"><b>Seu modelo: {{ r.atual.nome }}</b><small>{{ rotuloModelo(r.atual.modelo) }} · {{ taxa2(r.atual.taxa_liquida_aa_pct) }} a.a. líquido</small></div>
            <div class="barra"><i :style="{ width: largura(r.atual.liquido_centavos) }" /></div>
            <div class="vals"><b>{{ dinheiro(r.atual.liquido_centavos) }}</b><small>+ {{ dinheiro(r.atual.rendimento_liquido_centavos) }}</small></div>
          </li>
          <li v-for="(x, k) in r.resultados" :key="x.chave">
            <div class="nome">
              <b><span class="pos">{{ k + 1 }}</span>{{ x.nome }}</b>
              <small>
                {{ rotuloModelo(x.modelo) }} · {{ taxa2(x.taxa_liquida_aa_pct) }} a.a. líquido
                <template v-if="x.modelo.isento_ir"> · isento de IR</template>
                <template v-else> · IR {{ dinheiro(x.ir_centavos) }}</template>
                <template v-if="extra(x.chave)?.liquidez === 'vencimento'"> · dinheiro preso até o vencimento</template>
              </small>
              <small v-if="extra(x.chave)?.nota" class="nota">{{ extra(x.chave)!.nota }}</small>
              <div v-if="editando" class="edita">
                <label>{{ INDEXADORES[x.modelo.indexador].taxa ? 'Taxa' : 'Sem taxa' }}
                  <input v-if="INDEXADORES[x.modelo.indexador].taxa" :value="String(extra(x.chave)?.modelo.taxa ?? x.modelo.taxa).replace('.', ',')" inputmode="decimal" @change="taxa(extra(x.chave)!, ($event.target as HTMLInputElement).value)" />
                </label>
                <template v-if="extra(x.chave)?.chave.startsWith('minha-')">
                  <input :value="extra(x.chave)!.nome" aria-label="Nome da opção" @change="extra(x.chave)!.nome = ($event.target as HTMLInputElement).value; salvarOpcoes()" />
                  <select :value="extra(x.chave)!.modelo.indexador" aria-label="Indexador" @change="extra(x.chave)!.modelo.indexador = ($event.target as HTMLSelectElement).value as any; salvarOpcoes()">
                    <option v-for="(ix, kk) in INDEXADORES" :key="kk" :value="kk" :disabled="kk === 'nenhum'">{{ ix.nome }}</option>
                  </select>
                  <label class="chk"><input type="checkbox" :checked="extra(x.chave)!.modelo.isento_ir" @change="extra(x.chave)!.modelo.isento_ir = ($event.target as HTMLInputElement).checked; salvarOpcoes()" /> Isento</label>
                </template>
                <button type="button" class="btn link" @click="remover(x.chave)">Remover</button>
              </div>
            </div>
            <div class="barra"><i :style="{ width: largura(x.liquido_centavos) }" :class="{ top: k === 0 }" /></div>
            <div class="vals">
              <b>{{ dinheiro(x.liquido_centavos) }}</b>
              <small>+ {{ dinheiro(x.rendimento_liquido_centavos) }}</small>
              <small v-if="dif(x) !== null" :class="['dif', { entra: dif(x)! > 100, sai: dif(x)! < -100 }]">{{ sinal(dif(x)!) }} vs atual</small>
            </div>
          </li>
        </ol>
        <div v-if="editando" class="rodape-edita">
          <button type="button" class="btn" @click="adicionar">Adicionar opção</button>
          <button type="button" class="btn link" @click="padrao">Voltar às opções padrão</button>
        </div>
      </section>

      <section v-if="grafico" class="painel recheado">
        <h3>Evolução do valor líquido</h3>
        <GraficoLinhas :series="grafico.linhas" :rotulos="grafico.rotulos" :formatar="reais" />
      </section>

      <p class="miudo suave">
        Valores líquidos de IR e IOF, se resgatar no fim do prazo, usando as taxas de hoje como se ficassem iguais o período todo:
        CDI {{ taxa2(r.taxas.cdi_aa) }}, Selic {{ taxa2(r.taxas.selic_aa) }}, IPCA {{ taxa2(r.taxas.ipca_aa) }}
        ({{ r.taxas.fonte === 'bcb' ? `Banco Central, ${dataCurta(r.taxas.atualizado_em.slice(0, 10))}` : r.taxas.fonte === 'manual' ? 'ajustadas por você' : 'valores padrão' }}).
        Juros mudam; é uma comparação, não promessa. Taxas de títulos e CDBs variam por banco e por dia: confira a oferta real antes de aplicar.
      </p>
    </template>
    <p v-else-if="r && !r.resultados.length" class="painel vazio">Informe um valor inicial ou um aporte mensal para simular.</p>
  </div>
</template>

<style scoped>
.sim { display: grid; gap: 24px; min-width: 0; }
.entradas { padding: 18px; display: grid; gap: 14px; }
.atual { align-items: end; }
.atual .btn { min-height: 44px; }

.veredito { background: var(--marca); color: #fff; border-radius: var(--raio-l); padding: 24px 26px; display: grid; gap: 6px; transition: opacity 0.15s; }
.veredito.carregando { opacity: 0.7; }
.veredito .rotulo { color: rgba(255, 255, 255, 0.75); font-weight: 500; }
.veredito .numero { font-size: clamp(2.2rem, 7vw, 3.4rem); font-weight: 750; letter-spacing: -0.04em; line-height: 1.05; }
.veredito .apoio { color: rgba(255, 255, 255, 0.85); max-width: 70ch; }
.veredito b { color: #fff; }

.ranking { list-style: none; margin: 0; padding: 4px 0; }
.ranking li {
  display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(80px, 1fr) auto; gap: 8px 18px; align-items: center;
  padding: 14px 18px; position: relative;
}
.ranking li + li::before { content: ''; position: absolute; top: 0; left: 18px; right: 18px; border-top: 1px solid var(--line); }
.linha-atual { background: var(--marca-tint); border-radius: var(--raio-m) var(--raio-m) 0 0; }
.linha-atual .barra i { background: var(--marca); }
.nome { display: grid; gap: 2px; min-width: 0; }
.nome b { font-weight: 600; display: flex; gap: 8px; align-items: baseline; }
.nome small { color: var(--ink-3); font-size: 0.8125rem; }
.nome .nota { color: var(--ink-2); }
.pos { font-size: 0.75rem; color: var(--ink-3); min-width: 1.2em; }
.barra { height: 10px; background: var(--surface-3); border-radius: 5px; overflow: hidden; }
.barra i { display: block; height: 100%; background: color-mix(in srgb, var(--entra) 55%, var(--surface)); border-radius: 5px; }
.barra i.top { background: var(--entra); }
.vals { display: grid; justify-items: end; gap: 1px; white-space: nowrap; }
.vals b { font-weight: 700; }
.vals small { font-size: 0.8125rem; color: var(--ink-3); }
.vals .dif { font-weight: 600; color: var(--ink-2); }
.vals .dif.entra { color: var(--entra); }
.vals .dif.sai { color: var(--sai); }
.edita { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; font-size: 0.8125rem; }
.edita label { display: flex; gap: 6px; align-items: center; }
.edita input:not([type='checkbox']) { width: 110px; min-height: 36px; padding: 4px 8px; }
.edita select { min-height: 36px; width: auto; }
.chk input { width: 18px; height: 18px; }
.rodape-edita { display: flex; gap: 10px; flex-wrap: wrap; }
.recheado { padding: 18px; display: grid; gap: 12px; }
h3 { font-size: 0.95rem; }

@media (max-width: 760px) {
  .ranking li { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'nome vals' 'barra barra'; padding: 12px 14px; }
  .nome { grid-area: nome; }
  .vals { grid-area: vals; }
  .barra { grid-area: barra; height: 6px; }
  .veredito { padding: 20px; border-radius: var(--raio-m); }
}
</style>

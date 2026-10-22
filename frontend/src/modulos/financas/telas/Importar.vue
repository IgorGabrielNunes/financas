<script setup lang="ts">
// Importar fatura de cartão: arquivo do banco (CSV, OFX ou JSON) → prévia editável → confirmar (lote desfazível).
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../../core/api';
import { avisar, avisarMudanca, cadastros, carregarCadastros } from '../../../core/store';
import { dataCurta, dinheiro, mesAno } from '../../../core/format';

type Parcela = { atual: number; total: number };
type Item = {
  linha: number; data: string | null; descricao: string; valor_centavos: number; parcela: Parcela | null;
  plano: { data: string; valor_total: number; parcelas_total: number; parcelas_pagas_antes: number; competencia: string; fora_da_fatura: boolean } | null;
  categoria_id: string | null; status: 'novo' | 'duplicado' | 'ignorado' | 'erro'; motivo: string | null;
  // estado da tela
  marcado: boolean;
};
type Previa = {
  formato: 'csv' | 'ofx' | 'json'; sinal_invertido: boolean; avisos: string[];
  cartao: { id: string; nome: string };
  fatura: { competencia: string; dataFechamento: string; dataVencimento: string; total_atual_centavos: number };
  fatura_sugerida: string | null;
  totais: { arquivo_gastos: number; arquivo_creditos: number; novos: number; duplicados: number };
  contagem: Record<Item['status'], number>;
  itens: Item[];
};
type Lote = { id: string; cartao_nome: string; competencia: string; arquivo_nome: string | null; qtd: number; total_centavos: number; created_at: string; criado_por_nome: string | null; ainda_existentes: number };

const route = useRoute();
const f = reactive({ cartao_id: (route.query.cartao as string) || '', vencimento: (route.query.venc as string) || '' });
const arquivo = ref<{ nome: string; conteudo: string } | null>(null);
const colando = ref(false);
const texto = ref('');
const arrastando = ref(false);
const previa = ref<Previa | null>(null);
const filtro = ref<'todos' | Item['status']>('todos');
const carregando = ref(false);
const gravando = ref(false);
const erro = ref('');
const resultado = ref<{ importacao_id: string; criados: number; total_centavos: number; competencia: string } | null>(null);
const lotes = ref<Lote[]>([]);

const cartoes = computed(() => cadastros.cartoes.filter((c) => c.ativo));
const cartao = computed(() => cartoes.value.find((c) => c.id === f.cartao_id) ?? null);
const despesas = computed(() => cadastros.categorias.filter((c) => c.tipo === 'despesa'));

/** Fatura sugerida: a fechada que ainda não foi paga; senão, a que está aberta. */
function faturaSugerida() {
  const c = cartao.value;
  if (!c) return '';
  return (c.fatura_a_pagar?.competencia ?? c.fatura_atual.competencia).slice(0, 7);
}
/** 6 meses para trás e 2 para frente a partir da fatura aberta. */
const meses = computed(() => {
  const base = cartao.value ? cartao.value.fatura_atual.competencia : new Date().toISOString().slice(0, 7) + '-01';
  const [a, m] = [+base.slice(0, 4), +base.slice(5, 7)];
  return Array.from({ length: 9 }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 + 2 - i, 1));
    const v = d.toISOString().slice(0, 7);
    const dia = cartao.value ? String(Math.min(cartao.value.dia_vencimento, 28)).padStart(2, '0') : null;
    return { v, r: `${mesAno(`${v}-01`)}${dia ? ` · vence ${dia}/${v.slice(5, 7)}` : ''}` };
  });
});

onMounted(async () => {
  if (!cadastros.carregado) await carregarCadastros().catch(() => {});
  if (!f.cartao_id && cartoes.value.length === 1) f.cartao_id = cartoes.value[0].id;
  if (!f.vencimento) f.vencimento = faturaSugerida();
  carregarLotes();
});
watch(() => f.cartao_id, () => { f.vencimento = faturaSugerida(); previa.value = null; carregarLotes(); });
watch(() => f.vencimento, () => { previa.value = null; });

/** O arquivo parece ser de outra fatura: troca e lê de novo. */
async function usarSugerida() {
  const v = previa.value?.fatura_sugerida;
  if (!v) return;
  f.vencimento = v;
  await Promise.resolve(); // deixa o watch limpar a prévia antes de ler de novo
  await verPrevia();
}

async function carregarLotes() {
  try { lotes.value = await api.get(`/importacoes${f.cartao_id ? `?cartao_id=${f.cartao_id}` : ''}`); } catch { /* histórico é secundário */ }
}

// ------------------------------------------------------------------ arquivo
/** CSV de banco costuma vir em Windows-1252 (acentos quebrados se lido como UTF-8). */
async function lerComoTexto(file: File) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
async function escolher(file: File | undefined | null) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { erro.value = 'Arquivo grande demais (máx. 2 MB)'; return; }
  erro.value = '';
  arquivo.value = { nome: file.name, conteudo: await lerComoTexto(file) };
  colando.value = false;
  await verPrevia();
}
function soltar(e: DragEvent) {
  arrastando.value = false;
  escolher(e.dataTransfer?.files?.[0]);
}

async function verPrevia() {
  const conteudo = colando.value ? texto.value : arquivo.value?.conteudo;
  if (!f.cartao_id || !f.vencimento || !conteudo?.trim()) { erro.value = 'Escolha o cartão, a fatura e o arquivo'; return; }
  erro.value = ''; carregando.value = true; resultado.value = null;
  try {
    const r = await api.post<Omit<Previa, 'itens'> & { itens: Omit<Item, 'marcado'>[] }>('/importacoes/previa', {
      cartao_id: f.cartao_id, vencimento: f.vencimento, conteudo, nome: colando.value ? 'colado.csv' : arquivo.value?.nome,
    });
    previa.value = { ...r, itens: r.itens.map((i) => ({ ...i, marcado: i.status === 'novo' })) };
    filtro.value = 'todos';
  } catch (e) { erro.value = (e as Error).message; previa.value = null; } finally { carregando.value = false; }
}

// ------------------------------------------------------------------- prévia
const visiveis = computed(() => (previa.value?.itens ?? []).filter((i) => filtro.value === 'todos' || i.status === filtro.value));
const marcados = computed(() => (previa.value?.itens ?? []).filter((i) => i.marcado));
const somaMarcados = computed(() => marcados.value.reduce((s, i) => s + i.valor_centavos, 0));
const semCategoria = computed(() => marcados.value.filter((i) => !i.categoria_id).length);
const podeMarcar = (i: Item) => i.status === 'novo' || i.status === 'duplicado';
const categoriaEmMassa = ref('');
function aplicarCategoria() {
  if (!categoriaEmMassa.value) return;
  for (const i of marcados.value) if (!i.categoria_id) i.categoria_id = categoriaEmMassa.value;
  categoriaEmMassa.value = '';
}
function marcarTodos(v: boolean) { for (const i of visiveis.value) if (i.status === 'novo') i.marcado = v; }

const STATUS: Record<Item['status'], [string, string]> = {
  novo: ['Novo', 'paga'], duplicado: ['Já existe', 'previsto'], ignorado: ['Ignorado', ''], erro: ['Erro', 'vencida'],
};

async function importar() {
  const p = previa.value;
  if (!p || !marcados.value.length) return;
  const dups = marcados.value.filter((i) => i.status === 'duplicado').length;
  if (dups && !confirm(`${dups} item(ns) marcado(s) parecem já existir no Vida. Importar mesmo assim (vai duplicar)?`)) return;
  gravando.value = true; erro.value = '';
  try {
    resultado.value = await api.post('/importacoes', {
      cartao_id: f.cartao_id, vencimento: f.vencimento, arquivo_nome: colando.value ? null : arquivo.value?.nome ?? null, formato: p.formato,
      itens: marcados.value.map((i) => ({ data: i.data, descricao: i.descricao.trim(), valor_centavos: i.valor_centavos, parcela: i.parcela, categoria_id: i.categoria_id })),
    });
    avisar(`${resultado.value!.criados} compras importadas`);
    previa.value = null; arquivo.value = null; texto.value = '';
    avisarMudanca();
    carregarLotes();
  } catch (e) { erro.value = (e as Error).message; } finally { gravando.value = false; }
}

async function desfazer(l: Lote) {
  if (!confirm(`Desfazer a importação de ${l.qtd} compras (${dinheiro(l.total_centavos)})? As compras criadas por ela serão apagadas.`)) return;
  try {
    const r = await api.del(`/importacoes/${l.id}`) as unknown as { removidos: number } | undefined;
    avisar(`Importação desfeita${r?.removidos ? ` (${r.removidos} compras removidas)` : ''}`);
    if (resultado.value?.importacao_id === l.id) resultado.value = null;
    avisarMudanca();
    carregarLotes();
  } catch (e) { avisar((e as Error).message, 'erro'); }
}
const faturaFinal = computed(() => (previa.value ? previa.value.fatura.total_atual_centavos + somaMarcados.value : 0));
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <div class="pagina modulo">
    <header class="cabecalho">
      <div>
        <RouterLink class="btn link" to="/financas/cartoes">Cartões</RouterLink>
        <h1>Importar fatura</h1>
        <p>Traga as compras do cartão pelo arquivo que o banco exporta. Nada é gravado antes de você conferir.</p>
      </div>
    </header>

    <!-- --------------------------------------------------------------- passo 1 -->
    <section class="painel passo">
      <div class="linha">
        <label class="campo"><span>Cartão</span>
          <select v-model="f.cartao_id">
            <option value="" disabled>Escolha…</option>
            <option v-for="c in cartoes" :key="c.id" :value="c.id">{{ c.nome }}{{ c.final ? ` ·· ${c.final}` : '' }}{{ c.pessoa_nome ? ` (${c.pessoa_nome})` : '' }}</option>
          </select>
        </label>
        <label class="campo"><span>Fatura</span>
          <select v-model="f.vencimento" :disabled="!cartao">
            <option v-for="m in meses" :key="m.v" :value="m.v">{{ m.r }}</option>
          </select>
          <small v-if="cartao">fecha dia {{ cartao.dia_fechamento }}, vence dia {{ cartao.dia_vencimento }}</small>
        </label>
      </div>

      <div v-if="!colando" :class="['soltar', { arrastando }]" @dragover.prevent="arrastando = true" @dragleave="arrastando = false" @drop.prevent="soltar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>
        <div>
          <b>{{ arquivo ? arquivo.nome : 'Arraste o arquivo da fatura aqui' }}</b>
          <span class="suave">CSV, OFX ou JSON · Nubank, Inter, C6, Itaú, BB, Bradesco, Santander…</span>
        </div>
        <label class="btn">
          {{ arquivo ? 'Trocar arquivo' : 'Escolher arquivo' }}
          <input type="file" accept=".csv,.ofx,.json,.txt,text/csv,application/json" class="sr" @change="escolher(($event.target as HTMLInputElement).files?.[0])" />
        </label>
      </div>
      <textarea v-else v-model="texto" rows="7" class="colar" placeholder="data;descricao;valor&#10;05/10/2026;Mercado;123,45&#10;07/10/2026;TV - Parcela 1/10;250,00" />

      <div class="acoes-passo">
        <button class="btn-link" @click="colando = !colando">{{ colando ? 'Enviar arquivo' : 'Colar o conteúdo em vez de enviar arquivo' }}</button>
        <button class="btn primario" :disabled="carregando || !f.cartao_id || !(colando ? texto.trim() : arquivo)" @click="verPrevia">
          {{ carregando ? 'Lendo…' : previa ? 'Ler de novo' : 'Ver prévia' }}
        </button>
      </div>
      <details class="ajuda">
        <summary>Onde baixar o arquivo no meu banco?</summary>
        <ul>
          <li><b>Nubank</b>: app → Cartão → fatura → “Exportar fatura” (CSV), ou pelo e-mail da fatura.</li>
          <li><b>Inter / C6</b>: fatura no app → compartilhar/exportar → CSV ou Excel salvo como CSV.</li>
          <li><b>Itaú, BB, Bradesco, Santander</b>: internet banking → fatura do cartão → “Exportar” → OFX (Money).</li>
          <li><b>Planilha própria</b>: CSV com colunas <code>data</code>, <code>descricao</code> e <code>valor</code> (opcional: <code>parcela</code> e <code>categoria</code>).</li>
          <li>Parcelas são reconhecidas na descrição (“Parcela 3/12”, “PARC 03/12”, “(3/12)”): a compra entra com as anteriores como já pagas, sem duplicar.</li>
        </ul>
      </details>
    </section>

    <p v-if="erro" class="erro-form" role="alert">{{ erro }}</p>

    <!-- ------------------------------------------------------------ resultado -->
    <section v-if="resultado" class="painel ok">
      <b>✅ {{ resultado.criados }} compras importadas — {{ dinheiro(resultado.total_centavos) }} na fatura de {{ mesAno(resultado.competencia) }}</b>
      <div class="acoes-passo">
        <RouterLink class="btn" :to="`/financas/cartoes/${f.cartao_id}`">Ver o cartão</RouterLink>
        <button class="btn perigo" @click="desfazer(lotes.find((l) => l.id === resultado!.importacao_id)!)" :disabled="!lotes.some((l) => l.id === resultado!.importacao_id)">Desfazer</button>
      </div>
    </section>

    <!-- --------------------------------------------------------------- prévia -->
    <template v-if="previa">
      <div class="kpis">
        <div><span>No arquivo</span><b>{{ dinheiro(previa.totais.arquivo_gastos) }}</b><small>{{ previa.itens.length }} linhas · {{ previa.formato.toUpperCase() }}</small></div>
        <div><span>A importar</span><b>{{ dinheiro(somaMarcados) }}</b><small>{{ marcados.length }} selecionadas</small></div>
        <div><span>Fatura no Vida hoje</span><b>{{ dinheiro(previa.fatura.total_atual_centavos) }}</b><small>vence {{ dataCurta(previa.fatura.dataVencimento) }}</small></div>
        <div><span>Vai ficar</span><b>{{ dinheiro(faturaFinal) }}</b>
          <small :class="{ sai: Math.abs(faturaFinal - previa.totais.arquivo_gastos) > 100 }">
            {{ Math.abs(faturaFinal - previa.totais.arquivo_gastos) <= 100 ? 'bate com o arquivo' : `diferença de ${dinheiro(Math.abs(faturaFinal - previa.totais.arquivo_gastos))} para o arquivo` }}
          </small>
        </div>
      </div>
      <div v-if="previa.fatura_sugerida" class="sugestao painel">
        <span>Este arquivo parece ser da <b>fatura de {{ mesAno(`${previa.fatura_sugerida}-01`) }}</b>: a maioria das compras cai nela pelo dia de fechamento do cartão.</span>
        <button class="btn primario" @click="usarSugerida">Usar fatura de {{ mesAno(`${previa.fatura_sugerida}-01`) }}</button>
      </div>
      <ul v-if="previa.avisos.length || previa.sinal_invertido || previa.totais.arquivo_creditos" class="avisos">
        <li v-for="a in previa.avisos" :key="a">{{ a }}</li>
        <li v-if="previa.sinal_invertido">O arquivo traz compras como valores negativos: inverti o sinal para ler.</li>
        <li v-if="previa.totais.arquivo_creditos">Pagamentos/estornos no arquivo ({{ dinheiro(previa.totais.arquivo_creditos) }}) não entram como compra. Registre o pagamento da fatura na tela da fatura.</li>
      </ul>

      <div class="barra-filtros">
        <div class="filtros">
          <button :aria-pressed="filtro === 'todos'" @click="filtro = 'todos'">Todos <small>{{ previa.itens.length }}</small></button>
          <button v-for="(n, s) in previa.contagem" v-show="n" :key="s" :aria-pressed="filtro === s" @click="filtro = s">{{ STATUS[s][0] }} <small>{{ n }}</small></button>
        </div>
        <div class="massa">
          <button class="btn-link" @click="marcarTodos(true)">Marcar novos</button>
          <button class="btn-link" @click="marcarTodos(false)">Desmarcar</button>
        </div>
      </div>

      <ul class="itens">
        <li v-for="i in visiveis" :key="i.linha" :class="['item', 'painel', i.status, { marcado: i.marcado }]">
          <label class="check">
            <input v-model="i.marcado" type="checkbox" :disabled="!podeMarcar(i)" :aria-label="`Importar ${i.descricao}`" />
          </label>
          <div class="principal">
            <input v-if="podeMarcar(i)" v-model="i.descricao" class="descricao" maxlength="200" :aria-label="`Descrição da linha ${i.linha}`" />
            <b v-else class="descricao fixa">{{ i.descricao || '(sem descrição)' }}</b>
            <div class="meta">
              <span v-if="i.data">{{ dataCurta(i.data) }}</span>
              <span v-if="i.parcela" class="chip">parcela {{ i.parcela.atual }}/{{ i.parcela.total }}</span>
              <span :class="['selo', STATUS[i.status][1]]">{{ STATUS[i.status][0] }}</span>
              <span class="suave">linha {{ i.linha }}</span>
            </div>
            <p v-if="i.motivo" :class="['motivo', { alerta: i.plano?.fora_da_fatura }]">{{ i.motivo }}</p>
            <p v-if="i.parcela && i.plano && i.status === 'novo'" class="motivo suave">
              Compra de {{ dinheiro(i.plano.valor_total) }} em {{ i.plano.parcelas_total }}x; {{ i.plano.parcelas_pagas_antes ? `${i.plano.parcelas_pagas_antes} anterior(es) como já pagas, ` : '' }}próximas entram nas faturas seguintes.
            </p>
          </div>
          <div class="valor">{{ dinheiro(Math.abs(i.valor_centavos)) }}<small v-if="i.valor_centavos < 0">crédito</small></div>
          <select v-if="podeMarcar(i)" v-model="i.categoria_id" class="categoria" :aria-label="`Categoria de ${i.descricao}`">
            <option :value="null">Sem categoria</option>
            <option v-for="c in despesas" :key="c.id" :value="c.id">{{ c.nome }}</option>
          </select>
        </li>
      </ul>

      <div class="rodape-import painel">
        <div v-if="semCategoria" class="massa-cat">
          <span class="suave">{{ semCategoria }} sem categoria →</span>
          <select v-model="categoriaEmMassa" aria-label="Categoria para os itens sem categoria">
            <option value="">escolher…</option>
            <option v-for="c in despesas" :key="c.id" :value="c.id">{{ c.nome }}</option>
          </select>
          <button class="btn" :disabled="!categoriaEmMassa" @click="aplicarCategoria">Aplicar</button>
        </div>
        <button class="btn primario grande" :disabled="gravando || !marcados.length" @click="importar">
          {{ gravando ? 'Importando…' : `Importar ${marcados.length} compra${marcados.length === 1 ? '' : 's'} · ${dinheiro(somaMarcados)}` }}
        </button>
      </div>
    </template>

    <!-- ------------------------------------------------------------- histórico -->
    <section v-if="lotes.length" class="secao">
      <header><h2>Importações anteriores</h2></header>
      <ul class="lista painel">
        <li v-for="l in lotes" :key="l.id">
          <span class="ico" style="--c: var(--marca)">⇪</span>
          <div>
            <div class="titulo">{{ l.cartao_nome }} · fatura de {{ mesAno(l.competencia) }}</div>
            <div class="meta">{{ [l.arquivo_nome, `${l.qtd} compras`, quando(l.created_at), l.criado_por_nome].filter(Boolean).join(' · ') }}</div>
          </div>
          <div class="valor">
            <div>{{ dinheiro(l.total_centavos) }}</div>
            <button v-if="l.ainda_existentes" class="btn-link perigo-link" @click="desfazer(l)">Desfazer</button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.passo { padding: 18px 20px; display: grid; gap: 14px; }
.passo .linha { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 12px; align-items: start; }
.soltar {
  display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: center; padding: 18px;
  border: 2px dashed var(--line-2); border-radius: var(--raio-m); background: var(--surface-2); transition: border-color 0.15s, background 0.15s;
}
.soltar.arrastando { border-color: var(--marca); background: var(--marca-tint); }
.soltar svg { width: 30px; height: 30px; fill: none; stroke: var(--ink-3); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.soltar > div { display: grid; gap: 2px; min-width: 0; }
.soltar b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.soltar .suave { font-size: 0.85rem; }
.soltar .btn { cursor: pointer; }
.colar { font-family: ui-monospace, monospace; font-size: 0.85rem; }
.acoes-passo { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.btn-link { border: 0; background: none; color: var(--marca-tint-ink); font: 600 0.875rem var(--fonte); cursor: pointer; padding: 8px 0; min-height: 40px; }
.perigo-link { color: var(--sai); }
.ajuda summary { cursor: pointer; color: var(--ink-2); font-size: 0.9rem; font-weight: 600; min-height: 32px; }
.ajuda ul { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 6px; color: var(--ink-2); font-size: 0.875rem; }
code { background: var(--surface-2); padding: 1px 6px; border-radius: 6px; font-size: 0.85em; }
.ok { padding: 16px 18px; display: grid; gap: 10px; border-left: 4px solid var(--entra); }
.avisos { margin: 0; padding: 12px 16px 12px 32px; border-radius: var(--raio-s); background: var(--previsto-tint); color: var(--previsto); display: grid; gap: 4px; font-size: 0.9rem; }
.barra-filtros { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.filtros { display: flex; gap: 6px; flex-wrap: wrap; }
.filtros button { font: 600 0.82rem var(--fonte); padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2); cursor: pointer; min-height: 36px; }
.filtros button small { color: var(--ink-3); margin-left: 2px; }
.filtros button[aria-pressed='true'] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.filtros button[aria-pressed='true'] small { color: inherit; opacity: 0.7; }
.massa { display: flex; gap: 14px; }

.itens { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.item {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto 200px; grid-template-areas: 'check principal valor categoria';
  gap: 6px 14px; align-items: center; padding: 10px 14px;
}
.item.ignorado, .item.erro { opacity: 0.6; }
.item.marcado { border-color: color-mix(in srgb, var(--marca) 45%, var(--line)); }
.check { grid-area: check; display: grid; place-items: center; width: 40px; height: 40px; cursor: pointer; }
.check input { width: 20px; height: 20px; min-height: 0; accent-color: var(--marca); cursor: pointer; }
.principal { grid-area: principal; min-width: 0; display: grid; gap: 3px; }
.descricao { font-weight: 600; min-height: 38px; padding: 6px 10px; width: 100%; min-width: 0; }
.descricao.fixa { padding: 0; min-height: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: 0.8rem; color: var(--ink-3); }
.chip { background: var(--surface-2); color: var(--ink-2); padding: 1px 8px; border-radius: 999px; font-weight: 600; }
.motivo { margin: 0; font-size: 0.8rem; color: var(--ink-2); }
.motivo.alerta { color: var(--previsto); }
.valor { grid-area: valor; text-align: right; font-weight: 700; white-space: nowrap; display: grid; }
.valor small { font-weight: 500; font-size: 0.75rem; color: var(--ink-3); }
.categoria { grid-area: categoria; min-height: 40px; }

.rodape-import {
  position: sticky; bottom: 12px; z-index: 5; padding: 12px 14px; display: flex; gap: 12px; align-items: center; justify-content: flex-end; flex-wrap: wrap;
  box-shadow: var(--sombra-flutuante);
}
.massa-cat { display: flex; gap: 8px; align-items: center; margin-right: auto; min-width: 0; }
.massa-cat > span { white-space: nowrap; }
.massa-cat select { width: auto; min-height: 40px; min-width: 0; }
.sugestao { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 14px 16px; border-left: 4px solid var(--previsto); }
.grande { min-height: 48px; padding-inline: 20px; }
.secao > header h2 { font-size: 1rem; margin: 0; }

@media (max-width: 760px) {
  .soltar { grid-template-columns: 1fr; text-align: center; justify-items: center; }
  .item { grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'check principal valor' 'categoria categoria categoria'; padding: 10px 12px; }
  .rodape-import { bottom: calc(84px + env(safe-area-inset-bottom)); } /* acima da barra de navegação do celular */
  .rodape-import { padding: 10px; gap: 8px; }
  .rodape-import .grande { width: 100%; }
  .massa-cat { flex: 1 1 100%; }
  .massa-cat select { flex: 1; }
  .massa-cat > span { font-size: 0.82rem; }
}
</style>

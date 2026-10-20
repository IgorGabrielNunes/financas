<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../core/api';
import { avisar, versao } from '../../core/store';
import { dataCurta, diasAte, dinheiro } from '../../core/format';
import EntidadeModal from '../../ui/EntidadeModal.vue';
import { COBRANCA, COLUNA, COR_CARD, STATUS_PROJETO, TIPO_CARD, TIPO_PROJETO, camposCard, camposMarco, camposProjeto } from './comum';

type Card = { id: string; titulo: string; status: string; tipo: string; prioridade: number; estimativa_pontos: number | null; prazo: string | null; marco_id: string | null; marco_nome: string | null; branch: string | null; pr_url: string | null; descricao: string | null; ordem: number };

const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id as string);
const q = ref<{ projeto: any; colunas: string[]; marcos: any[]; cards: Card[]; pontos: { total: number; feitos: number } } | null>(null);
const erro = ref('');
const filtroTipo = ref<string | null>(null);
const filtroMarco = ref<string | null>(null);

async function carregar() {
  try { q.value = await api.get(`/projetos/${id.value}/quadro`); } catch (e) { erro.value = (e as Error).message; }
}
onMounted(carregar);
watch([versao, id], carregar);

const p = computed(() => q.value?.projeto);
const tecnico = computed(() => p.value && p.value.tipo !== 'pessoal');
const cardsDa = (col: string) => (q.value?.cards ?? []).filter((c) => c.status === col
  && (!filtroTipo.value || c.tipo === filtroTipo.value) && (!filtroMarco.value || c.marco_id === filtroMarco.value));
const pontosDa = (col: string) => cardsDa(col).reduce((s, c) => s + (c.estimativa_pontos ?? 0), 0);

// ------------------------------------------------------------ arrastar/soltar
const arrastando = ref<string | null>(null);
const sobre = ref<{ col: string; antes: string | null } | null>(null);
function inicio(e: DragEvent, c: Card) {
  arrastando.value = c.id;
  e.dataTransfer?.setData('text/plain', c.id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function passando(e: DragEvent, col: string, antes: string | null) {
  if (!arrastando.value) return;
  e.preventDefault();
  sobre.value = { col, antes };
}
async function soltar(col: string) {
  const cardId = arrastando.value;
  const antes = sobre.value?.col === col ? sobre.value.antes : null;
  arrastando.value = null; sobre.value = null;
  if (!cardId || antes === cardId) return;
  await mover(cardId, col, antes);
}
async function mover(cardId: string, status: string, antes_de: string | null) {
  // otimista: move na tela já; o servidor devolve a ordem definitiva
  const c = q.value!.cards.find((x) => x.id === cardId)!;
  const anterior = { status: c.status, ordem: c.ordem };
  c.status = status;
  const alvo = antes_de ? q.value!.cards.find((x) => x.id === antes_de) : null;
  c.ordem = alvo ? alvo.ordem - 0.0001 : Number.MAX_SAFE_INTEGER;
  q.value!.cards.sort((a, b) => a.ordem - b.ordem);
  try {
    const r = await api.patch<Card>(`/projetos-cards/${cardId}/mover`, { status, antes_de });
    c.ordem = Number(r.ordem);
    q.value!.cards.sort((a, b) => a.ordem - b.ordem);
  } catch (e) {
    Object.assign(c, anterior);
    avisar((e as Error).message, 'erro');
  }
}

// --------------------------------------------------------------------- modais
const modalCard = ref<{ item: Card | null; status?: string } | null>(null);
const modalMarco = ref<{ item: any } | null>(null);
const editarProjeto = ref(false);
const camposC = computed(() => camposCard(p.value?.tipo ?? 'pessoal', q.value?.colunas ?? [], q.value?.marcos ?? []));
const progresso = computed(() => {
  const cs = q.value?.cards ?? [];
  return cs.length ? Math.round((cs.filter((c) => c.status === 'feito').length / cs.length) * 100) : 0;
});
const links = computed(() => [['Repositório', p.value?.repo_url], ['Produção', p.value?.producao_url], ['Homologação', p.value?.homologacao_url]].filter(([, u]) => u) as [string, string][]);
const tiposUsados = computed(() => [...new Set((q.value?.cards ?? []).map((c) => c.tipo))]);
</script>

<template>
  <div v-if="p" class="pagina larga modulo" :style="{ '--c': p.cor }">
    <header class="cabecalho">
      <div>
        <RouterLink to="/projetos" class="voltar">← Projetos</RouterLink>
        <h1>{{ p.nome }}</h1>
        <p>
          {{ TIPO_PROJETO[p.tipo as keyof typeof TIPO_PROJETO] }} · {{ STATUS_PROJETO[p.status as keyof typeof STATUS_PROJETO] }}
          <template v-if="p.versao_atual"> · v{{ p.versao_atual }}</template>
          <template v-if="p.prazo"> · prazo {{ dataCurta(p.prazo) }}</template>
        </p>
      </div>
      <div class="botoes">
        <button class="btn" @click="editarProjeto = true">Editar</button>
        <button class="btn primario" @click="modalCard = { item: null, status: q!.colunas.includes('a_fazer') ? 'a_fazer' : q!.colunas[0] }">Novo card</button>
      </div>
    </header>

    <div class="resumo">
      <div class="painel info">
        <div class="medidor"><i :style="{ width: progresso + '%', background: 'var(--c)' }" /></div>
        <div class="nums">
          <span><b>{{ progresso }}%</b> concluído</span>
          <span>{{ q!.cards.length }} cards</span>
          <span v-if="tecnico && q!.pontos.total">{{ q!.pontos.feitos }}/{{ q!.pontos.total }} pontos</span>
        </div>
        <p v-if="p.descricao" class="desc">{{ p.descricao }}</p>
        <div v-if="links.length || p.stack?.length" class="extras">
          <a v-for="[r, u] in links" :key="r" :href="u" target="_blank" rel="noopener noreferrer" class="link">{{ r }} ↗</a>
          <span v-for="s in p.stack" :key="s" class="tag">{{ s }}</span>
        </div>
        <div v-if="p.tipo === 'produto' && (p.proposta_valor || p.modelo_cobranca)" class="produto">
          <div v-if="p.proposta_valor"><span class="suave miudo">Proposta de valor</span><p>{{ p.proposta_valor }}</p></div>
          <div v-if="p.publico_alvo"><span class="suave miudo">Público</span><p>{{ p.publico_alvo }}</p></div>
          <div v-if="p.modelo_cobranca"><span class="suave miudo">Cobrança</span>
            <p>{{ COBRANCA[p.modelo_cobranca as keyof typeof COBRANCA] }}<template v-if="p.preco_centavos"> · {{ dinheiro(p.preco_centavos) }}</template></p></div>
        </div>
      </div>

      <div class="painel marcos">
        <header><b>Marcos</b><button class="btn-link" @click="modalMarco = { item: null }">+ marco</button></header>
        <ul v-if="q!.marcos.length">
          <li v-for="m in q!.marcos" :key="m.id" :class="{ feito: m.concluido_em, ativo: filtroMarco === m.id }" @click="filtroMarco = filtroMarco === m.id ? null : m.id" @dblclick="modalMarco = { item: m }">
            <span class="losango">◆</span>
            <div>
              <div class="nome">{{ m.nome }}</div>
              <div class="meta">
                {{ m.cards_feitos }}/{{ m.cards_total }}
                <template v-if="m.concluido_em"> · concluído {{ dataCurta(m.concluido_em) }}</template>
                <template v-else-if="m.data_alvo"> · {{ dataCurta(m.data_alvo) }} <span v-if="diasAte(m.data_alvo) < 0" class="sai">atrasado</span></template>
              </div>
            </div>
            <button class="editar" aria-label="Editar marco" @click.stop="modalMarco = { item: m }">✎</button>
          </li>
        </ul>
        <p v-else class="suave miudo">Marcos são entregas: MVP, v1.0, lançamento. Clique para filtrar o quadro.</p>
      </div>
    </div>

    <div v-if="tiposUsados.length > 1" class="filtros">
      <button :aria-pressed="!filtroTipo" @click="filtroTipo = null">Todos</button>
      <button v-for="t in tiposUsados" :key="t" :style="{ '--t': COR_CARD[t] }" :aria-pressed="filtroTipo === t" @click="filtroTipo = filtroTipo === t ? null : t">
        <i />{{ TIPO_CARD[t as keyof typeof TIPO_CARD] }}
      </button>
    </div>

    <div class="quadro" :style="{ '--n': q!.colunas.length }">
      <section v-for="col in q!.colunas" :key="col" :class="['coluna', { alvo: sobre?.col === col }]"
        @dragover="passando($event, col, null)" @drop.prevent="soltar(col)">
        <header>
          <b>{{ COLUNA[col as keyof typeof COLUNA] }}</b>
          <span>{{ cardsDa(col).length }}<template v-if="tecnico && pontosDa(col)"> · {{ pontosDa(col) }} pts</template></span>
        </header>
        <article v-for="c in cardsDa(col)" :key="c.id" :class="['card', { arrastando: arrastando === c.id, antes: sobre?.antes === c.id }]"
          :style="{ '--t': COR_CARD[c.tipo] }" draggable="true" tabindex="0"
          @dragstart="inicio($event, c)" @dragend="arrastando = null; sobre = null"
          @dragover.stop="passando($event, col, c.id)" @click="modalCard = { item: c }" @keydown.enter="modalCard = { item: c }">
          <div class="topo">
            <span class="tipo">{{ TIPO_CARD[c.tipo as keyof typeof TIPO_CARD] }}</span>
            <span v-if="c.prioridade === 1" class="alta">alta</span>
            <span v-if="c.estimativa_pontos" class="pts">{{ c.estimativa_pontos }}</span>
          </div>
          <div class="titulo">{{ c.titulo }}</div>
          <div v-if="c.marco_nome || c.prazo || c.branch || c.pr_url" class="meta">
            <span v-if="c.marco_nome">◆ {{ c.marco_nome }}</span>
            <span v-if="c.prazo" :class="{ sai: c.status !== 'feito' && diasAte(c.prazo) < 0 }">{{ dataCurta(c.prazo) }}</span>
            <code v-if="c.branch">{{ c.branch }}</code>
            <a v-if="c.pr_url" :href="c.pr_url" target="_blank" rel="noopener noreferrer" @click.stop>PR ↗</a>
          </div>
          <!-- toque: arrastar não existe no celular; setas movem para a coluna vizinha -->
          <div class="mover-toque" @click.stop>
            <button :disabled="q!.colunas.indexOf(col) === 0" :aria-label="`Mover ${c.titulo} para a coluna anterior`"
              @click="mover(c.id, q!.colunas[q!.colunas.indexOf(col) - 1], null)">←</button>
            <button :disabled="q!.colunas.indexOf(col) === q!.colunas.length - 1" :aria-label="`Mover ${c.titulo} para a próxima coluna`"
              @click="mover(c.id, q!.colunas[q!.colunas.indexOf(col) + 1], null)">→</button>
          </div>
        </article>
        <button class="add" @click="modalCard = { item: null, status: col }">+ card</button>
      </section>
    </div>
    <p class="suave miudo dica">Arraste os cards entre colunas (no celular, use as setas do card).</p>

    <EntidadeModal v-if="modalCard" :titulo="modalCard.item ? 'Card' : 'Novo card'" rota="/projetos-cards" :campos="camposC" :item="modalCard.item"
      :padrao="{ status: modalCard.status, tipo: tecnico ? 'funcionalidade' : 'tarefa', prioridade: 2, marco_id: filtroMarco }"
      :fixos="{ projeto_id: p.id }" confirmar-exclusao="Excluir este card?" @fechar="modalCard = null" />
    <EntidadeModal v-if="modalMarco" :titulo="modalMarco.item ? 'Editar marco' : 'Novo marco'" rota="/projetos-marcos" :campos="camposMarco" :item="modalMarco.item"
      :fixos="{ projeto_id: p.id }" confirmar-exclusao="Excluir o marco? Os cards continuam, só perdem o vínculo." @fechar="modalMarco = null" />
    <EntidadeModal v-if="editarProjeto" titulo="Editar projeto" rota="/projetos" :campos="camposProjeto" :item="p"
      confirmar-exclusao="Excluir o projeto com todos os cards e marcos? Para guardar o histórico, prefira a situação Arquivado."
      @excluido="router.push('/projetos')" @fechar="editarProjeto = false" />
  </div>
  <div v-else class="pagina"><p v-if="erro" class="erro-form">{{ erro }}</p></div>
</template>

<style scoped>
.voltar { color: var(--ink-3); text-decoration: none; font-size: 0.85rem; font-weight: 600; }
.botoes { display: flex; gap: 8px; }
.resumo { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 14px; }
@media (max-width: 900px) { .resumo { grid-template-columns: 1fr; } }
.info { padding: 16px 18px; display: grid; gap: 10px; align-content: start; }
.nums { display: flex; gap: 14px; flex-wrap: wrap; font-size: 0.85rem; color: var(--ink-2); }
.desc { margin: 0; color: var(--ink-2); white-space: pre-wrap; font-size: 0.9rem; }
.extras { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.link { font-size: 0.82rem; font-weight: 650; color: var(--marca-tint-ink); text-decoration: none; padding: 3px 10px; border-radius: 6px; background: var(--marca-tint); }
.tag { font-size: 0.75rem; padding: 2px 8px; border-radius: 6px; background: var(--surface-2); color: var(--ink-2); font-weight: 600; }
.produto { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; border-top: 1px solid var(--line); padding-top: 10px; }
.produto p { margin: 2px 0 0; font-size: 0.875rem; white-space: pre-wrap; }
.marcos { padding: 14px 16px; }
.marcos header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.marcos ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.marcos li { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 6px 8px; border-radius: var(--raio-s); cursor: pointer; }
.marcos li:hover { background: var(--surface-2); }
.marcos li.ativo { background: var(--marca-tint); }
.marcos li.feito .nome { text-decoration: line-through; color: var(--ink-3); }
.losango { color: var(--c); }
.nome { font-weight: 600; font-size: 0.9rem; }
.marcos .meta { font-size: 0.78rem; color: var(--ink-3); }
.editar { border: 0; background: none; cursor: pointer; color: var(--ink-3); padding: 4px 6px; }
.btn-link { border: 0; background: none; color: var(--marca-tint-ink); font: 600 0.85rem var(--fonte); cursor: pointer; }

.filtros { display: flex; gap: 6px; flex-wrap: wrap; }
.filtros button { display: inline-flex; gap: 6px; align-items: center; font: 600 0.8rem var(--fonte); padding: 5px 11px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2); cursor: pointer; }
.filtros i { width: 8px; height: 8px; border-radius: 50%; background: var(--t); }
.filtros button[aria-pressed='true'] { background: var(--ink); color: var(--bg); border-color: var(--ink); }

.quadro {
  display: grid; grid-template-columns: repeat(var(--n), minmax(210px, 1fr)); gap: 12px;
  overflow-x: auto; padding-bottom: 8px; scroll-snap-type: x mandatory;
}
.coluna { background: var(--surface-2); border-radius: var(--raio-m); padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 160px; scroll-snap-align: start; border: 2px dashed transparent; }
.coluna.alvo { border-color: var(--c); }
.coluna > header { display: flex; justify-content: space-between; align-items: baseline; padding: 2px 4px 4px; }
.coluna > header span { font-size: 0.8rem; color: var(--ink-3); }
.card {
  background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--t); border-radius: var(--raio-s);
  padding: 10px 12px; cursor: grab; display: grid; gap: 5px; position: relative;
}
.card:hover { box-shadow: var(--sombra-flutuante); }
.card.arrastando { opacity: 0.4; }
.card.antes::before { content: ''; position: absolute; left: 0; right: 0; top: -6px; height: 3px; border-radius: 2px; background: var(--c); }
.topo { display: flex; gap: 6px; align-items: center; font-size: 0.72rem; font-weight: 650; }
.topo .tipo { color: var(--t); text-transform: uppercase; letter-spacing: 0.04em; }
.alta { color: var(--sai); }
.pts { margin-left: auto; min-width: 22px; text-align: center; padding: 1px 6px; border-radius: 10px; background: var(--surface-2); color: var(--ink-2); }
.card .titulo { font-weight: 550; font-size: 0.9rem; line-height: 1.35; overflow-wrap: anywhere; }
.card .meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 0.75rem; color: var(--ink-3); }
.card code { font-size: 0.72rem; background: var(--surface-2); padding: 0 5px; border-radius: 4px; }
.card a { color: var(--marca-tint-ink); font-weight: 650; text-decoration: none; }
.add { border: 0; background: none; color: var(--ink-3); font: 600 0.85rem var(--fonte); text-align: left; padding: 6px 4px; cursor: pointer; border-radius: var(--raio-s); }
.add:hover { background: var(--surface); color: var(--ink); }
.dica { margin-top: -10px; }
@media (max-width: 760px) { .quadro { grid-template-columns: repeat(var(--n), 82vw); } }
.mover-toque { display: none; }
@media (pointer: coarse) {
  .card { cursor: pointer; }
  .mover-toque { display: flex; justify-content: space-between; gap: 8px; margin-top: 4px; }
  .mover-toque button { flex: 1; min-height: 40px; border: 1px solid var(--line-2); background: var(--surface-2); border-radius: var(--raio-s); font: 700 1rem var(--fonte); color: var(--ink-2); cursor: pointer; }
  .mover-toque button:disabled { opacity: 0.35; }
  .filtros button { min-height: 40px; padding: 8px 14px; }
  .btn-link { min-height: 40px; padding: 8px 10px; }
  .editar { min-width: 40px; min-height: 40px; }
  .add { min-height: 44px; }
  .marcos li { min-height: 48px; }
}
</style>

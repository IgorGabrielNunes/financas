<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../core/api';
import { avisar, avisarMudanca, versao } from '../../core/store';
import { dataCurta, hoje } from '../../core/format';
import Abas from '../../ui/Abas.vue';
import EntidadeModal from '../../ui/EntidadeModal.vue';
import type { Campo } from '../../ui/campos';
import TarefaItem from './TarefaItem.vue';
import TarefaForm from './TarefaForm.vue';
import { carregarApoio, tarefasEstado, type Area, type Tarefa } from './tipos';

const route = useRoute();
const router = useRouter();
const aba = computed(() => (route.query.aba as string) || 'hoje');
const areaFiltro = ref<string | null>(null);

const somar = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const DIA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const nomeDia = (d: string) => {
  if (d === somar(hoje(), 1)) return 'Amanhã';
  const s = DIA_SEMANA[new Date(d + 'T12:00:00Z').getUTCDay()];
  return `${s[0].toUpperCase()}${s.slice(1)}, ${dataCurta(d)}`;
};

const itens = ref<Tarefa[]>([]);
const todas = ref<Tarefa[]>([]);
const historico = ref<{ total: number; por_area: { area: string; cor: string; qtd: number }[]; itens: any[] } | null>(null);
const verArquivadas = ref(false);
const carregando = ref(true);
const erro = ref('');

async function carregar() {
  erro.value = '';
  const h = hoje();
  const area = areaFiltro.value ? `&area_id=${areaFiltro.value}` : '';
  try {
    if (aba.value === 'hoje') itens.value = await api.get(`/tarefas/agenda?de=${h}&ate=${h}${area}`);
    else if (aba.value === 'semana') itens.value = await api.get(`/tarefas/agenda?de=${somar(h, 1)}&ate=${somar(h, 7)}&atrasadas=0${area}`);
    else if (aba.value === 'algum-dia') itens.value = (await api.get<Tarefa[]>(`/tarefas/agenda?de=${h}&ate=${h}&atrasadas=0&sem_data=1${area}`)).filter((t) => !t.ocorrencia);
    else if (aba.value === 'todas') todas.value = await api.get(`/tarefas${verArquivadas.value ? '?arquivadas=1' : ''}`);
    else if (aba.value === 'feitas') historico.value = await api.get('/tarefas/historico');
  } catch (e) { erro.value = (e as Error).message; } finally { carregando.value = false; }
}

onMounted(async () => {
  await carregarApoio().catch((e) => (erro.value = e.message));
  carregar();
  if (route.query.novo) { form.value = { tarefa: null }; router.replace({ query: { ...route.query, novo: undefined } }); }
});
watch([aba, areaFiltro, verArquivadas, versao], carregar);
watch(() => route.query.novo, (v) => { if (v) { form.value = { tarefa: null }; router.replace({ query: { ...route.query, novo: undefined } }); } });

// -------------------------------------------------------------- agrupamentos
const pendentes = computed(() => itens.value.filter((t) => !t.feita));
const feitasHoje = computed(() => itens.value.filter((t) => t.feita));
const atrasadas = computed(() => pendentes.value.filter((t) => t.atrasada));
const deHoje = computed(() => pendentes.value.filter((t) => !t.atrasada));
const porDia = computed(() => {
  const g = new Map<string, Tarefa[]>();
  for (const t of itens.value) {
    const k = t.ocorrencia!;
    g.set(k, [...(g.get(k) ?? []), t]);
  }
  return [...g.entries()];
});
const todasFiltradas = computed(() => todas.value.filter((t) => !areaFiltro.value || t.area_id === areaFiltro.value));
const progresso = computed(() => {
  const total = itens.value.length;
  return total ? Math.round((feitasHoje.value.length / total) * 100) : 0;
});

// ---------------------------------------------------------------- adicionar
const rapido = ref('');
async function adicionarRapido() {
  const titulo = rapido.value.trim();
  if (!titulo) return;
  const data = aba.value === 'algum-dia' ? null : aba.value === 'semana' ? somar(hoje(), 1) : hoje();
  try {
    await api.post('/tarefas', { titulo, data, area_id: areaFiltro.value });
    rapido.value = '';
    avisarMudanca();
  } catch (e) { avisar((e as Error).message, 'erro'); }
}

const form = ref<{ tarefa: Tarefa | null } | null>(null);
async function abrir(t: Tarefa) {
  // a agenda devolve a regra completa da tarefa; basta abrir
  form.value = { tarefa: t };
}
async function desarquivar(t: Tarefa) {
  try {
    await api.put(`/tarefas/${t.id}`, { ...t, arquivada: false });
    avisarMudanca();
  } catch (e) { avisar((e as Error).message, 'erro'); }
}

// -------------------------------------------------------------------- áreas
const areaModal = ref<{ item: Area | null } | null>(null);
const camposArea: Campo[] = [
  { k: 'nome', r: 'Nome', obrig: true, meia: true },
  { k: 'cor', r: 'Cor', t: 'cor', meia: true },
];
async function aposArea() { areaModal.value = null; await carregarApoio(); carregar(); }

const abas = computed(() => [
  { id: 'hoje', r: 'Hoje', n: aba.value === 'hoje' ? pendentes.value.length : undefined },
  { id: 'semana', r: 'Próximos 7 dias' },
  { id: 'algum-dia', r: 'Algum dia' },
  { id: 'todas', r: 'Todas' },
  { id: 'feitas', r: 'Feitas' },
]);
const placeholder = computed(() => aba.value === 'algum-dia' ? 'Ideia ou tarefa sem data…' : aba.value === 'semana' ? 'Nova tarefa para amanhã…' : 'Nova tarefa para hoje…');
const maxHist = computed(() => Math.max(1, ...(historico.value?.por_area.map((a) => a.qtd) ?? [1])));
</script>

<template>
  <div class="pagina estreita modulo">
    <header class="cabecalho">
      <div>
        <h1>Tarefas</h1>
        <p v-if="aba === 'hoje' && itens.length">{{ feitasHoje.length }} de {{ itens.length }} feitas hoje</p>
        <p v-else>Rotina, casa, estudos e o que mais precisar lembrar.</p>
      </div>
      <button class="btn primario" @click="form = { tarefa: null }">Nova tarefa</button>
    </header>

    <div v-if="aba === 'hoje' && itens.length" class="medidor" role="progressbar" :aria-valuenow="progresso" aria-valuemin="0" aria-valuemax="100">
      <i :style="{ width: progresso + '%', background: 'var(--entra)' }" />
    </div>

    <Abas :abas="abas" />

    <div v-if="aba !== 'feitas'" class="areas">
      <button :aria-pressed="!areaFiltro" @click="areaFiltro = null">Todas as áreas</button>
      <button v-for="a in tarefasEstado.areas" :key="a.id" :style="{ '--c': a.cor }" :aria-pressed="areaFiltro === a.id"
        @click="areaFiltro = areaFiltro === a.id ? null : a.id" @dblclick="areaModal = { item: a }">
        <i aria-hidden="true" />{{ a.nome }}
      </button>
      <button class="gerir" title="Nova área" aria-label="Nova área" @click="areaModal = { item: null }">+</button>
    </div>

    <form v-if="['hoje', 'semana', 'algum-dia'].includes(aba)" class="rapido painel" @submit.prevent="adicionarRapido">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      <input v-model="rapido" :placeholder="placeholder" maxlength="200" aria-label="Título da nova tarefa" />
      <button v-if="rapido.trim()" class="btn primario" type="submit">Adicionar</button>
    </form>

    <p v-if="erro" class="erro-form" role="alert">{{ erro }}</p>

    <!-- ----------------------------------------------------------- hoje -->
    <template v-if="aba === 'hoje'">
      <section v-if="atrasadas.length" class="secao">
        <h2 class="sai">Atrasadas</h2>
        <ul class="painel lista-tarefas"><TarefaItem v-for="t in atrasadas" :key="t.id" :t="t" @abrir="abrir" /></ul>
      </section>
      <section class="secao">
        <h2 v-if="atrasadas.length">Hoje</h2>
        <ul v-if="deHoje.length" class="painel lista-tarefas"><TarefaItem v-for="t in deHoje" :key="t.id + (t.ocorrencia ?? '')" :t="t" @abrir="abrir" /></ul>
        <div v-else-if="!carregando" class="vazio painel">
          <b>{{ feitasHoje.length ? 'Tudo feito por hoje 🎉' : 'Nada para hoje' }}</b>
          <span>{{ feitasHoje.length ? 'Aproveite o resto do dia.' : 'Adicione acima ou planeje a semana.' }}</span>
        </div>
      </section>
      <section v-if="feitasHoje.length" class="secao">
        <h2>Feitas hoje</h2>
        <ul class="painel lista-tarefas"><TarefaItem v-for="t in feitasHoje" :key="t.id + 'f'" :t="t" @abrir="abrir" /></ul>
      </section>
    </template>

    <!-- --------------------------------------------------------- semana -->
    <template v-else-if="aba === 'semana'">
      <section v-for="[dia, ts] in porDia" :key="dia" class="secao">
        <h2>{{ nomeDia(dia) }}</h2>
        <ul class="painel lista-tarefas"><TarefaItem v-for="t in ts" :key="t.id + dia" :t="t" @abrir="abrir" /></ul>
      </section>
      <div v-if="!porDia.length && !carregando" class="vazio painel"><b>Semana livre</b><span>Nenhuma tarefa nos próximos 7 dias.</span></div>
    </template>

    <!-- ------------------------------------------------------ algum dia -->
    <template v-else-if="aba === 'algum-dia'">
      <ul v-if="itens.length" class="painel lista-tarefas secao"><TarefaItem v-for="t in itens" :key="t.id" :t="t" @abrir="abrir" /></ul>
      <div v-else-if="!carregando" class="vazio painel"><b>Sem pendências sem data</b><span>Use para ideias e coisas sem prazo.</span></div>
    </template>

    <!-- ---------------------------------------------------------- todas -->
    <template v-else-if="aba === 'todas'">
      <label class="arquivadas"><input v-model="verArquivadas" type="checkbox" /> Ver arquivadas</label>
      <ul v-if="todasFiltradas.length" class="lista painel secao">
        <li v-for="t in todasFiltradas" :key="t.id" class="clicavel" @click="abrir(t)">
          <span class="ico" :style="{ '--c': t.area_cor ?? 'var(--ink-3)' }">{{ (t.area_nome ?? t.titulo).slice(0, 1) }}</span>
          <div>
            <div class="titulo">{{ t.titulo }}</div>
            <div class="meta">
              {{ [t.area_nome, t.descricao_repeticao || (t.data ? dataCurta(t.data) : 'sem data'), t.compartilhada ? 'da casa' : null, t.user_id !== null && t.criador_nome ? `por ${t.criador_nome.split(' ')[0]}` : null].filter(Boolean).join(' · ') }}
            </div>
          </div>
          <div class="valor">
            <button v-if="t.arquivada" class="btn" @click.stop="desarquivar(t)">Reativar</button>
            <template v-else-if="t.repeticao !== 'nenhuma'">
              <div v-if="t.sequencia" class="seq" title="Sequência de dias seguidos cumpridos">🔥 {{ t.sequencia }}</div>
              <div class="meta">{{ t.proxima ? `próxima ${dataCurta(t.proxima)}` : 'encerrada' }}</div>
            </template>
            <span v-else-if="t.concluida_em" class="selo paga">Feita</span>
            <span v-else class="meta">{{ t.data ? dataCurta(t.data) : '' }}</span>
          </div>
        </li>
      </ul>
      <div v-else-if="!carregando" class="vazio painel"><b>{{ verArquivadas ? 'Nada arquivado' : 'Nenhuma tarefa' }}</b></div>
    </template>

    <!-- --------------------------------------------------------- feitas -->
    <template v-else-if="aba === 'feitas' && historico">
      <section class="painel resumo">
        <div><b class="grande">{{ historico.total }}</b><span class="suave">feitas nos últimos 30 dias</span></div>
        <ul class="barras">
          <li v-for="a in historico.por_area" :key="a.area">
            <span>{{ a.area }}</span>
            <span class="barra"><span :style="{ width: (a.qtd / maxHist) * 100 + '%', background: a.cor }" /></span>
            <b>{{ a.qtd }}</b>
          </li>
        </ul>
      </section>
      <ul v-if="historico.itens.length" class="lista painel secao">
        <li v-for="(i, n) in historico.itens" :key="n">
          <span class="ico" :style="{ '--c': i.area_cor ?? 'var(--ink-3)' }">✓</span>
          <div>
            <div class="titulo">{{ i.titulo }}</div>
            <div class="meta">{{ [i.area_nome, i.feita_por_nome ? `por ${i.feita_por_nome.split(' ')[0]}` : null].filter(Boolean).join(' · ') }}</div>
          </div>
          <div class="valor meta">{{ dataCurta(i.data) }}</div>
        </li>
      </ul>
    </template>

    <TarefaForm v-if="form" :tarefa="form.tarefa" :area-padrao="areaFiltro" @fechar="form = null" />
    <EntidadeModal v-if="areaModal" :titulo="areaModal.item ? 'Editar área' : 'Nova área'" rota="/tarefas/areas" :campos="camposArea"
      :item="areaModal.item" :padrao="{ cor: '#64748b', ordem: tarefasEstado.areas.length }"
      confirmar-exclusao="Excluir a área? As tarefas dela ficam sem área." @fechar="aposArea" />
  </div>
</template>

<style scoped>
.secao { gap: 0; }
.vazio { gap: 4px; }
.areas { display: flex; gap: 6px; overflow-x: auto; padding: 2px; scrollbar-width: none; }
.areas button {
  flex: none; display: inline-flex; align-items: center; gap: 7px; font: 600 0.82rem var(--fonte); padding: 6px 12px;
  border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2); cursor: pointer;
}
.areas i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
.areas button[aria-pressed='true'] { background: var(--ink); border-color: var(--ink); color: var(--bg); }
.areas .gerir { padding: 6px 11px; font-size: 1rem; line-height: 1; }
.rapido { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 16px; }
.rapido svg { width: 20px; height: 20px; fill: none; stroke: var(--ink-3); stroke-width: 2; stroke-linecap: round; flex: none; }
.rapido input { border: 0; background: none; box-shadow: none; padding: 8px 0; min-height: 40px; flex: 1; min-width: 0; outline: none; }
.lista-tarefas { list-style: none; margin: 0; padding: 6px 0; }
.secao h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); margin: 0 0 8px 4px; }
.secao h2.sai { color: var(--sai); }
.arquivadas { display: inline-flex; gap: 8px; align-items: center; color: var(--ink-2); font-size: 0.9rem; cursor: pointer; }
.arquivadas input { min-height: 0; width: 18px; height: 18px; accent-color: var(--marca); }
.seq { font-weight: 700; font-size: 0.9rem; }
.resumo { display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: center; padding: 18px 20px; }
.resumo > div { display: grid; }
.grande { font-size: 2.2rem; letter-spacing: -0.03em; line-height: 1; }
.barras { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.barras li { display: grid; grid-template-columns: 90px 1fr 28px; gap: 10px; align-items: center; font-size: 0.85rem; }
.barra { height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
.barra span { display: block; height: 100%; border-radius: 4px; }
@media (max-width: 560px) { .resumo { grid-template-columns: 1fr; } }
@media (pointer: coarse) {
  .areas button { min-height: 40px; padding: 8px 14px; }
  .areas .gerir { min-width: 40px; }
}
</style>

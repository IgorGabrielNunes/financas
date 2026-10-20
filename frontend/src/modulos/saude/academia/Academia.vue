<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../core/api';
import { avisar, avisarMudanca, versao } from '../../../core/store';
import { dataCurta } from '../../../core/format';
import EntidadeModal from '../../../ui/EntidadeModal.vue';
import Modal from '../../../ui/Modal.vue';
import TreinoExecucao from './TreinoExecucao.vue';
import { DIAS_CURTOS, GRUPO, camposExercicio, camposFicha, kg, prescricao, type Exercicio, type Ficha } from './comum';

type Hoje = { data: string; dia_semana: number; fixas: Ficha[]; rodizio: Ficha | null; feitos: { id: string; ficha_id: string; nome: string; duracao_min: number }[] };

const fichas = ref<Ficha[]>([]);
const hoje = ref<Hoje | null>(null);
const erro = ref('');
async function carregar() {
  try {
    [fichas.value, hoje.value] = await Promise.all([api.get<Ficha[]>('/academia/fichas'), api.get<Hoje>('/academia/hoje')]);
  } catch (e) { erro.value = (e as Error).message; }
}
onMounted(carregar);
watch(versao, carregar);

const feitaHoje = (id: string) => hoje.value?.feitos.find((f) => f.ficha_id === id);
const doDia = computed(() => {
  if (!hoje.value) return [];
  const l = hoje.value.fixas.map((f) => ({ f, rodizio: false }));
  if (hoje.value.rodizio && !l.some((x) => x.f.id === hoje.value!.rodizio!.id)) l.push({ f: hoje.value.rodizio, rodizio: true });
  return l;
});

// ---------------------------------------------------------------- modais
const execucao = ref<Ficha | null>(null);
const modalFicha = ref<{ item: Ficha | null } | null>(null);
const modalEx = ref<{ item: Exercicio | null; ficha: Ficha } | null>(null);
const evolucao = ref<{ e: Exercicio; pontos: { data: string; carga_kg: string | null; repeticoes: string | null }[] } | null>(null);
const diasFicha = ref<number[]>([]);
function abrirFicha(item: Ficha | null) {
  diasFicha.value = [...(item?.dias_semana ?? [])];
  modalFicha.value = { item };
}
function alternarDia(d: number) {
  const i = diasFicha.value.indexOf(d);
  if (i >= 0) diasFicha.value.splice(i, 1); else diasFicha.value.push(d);
}
async function verEvolucao(e: Exercicio) {
  evolucao.value = { e, pontos: await api.get(`/academia/exercicios/${e.id}/evolucao`) };
}
async function mover(f: Ficha, i: number, delta: number) {
  const ids = f.exercicios.map((e) => e.id);
  const j = i + delta;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try { await api.put(`/academia/fichas/${f.id}/ordem`, { ids }); avisarMudanca(); } catch (e) { avisar((e as Error).message, 'erro'); }
}
const grafico = computed(() => {
  const ps = (evolucao.value?.pontos ?? []).filter((p) => p.carga_kg !== null).map((p) => ({ d: p.data, v: Number(p.carga_kg) }));
  if (ps.length < 2) return null;
  const min = Math.min(...ps.map((p) => p.v)), max = Math.max(...ps.map((p) => p.v));
  const W = 300, H = 90, span = max - min || 1;
  const pts = ps.map((p, i) => [(i / (ps.length - 1)) * W, H - ((p.v - min) / span) * H]);
  return { W, H, d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '), ps, min, max };
});
const diasTexto = (f: Ficha) => (f.dias_semana.length ? f.dias_semana.map((d) => DIAS_CURTOS[d]).join(', ') : 'rodízio');
</script>

<template>
  <div class="academia">
    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <!-- ------------------------------------------------------- treino de hoje -->
    <section class="secao">
      <header><h2>Treino de hoje</h2><span>{{ DIAS_CURTOS[hoje?.dia_semana ?? 0] }}</span></header>
      <div v-if="doDia.length" class="cartoes">
        <article v-for="{ f, rodizio } in doDia" :key="f.id" class="painel hoje" :style="{ '--c': f.cor }">
          <header>
            <div>
              <b>{{ f.nome }}</b><span v-if="f.foco" class="suave"> · {{ f.foco }}</span>
              <div class="meta">{{ f.exercicios.length }} exercícios{{ f.horario ? ` · ${f.horario}` : '' }}{{ rodizio ? ' · próximo do rodízio' : '' }}</div>
            </div>
            <span v-if="feitaHoje(f.id)" class="selo paga">Feito · {{ feitaHoje(f.id)!.duracao_min }} min</span>
          </header>
          <ul class="mini">
            <li v-for="e in f.exercicios.slice(0, 6)" :key="e.id"><span>{{ e.nome }}</span><span class="suave">{{ prescricao(e) }}</span></li>
            <li v-if="f.exercicios.length > 6" class="suave">+ {{ f.exercicios.length - 6 }} exercícios</li>
          </ul>
          <button v-if="!feitaHoje(f.id)" class="btn primario" :disabled="!f.exercicios.length" @click="execucao = f">Começar treino</button>
        </article>
      </div>
      <div v-else class="vazio painel">
        <b>{{ fichas.length ? 'Dia de descanso' : 'Monte sua ficha' }}</b>
        <span>{{ fichas.length ? 'Nenhuma ficha marcada para hoje.' : 'Cadastre os treinos que o seu personal passou (A, B, C…), com séries, repetições e carga.' }}</span>
        <button v-if="!fichas.length" class="btn primario" @click="abrirFicha(null)">Criar primeira ficha</button>
      </div>
    </section>

    <!-- ---------------------------------------------------------------- fichas -->
    <section class="secao">
      <header><h2>Fichas</h2><button class="btn" @click="abrirFicha(null)">Nova ficha</button></header>
      <p v-if="fichas.length" class="suave miudo dica">Fichas com dias marcados valem nesses dias; sem dias, entram no rodízio (A → B → C → A).</p>
      <article v-for="f in fichas" :key="f.id" class="painel ficha" :class="{ inativa: !f.ativa }" :style="{ '--c': f.cor }">
        <header class="clicavel" @click="abrirFicha(f)">
          <div>
            <b>{{ f.nome }}</b><span v-if="f.foco" class="suave"> · {{ f.foco }}</span>
            <div class="meta">{{ diasTexto(f) }}{{ f.horario ? ` · ${f.horario}` : '' }}{{ f.ultimo_treino ? ` · último ${dataCurta(f.ultimo_treino)}` : '' }}{{ f.ativa ? '' : ' · pausada' }}</div>
          </div>
          <span class="editar" aria-hidden="true">✎</span>
        </header>
        <ol class="lista-ex">
          <li v-for="(e, i) in f.exercicios" :key="e.id">
            <button class="ex" @click="modalEx = { item: e, ficha: f }">
              <span class="grupo">{{ GRUPO[e.grupo] }}</span>
              <span class="nome">{{ e.nome }}</span>
              <span class="presc">{{ prescricao(e) || '—' }}</span>
            </button>
            <div class="acoes-ex">
              <button aria-label="Ver evolução da carga" title="Evolução" @click="verEvolucao(e)">📈</button>
              <button :disabled="i === 0" aria-label="Subir" @click="mover(f, i, -1)">↑</button>
              <button :disabled="i === f.exercicios.length - 1" aria-label="Descer" @click="mover(f, i, 1)">↓</button>
            </div>
          </li>
        </ol>
        <button class="btn-link" @click="modalEx = { item: null, ficha: f }">+ exercício</button>
      </article>
    </section>

    <TreinoExecucao v-if="execucao" :ficha="execucao" @fechar="execucao = null" />

    <EntidadeModal v-if="modalFicha" :titulo="modalFicha.item ? 'Editar ficha' : 'Nova ficha'" rota="/academia/fichas" :campos="camposFicha"
      :item="modalFicha.item" :padrao="{ cor: '#13805a' }" :fixos="{ dias_semana: diasFicha, ativa: modalFicha.item?.ativa ?? true }"
      confirmar-exclusao="Excluir a ficha e os exercícios dela? O histórico de treinos feitos continua." @fechar="modalFicha = null">
      <div class="campo">
        <span>Dias da semana</span>
        <div class="dias">
          <button v-for="(d, i) in DIAS_CURTOS" :key="d" type="button" :aria-pressed="diasFicha.includes(i)" @click="alternarDia(i)">{{ d }}</button>
        </div>
        <small>Nenhum dia marcado = entra no rodízio.</small>
      </div>
    </EntidadeModal>

    <EntidadeModal v-if="modalEx" :titulo="modalEx.item ? 'Editar exercício' : `Novo exercício · ${modalEx.ficha.nome}`" rota="/academia/exercicios"
      :campos="camposExercicio" :item="modalEx.item" :padrao="{ grupo: 'outro', series: 3, repeticoes: '10-12' }"
      :fixos="{ ficha_id: modalEx.ficha.id }" confirmar-exclusao="Excluir este exercício da ficha?" @fechar="modalEx = null" />

    <Modal v-if="evolucao" :titulo="`Evolução · ${evolucao.e.nome}`" @fechar="evolucao = null">
      <template v-if="grafico">
        <svg class="evolucao" :viewBox="`-6 -8 ${grafico.W + 12} ${grafico.H + 16}`" preserveAspectRatio="none" role="img"
          :aria-label="`Carga de ${kg(grafico.min)} a ${kg(grafico.max)} kg`">
          <path :d="grafico.d" />
        </svg>
        <div class="eixo suave miudo"><span>{{ dataCurta(grafico.ps[0].d) }} · {{ kg(grafico.ps[0].v) }} kg</span><span>{{ kg(grafico.ps.at(-1)!.v) }} kg</span></div>
      </template>
      <ul v-if="evolucao.pontos.length" class="lista">
        <li v-for="(p, i) in [...evolucao.pontos].reverse()" :key="i">
          <div><div class="titulo">{{ dataCurta(p.data) }}</div></div>
          <div class="valor">{{ kg(p.carga_kg) ?? '—' }} kg × {{ p.repeticoes ?? '—' }}</div>
        </li>
      </ul>
      <p v-else class="suave">Ainda sem registros. A evolução aparece conforme você conclui treinos.</p>
    </Modal>
  </div>
</template>

<style scoped>
.academia { display: grid; gap: 22px; }
.secao > header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.secao > header h2 { font-size: 1rem; margin: 0; }
.secao > header span { color: var(--ink-3); font-size: 0.875rem; }
.dica { margin: -4px 0 0; }
.cartoes { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); gap: 12px; }
.hoje { padding: 16px 18px; display: grid; gap: 12px; border-left: 4px solid var(--c); }
.hoje > header, .ficha > header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.meta { color: var(--ink-3); font-size: 0.8125rem; margin-top: 2px; }
.mini { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 0.875rem; }
.mini li { display: flex; justify-content: space-between; gap: 12px; }
.mini li span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mini li .suave { flex: none; }
.ficha { padding: 0; overflow: hidden; border-top: 3px solid var(--c); }
.ficha.inativa { opacity: 0.6; }
.ficha > header { padding: 14px 16px; border-bottom: 1px solid var(--line); }
.ficha > header.clicavel { cursor: pointer; }
.ficha > header.clicavel:hover { background: var(--surface-2); }
.editar { color: var(--ink-3); }
.lista-ex { list-style: none; margin: 0; padding: 4px 0; }
.lista-ex li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; padding: 0 10px 0 4px; }
.lista-ex li + li { border-top: 1px solid var(--line); }
.ex { display: grid; grid-template-columns: 82px minmax(0, 1fr); grid-template-areas: 'g n' 'g p'; column-gap: 10px; text-align: left; border: 0; background: none; font: inherit; color: inherit; padding: 10px 12px; cursor: pointer; border-radius: var(--raio-s); min-height: 48px; }
.ex:hover { background: var(--surface-2); }
.grupo { grid-area: g; align-self: center; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--c); }
.nome { grid-area: n; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.presc { grid-area: p; color: var(--ink-3); font-size: 0.8125rem; }
.acoes-ex { display: flex; gap: 2px; }
.acoes-ex button { width: 34px; height: 34px; border: 0; background: none; border-radius: 8px; cursor: pointer; color: var(--ink-2); font-size: 0.95rem; }
.acoes-ex button:hover:not(:disabled) { background: var(--surface-2); }
.acoes-ex button:disabled { opacity: 0.3; cursor: default; }
.btn-link { border: 0; background: none; color: var(--marca-tint-ink); font: 600 0.875rem var(--fonte); padding: 10px 16px 14px; cursor: pointer; }
.dias { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.dias button { font: 600 0.8rem var(--fonte); padding: 9px 0; min-height: 40px; border-radius: var(--raio-s); border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2); cursor: pointer; }
.dias button[aria-pressed='true'] { background: var(--marca); border-color: var(--marca); color: var(--marca-ink); }
.evolucao { width: 100%; height: 120px; overflow: visible; }
.evolucao path { fill: none; stroke: var(--marca); stroke-width: 2.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.eixo { display: flex; justify-content: space-between; margin: 6px 0 12px; }
@media (max-width: 560px) {
  .ex { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'g' 'n' 'p'; }
  .acoes-ex button { width: 40px; height: 40px; }
}
@media (pointer: coarse) { .btn-link { min-height: 44px; } }
</style>

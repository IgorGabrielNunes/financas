<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../core/api';
import { abrirLancamento, sessao, versao } from '../core/store';
import { dataCurta, diasAte, dinheiro, hoje, horas } from '../core/format';
import TarefaItem from '../modulos/tarefas/TarefaItem.vue';
import TarefaForm from '../modulos/tarefas/TarefaForm.vue';
import { carregarApoio, type Tarefa } from '../modulos/tarefas/tipos';
import { ETAPA } from '../modulos/profissional/comum';

// Início = o dia: o que fazer, o que tomar, o que vem por aí e quanto dá para gastar.
// Cada bloco carrega sozinho: se um módulo falhar, o resto da tela continua útil.
const tarefas = ref<Tarefa[] | null>(null);
const saude = ref<any>(null);
const agenda = ref<any[]>([]);
const financas = ref<{ disponivel_centavos: number; horizonte: string } | null>(null);
const estudoSemana = ref<number | null>(null);
const apoioPronto = ref(false);

async function carregar() {
  const h = hoje();
  api.get<Tarefa[]>(`/tarefas/agenda?de=${h}&ate=${h}`).then((r) => (tarefas.value = r)).catch(() => (tarefas.value = []));
  api.get('/saude/resumo').then((r) => (saude.value = r)).catch(() => {});
  api.get<any[]>('/hoje/agenda').then((r) => (agenda.value = r)).catch(() => {});
  api.get<any>('/dashboard').then((r) => (financas.value = { disponivel_centavos: r.disponivel.disponivel_centavos, horizonte: r.horizonte })).catch(() => {});
  api.get<any>('/estudos/resumo').then((r) => (estudoSemana.value = r.minutos.semana)).catch(() => {});
}
watch(versao, carregar, { immediate: true });
carregarApoio().then(() => (apoioPronto.value = true)).catch(() => {});

const pendentes = computed(() => tarefas.value?.filter((t) => !t.feita) ?? []);
const feitas = computed(() => tarefas.value?.filter((t) => t.feita) ?? []);
const doses = computed(() => saude.value?.doses_hoje ?? []);
const porDia = computed(() => {
  if (!financas.value) return null;
  const d = diasAte(financas.value.horizonte);
  return d > 0 ? Math.max(0, financas.value.disponivel_centavos) / d : null;
});

async function alternarDose(d: any) {
  if (d.tomada) await api.del(`/saude/remedios/${d.remedio_id}/doses?horario=${d.horario}`);
  else await api.post(`/saude/remedios/${d.remedio_id}/doses`, { horario: d.horario });
  d.tomada = !d.tomada;
}

const ROTULO: Record<string, [string, string]> = {
  consulta: ['Saúde', '#dc2626'], avaliacao: ['Estudos', '#4f46e5'], entrevista: ['Entrevista', '#475569'], card: ['Projeto', '#0f4b3a'], marco: ['Marco', '#b45309'],
};
const quando = (d: string) => { const n = diasAte(d); return n === 0 ? 'hoje' : n === 1 ? 'amanhã' : dataCurta(d); };

const saudacao = computed(() => {
  const h = +new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date());
  const nome = sessao.eu?.nome?.split(' ')[0];
  return `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}${nome ? `, ${nome}` : ''}`;
});
const hojeLongo = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date());
const form = ref<{ tarefa: Tarefa | null } | null>(null);
</script>

<template>
  <div class="pagina modulo">
    <header class="topo">
      <div>
        <p class="suave data">{{ hojeLongo }}</p>
        <h1>{{ saudacao }}</h1>
      </div>
    </header>

    <div class="kpis">
      <RouterLink to="/tarefas">
        <span>Tarefas de hoje</span>
        <b>{{ tarefas ? `${feitas.length}/${tarefas.length}` : '—' }}</b>
        <small>{{ pendentes.length ? `${pendentes.length} pendente${pendentes.length > 1 ? 's' : ''}` : tarefas?.length ? 'tudo feito' : 'nada marcado' }}</small>
      </RouterLink>
      <RouterLink to="/financas/painel">
        <span>Disponível para gastar</span>
        <b :class="{ sai: (financas?.disponivel_centavos ?? 0) < 0 }">{{ financas ? dinheiro(financas.disponivel_centavos) : '—' }}</b>
        <small>{{ porDia !== null ? `${dinheiro(porDia)} por dia até ${dataCurta(financas!.horizonte)}` : 'finanças da casa' }}</small>
      </RouterLink>
      <RouterLink to="/estudos">
        <span>Estudo (7 dias)</span>
        <b>{{ estudoSemana === null ? '—' : horas(estudoSemana) }}</b>
        <small>registre pelo botão +</small>
      </RouterLink>
      <RouterLink to="/saude">
        <span>Peso</span>
        <b>{{ saude?.peso ? `${Number(saude.peso.atual).toLocaleString('pt-BR')} kg` : '—' }}</b>
        <small>{{ saude?.treinos_semana?.length ? `${saude.treinos_semana.reduce((s: number, t: any) => s + t.qtd, 0)} treino(s) na semana` : 'sem treinos na semana' }}</small>
      </RouterLink>
    </div>

    <div class="duas">
      <section class="secao">
        <header><h2>Hoje</h2><button class="btn link" @click="form = { tarefa: null }">+ tarefa</button></header>
        <ul v-if="pendentes.length || feitas.length" class="painel lista-tarefas">
          <TarefaItem v-for="t in [...pendentes, ...feitas]" :key="t.id + (t.ocorrencia ?? '')" :t="t" @abrir="(x) => apoioPronto && (form = { tarefa: x })" />
        </ul>
        <div v-else-if="tarefas" class="vazio painel"><span>Nada para hoje. Que tal planejar a semana?</span></div>

        <template v-if="doses.length">
          <header><h2>Remédios</h2></header>
          <ul class="lista painel">
            <li v-for="d in doses" :key="d.remedio_id + d.horario">
              <button class="dose" :aria-pressed="d.tomada" :aria-label="`${d.tomada ? 'Desmarcar' : 'Marcar'} ${d.nome} das ${d.horario}`" @click="alternarDose(d)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>
              </button>
              <div><div class="titulo" :class="{ riscado: d.tomada }">{{ d.nome }}</div><div class="meta">{{ d.dosagem ?? '' }}</div></div>
              <div class="valor">{{ d.horario }}</div>
            </li>
          </ul>
        </template>
      </section>

      <section class="secao">
        <header><h2>Próximos 14 dias</h2></header>
        <ul v-if="agenda.length" class="lista painel">
          <li v-for="a in agenda" :key="a.tipo + a.id" class="clicavel" @click="$router.push(a.rota)">
            <span class="ico" :style="{ '--c': ROTULO[a.tipo]?.[1] ?? 'var(--ink-3)' }">{{ diasAte(a.data) }}d</span>
            <div>
              <div class="titulo">{{ a.titulo }}</div>
              <div class="meta">{{ [ROTULO[a.tipo]?.[0], a.tipo === 'entrevista' ? ETAPA[a.detalhe as keyof typeof ETAPA] ?? a.detalhe : a.detalhe].filter(Boolean).join(' · ') }}</div>
            </div>
            <div class="valor"><div>{{ quando(a.data) }}</div><div class="meta">{{ a.hora?.slice(0, 5) ?? '' }}</div></div>
          </li>
        </ul>
        <div v-else class="vazio painel"><span>Nenhuma consulta, prova, entrevista ou prazo de projeto à vista.</span></div>

        <div class="atalhos">
          <button class="btn" @click="abrirLancamento()">Lançar gasto</button>
          <RouterLink class="btn" to="/notas?novo=1">Anotar</RouterLink>
          <RouterLink class="btn" to="/financas/mes">Mês</RouterLink>
        </div>
      </section>
    </div>

    <TarefaForm v-if="form" :tarefa="form.tarefa" @fechar="form = null" />
  </div>
</template>

<style scoped>
.topo .data { font-size: 0.875rem; margin-bottom: 4px; }
.topo .data::first-letter { text-transform: uppercase; }
.topo h1 { margin: 0; }
.kpis a:hover { background: var(--surface-2); }
.duas { display: grid; grid-template-columns: 1.1fr 1fr; gap: 18px; align-items: start; }
@media (max-width: 900px) { .duas { grid-template-columns: 1fr; } }
.secao > header { display: flex; justify-content: space-between; align-items: center; }
.secao > header h2 { font-size: 1rem; margin: 6px 0 0; }
.lista-tarefas { list-style: none; margin: 0; padding: 6px 0; }
.dose { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #0891b2; background: var(--surface); cursor: pointer; display: grid; place-items: center; padding: 0; color: transparent; }
.dose[aria-pressed='true'] { background: #0891b2; color: #fff; }
.dose svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.riscado { text-decoration: line-through; color: var(--ink-3); }
.vazio { gap: 4px; padding: 24px 20px; }
.atalhos { display: flex; gap: 8px; flex-wrap: wrap; }
.dose { position: relative; }
.dose::after { content: ''; position: absolute; inset: -10px; } /* 24px internos + 2×10 = 44px */
@media (pointer: coarse) {
  .secao > header .btn.link { min-height: 40px; }
}
</style>

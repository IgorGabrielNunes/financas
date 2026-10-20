<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../core/api';
import { avisar, avisarMudanca, versao } from '../../core/store';
import { dataCurta, diasAte, hoje, horas, num, somarDias } from '../../core/format';
import Abas from '../../ui/Abas.vue';
import EntidadeModal from '../../ui/EntidadeModal.vue';
import { opcoes, type Campo } from '../../ui/campos';
import DisciplinaModal from './DisciplinaModal.vue';

const TIPO_CURSO = { faculdade: 'Faculdade', pos: 'Pós-graduação', curso: 'Curso', certificacao: 'Certificação', idioma: 'Idioma' };
const STATUS_CURSO = { andamento: 'Em andamento', planejado: 'Planejado', pausado: 'Pausado', concluido: 'Concluído', trancado: 'Trancado' };
const STATUS_DISC = { cursando: 'Cursando', a_cursar: 'A cursar', aprovada: 'Aprovada', reprovada: 'Reprovada', dispensada: 'Dispensada' };
const STATUS_LIVRO = { lendo: 'Lendo', quero_ler: 'Quero ler', lido: 'Lido', abandonado: 'Abandonado' };
const SITUACAO: Record<string, [string, string]> = {
  aprovado: ['Aprovado', 'paga'], reprovado: ['Reprovado', 'vencida'], em_risco: ['Em risco', 'vencida'],
  cursando: ['Cursando', ''], sem_avaliacoes: ['Sem notas', ''],
};

const route = useRoute();
const router = useRouter();
const aba = computed(() => (route.query.aba as string) || 'painel');

const resumo = ref<any>(null);
const cursos = ref<any[]>([]);
const disciplinas = ref<any[]>([]);
const livros = ref<any[]>([]);
const sessoes = ref<any[]>([]);
const erro = ref('');

async function carregar() {
  try {
    const [r, c, d, l] = await Promise.all([
      api.get('/estudos/resumo'), api.get<any[]>('/estudos/cursos'), api.get<any[]>('/estudos/disciplinas'), api.get<any[]>('/estudos/livros'),
    ]);
    resumo.value = r; cursos.value = c; disciplinas.value = d; livros.value = l;
    if (aba.value === 'sessoes') sessoes.value = await api.get('/estudos/sessoes');
  } catch (e) { erro.value = (e as Error).message; }
}
onMounted(() => { carregar(); abrirDaUrl(); });
watch([versao, aba], carregar);
watch(() => route.query.novo, abrirDaUrl);
function abrirDaUrl() {
  if (route.query.novo === 'sessao') { modal.value = { tipo: 'sessao', item: null }; router.replace({ query: { ...route.query, novo: undefined } }); }
}

// -------------------------------------------------------------------- modais
type TipoModal = 'curso' | 'disciplina' | 'livro' | 'sessao';
const modal = ref<{ tipo: TipoModal; item: any; padrao?: Record<string, any> } | null>(null);
const discAberta = ref<any>(null);

const opCursos = () => cursos.value.map((c) => ({ v: c.id, r: c.nome }));
const opDisc = () => disciplinas.value.filter((d) => d.status === 'cursando' || d.status === 'a_cursar').map((d) => ({ v: d.id, r: d.nome }));
const opLivros = () => livros.value.filter((l) => l.status === 'lendo').map((l) => ({ v: l.id, r: l.titulo }));

const CAMPOS: Record<TipoModal, { titulo: string; rota: string; campos: Campo[]; padrao?: Record<string, any> }> = {
  curso: {
    titulo: 'Curso', rota: '/estudos/cursos', padrao: { tipo: 'faculdade', status: 'andamento', media_aprovacao: 7 },
    campos: [
      { k: 'nome', r: 'Nome', obrig: true, ph: 'Ex.: Engenharia de Software' },
      { k: 'tipo', r: 'Tipo', t: 'sel', op: opcoes(TIPO_CURSO), meia: true },
      { k: 'instituicao', r: 'Instituição', meia: true, ph: 'Uninter, Alura…' },
      { k: 'status', r: 'Situação', t: 'sel', op: opcoes(STATUS_CURSO), meia: true },
      { k: 'media_aprovacao', r: 'Média para aprovar', t: 'num', min: 0, max: 10, passo: 0.1, meia: true },
      { k: 'inicio', r: 'Início', t: 'data', meia: true },
      { k: 'fim_previsto', r: 'Término previsto', t: 'data', meia: true },
      { k: 'concluido_em', r: 'Concluído em', t: 'data', meia: true, se: (m) => m.status === 'concluido' },
      { k: 'carga_horaria_h', r: 'Carga horária (h)', t: 'num', min: 1, passo: 1, meia: true },
      { k: 'url', r: 'Link (portal, plataforma)', t: 'url' },
      { k: 'observacoes', r: 'Observações', t: 'area', linhas: 3 },
    ],
  },
  disciplina: {
    titulo: 'Disciplina', rota: '/estudos/disciplinas', padrao: { status: 'cursando', cor: '#4f46e5' },
    campos: [
      { k: 'nome', r: 'Nome', obrig: true },
      { k: 'curso_id', r: 'Curso', t: 'sel', op: opCursos, vazio: 'Avulsa', meia: true },
      { k: 'periodo', r: 'Período / fase', meia: true, ph: '2026/2, Fase 3…' },
      { k: 'status', r: 'Situação', t: 'sel', op: opcoes(STATUS_DISC), meia: true },
      { k: 'professor', r: 'Professor(a)', meia: true },
      { k: 'inicio', r: 'Início', t: 'data', meia: true },
      { k: 'fim', r: 'Fim', t: 'data', meia: true },
      { k: 'cor', r: 'Cor', t: 'cor' },
    ],
  },
  livro: {
    titulo: 'Livro', rota: '/estudos/livros', padrao: { status: 'quero_ler', pagina_atual: 0 },
    campos: [
      { k: 'titulo', r: 'Título', obrig: true },
      { k: 'autor', r: 'Autor(a)', meia: true },
      { k: 'status', r: 'Situação', t: 'sel', op: opcoes(STATUS_LIVRO), meia: true },
      { k: 'pagina_atual', r: 'Página atual', t: 'num', min: 0, passo: 1, meia: true },
      { k: 'paginas_total', r: 'Total de páginas', t: 'num', min: 1, passo: 1, meia: true },
      { k: 'inicio', r: 'Começou em', t: 'data', meia: true },
      { k: 'fim', r: 'Terminou em', t: 'data', meia: true },
      { k: 'avaliacao', r: 'Nota (1 a 5)', t: 'sel', op: [1, 2, 3, 4, 5].map((v) => ({ v, r: '★'.repeat(v) })), vazio: 'Sem nota', se: (m) => m.status === 'lido' || m.status === 'abandonado' },
      { k: 'notas', r: 'Anotações', t: 'area', linhas: 4 },
    ],
  },
  sessao: {
    titulo: 'Tempo de estudo', rota: '/estudos/sessoes', padrao: { data: hoje(), minutos: 30 },
    campos: [
      { k: 'data', r: 'Dia', t: 'data', obrig: true, meia: true },
      { k: 'minutos', r: 'Minutos', t: 'num', min: 1, max: 1440, passo: 5, obrig: true, meia: true },
      { k: 'disciplina_id', r: 'Disciplina', t: 'sel', op: opDisc, vazio: '—', meia: true },
      { k: 'curso_id', r: 'Curso', t: 'sel', op: opCursos, vazio: '—', meia: true },
      { k: 'livro_id', r: 'Livro', t: 'sel', op: opLivros, vazio: '—' },
      { k: 'assunto', r: 'O que estudou', ph: 'Ex.: revisão de grafos' },
    ],
  },
};
const def = computed(() => (modal.value ? CAMPOS[modal.value.tipo] : null));

// -------------------------------------------------------------------- painel
const maxDia = computed(() => Math.max(30, ...(resumo.value?.por_dia ?? []).map((d: any) => d.minutos)));
const dias28 = computed(() => {
  const mapa = new Map<string, number>((resumo.value?.por_dia ?? []).map((d: any) => [d.data, d.minutos]));
  return Array.from({ length: 28 }, (_, i) => { const d = somarDias(hoje(), i - 27); return { d, m: mapa.get(d) ?? 0 }; });
});
const pct = (l: any) => (l.paginas_total ? Math.min(100, Math.round((l.pagina_atual / l.paginas_total) * 100)) : 0);
const discDoCurso = (id: string | null) => disciplinas.value.filter((d) => d.curso_id === id);
const avulsas = computed(() => discDoCurso(null));

async function minutosRapidos(min: number) {
  try {
    await api.post('/estudos/sessoes', { data: hoje(), minutos: min });
    avisar(`${horas(min)} registrados`);
    avisarMudanca();
  } catch (e) { avisar((e as Error).message, 'erro'); }
}
async function avancarPagina(l: any) {
  const p = prompt(`Em que página você está em "${l.titulo}"?`, String(l.pagina_atual));
  if (p === null || p === '' || Number.isNaN(+p)) return;
  const fim = l.paginas_total && +p >= l.paginas_total;
  await api.patch(`/estudos/livros/${l.id}`, { pagina_atual: +p, ...(fim ? { status: 'lido', fim: hoje() } : {}) }).catch((e) => avisar(e.message, 'erro'));
  if (fim) avisar('Livro concluído! 📚');
  avisarMudanca();
}
const nomeSessao = (s: any) =>
  disciplinas.value.find((d) => d.id === s.disciplina_id)?.nome ?? livros.value.find((l) => l.id === s.livro_id)?.titulo
  ?? cursos.value.find((c) => c.id === s.curso_id)?.nome ?? 'Estudo livre';
</script>

<template>
  <div class="pagina modulo">
    <header class="cabecalho">
      <div>
        <h1>Estudos</h1>
        <p>Faculdade, cursos, livros e tempo estudado.</p>
      </div>
      <button class="btn primario" @click="modal = { tipo: 'sessao', item: null }">Registrar estudo</button>
    </header>

    <Abas :abas="[{ id: 'painel', r: 'Painel' }, { id: 'cursos', r: 'Cursos e disciplinas' }, { id: 'livros', r: 'Livros' }, { id: 'sessoes', r: 'Histórico' }]" />
    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <!-- ---------------------------------------------------------- painel -->
    <template v-if="aba === 'painel' && resumo">
      <div class="kpis bloco">
        <div><span>Últimos 7 dias</span><b>{{ horas(resumo.minutos.semana) }}</b></div>
        <div><span>Este mês</span><b>{{ horas(resumo.minutos.mes) }}</b></div>
        <div><span>Total registrado</span><b>{{ horas(resumo.minutos.total) }}</b></div>
        <div class="rapido">
          <span>Registrar agora</span>
          <div><button v-for="m in [15, 30, 60]" :key="m" class="btn" @click="minutosRapidos(m)">+{{ horas(m) }}</button></div>
        </div>
      </div>

      <section class="painel bloco grafico" aria-label="Minutos estudados por dia nos últimos 28 dias">
        <header><b>Últimas 4 semanas</b><span class="suave miudo">minutos por dia</span></header>
        <div class="barras">
          <span v-for="d in dias28" :key="d.d" :class="{ hoje: d.d === hoje() }" :style="{ height: Math.max(2, (d.m / maxDia) * 100) + '%' }" :title="`${dataCurta(d.d)}: ${horas(d.m)}`" />
        </div>
      </section>

      <div class="duas bloco">
        <section class="secao">
          <header><h2>Disciplinas em curso</h2></header>
          <ul v-if="resumo.disciplinas.length" class="lista painel">
            <li v-for="d in resumo.disciplinas" :key="d.id" class="clicavel" @click="discAberta = d">
              <span class="ico" :style="{ '--c': d.cor }">{{ d.nome.slice(0, 1) }}</span>
              <div>
                <div class="titulo">{{ d.nome }}</div>
                <div class="meta">
                  {{ d.precisa_nas_restantes !== null ? `precisa de ${num(d.precisa_nas_restantes)} nas restantes` : d.curso_nome ?? 'avulsa' }}
                </div>
              </div>
              <div class="valor">
                <div>{{ num(d.media) }}</div>
                <span :class="['selo', SITUACAO[d.situacao]?.[1]]">{{ SITUACAO[d.situacao]?.[0] }}</span>
              </div>
            </li>
          </ul>
          <div v-else class="vazio painel"><span>Nenhuma disciplina em curso.</span><button class="btn" @click="router.replace({ query: { aba: 'cursos' } })">Cadastrar</button></div>
        </section>

        <section class="secao">
          <header><h2>Próximas avaliações</h2></header>
          <ul v-if="resumo.proximas_avaliacoes.length" class="lista painel">
            <li v-for="a in resumo.proximas_avaliacoes" :key="a.id" class="clicavel" @click="discAberta = disciplinas.find((d) => d.id === a.disciplina_id)">
              <span class="ico" :style="{ '--c': a.disciplina_cor }">{{ diasAte(a.data) }}d</span>
              <div><div class="titulo">{{ a.titulo }}</div><div class="meta">{{ a.disciplina_nome }}</div></div>
              <div class="valor meta">{{ dataCurta(a.data) }}</div>
            </li>
          </ul>
          <div v-else class="vazio painel"><span>Nenhuma avaliação marcada.</span></div>

          <template v-if="resumo.lendo.length">
            <header><h2>Lendo</h2></header>
            <ul class="lista painel">
              <li v-for="l in resumo.lendo" :key="l.id" class="clicavel" @click="avancarPagina(l)">
                <span class="ico" style="--c: #b45309">📖</span>
                <div>
                  <div class="titulo">{{ l.titulo }}</div>
                  <div class="medidor"><i :style="{ width: pct(l) + '%', background: 'var(--marca)' }" /></div>
                </div>
                <div class="valor meta">{{ l.paginas_total ? `${pct(l)}%` : `p. ${l.pagina_atual}` }}</div>
              </li>
            </ul>
          </template>
        </section>
      </div>
    </template>

    <!-- ------------------------------------------------- cursos/disciplinas -->
    <template v-else-if="aba === 'cursos'">
      <div class="acoes-topo">
        <button class="btn" @click="modal = { tipo: 'curso', item: null }">Novo curso</button>
        <button class="btn" @click="modal = { tipo: 'disciplina', item: null }">Nova disciplina</button>
      </div>
      <section v-for="c in cursos" :key="c.id" class="painel curso">
        <header class="clicavel" @click="modal = { tipo: 'curso', item: c }">
          <div>
            <b>{{ c.nome }}</b>
            <div class="meta">{{ [TIPO_CURSO[c.tipo as keyof typeof TIPO_CURSO], c.instituicao, c.fim_previsto ? `até ${dataCurta(c.fim_previsto)}` : null].filter(Boolean).join(' · ') }}</div>
          </div>
          <span :class="['selo', c.status === 'concluido' ? 'paga' : c.status === 'trancado' ? 'vencida' : '']">{{ STATUS_CURSO[c.status as keyof typeof STATUS_CURSO] }}</span>
        </header>
        <ul v-if="discDoCurso(c.id).length" class="lista">
          <li v-for="d in discDoCurso(c.id)" :key="d.id" class="clicavel" @click="discAberta = d">
            <span class="ico" :style="{ '--c': d.cor }">{{ d.nome.slice(0, 1) }}</span>
            <div><div class="titulo">{{ d.nome }}</div><div class="meta">{{ [d.periodo, d.professor].filter(Boolean).join(' · ') || '—' }}</div></div>
            <div class="valor"><span class="selo">{{ STATUS_DISC[d.status as keyof typeof STATUS_DISC] }}</span></div>
          </li>
        </ul>
        <button class="btn-link" @click="modal = { tipo: 'disciplina', item: null, padrao: { curso_id: c.id, status: 'cursando', cor: '#4f46e5' } }">+ disciplina</button>
      </section>
      <section v-if="avulsas.length" class="painel curso">
        <header><b>Disciplinas avulsas</b></header>
        <ul class="lista">
          <li v-for="d in avulsas" :key="d.id" class="clicavel" @click="discAberta = d">
            <span class="ico" :style="{ '--c': d.cor }">{{ d.nome.slice(0, 1) }}</span>
            <div><div class="titulo">{{ d.nome }}</div></div>
            <div class="valor"><span class="selo">{{ STATUS_DISC[d.status as keyof typeof STATUS_DISC] }}</span></div>
          </li>
        </ul>
      </section>
      <div v-if="!cursos.length && !avulsas.length" class="vazio painel bloco">
        <b>Comece pela faculdade</b><span>Cadastre o curso e depois as disciplinas com provas, APOLs e notas.</span>
      </div>
    </template>

    <!-- ---------------------------------------------------------- livros -->
    <template v-else-if="aba === 'livros'">
      <div class="acoes-topo"><button class="btn" @click="modal = { tipo: 'livro', item: null }">Novo livro</button></div>
      <template v-for="(rot, st) in STATUS_LIVRO" :key="st">
        <section v-if="livros.some((l) => l.status === st)" class="secao bloco">
          <header><h2>{{ rot }}</h2></header>
          <ul class="lista painel">
            <li v-for="l in livros.filter((x) => x.status === st)" :key="l.id" class="clicavel" @click="modal = { tipo: 'livro', item: l }">
              <span class="ico" style="--c: #b45309">{{ l.titulo.slice(0, 1) }}</span>
              <div>
                <div class="titulo">{{ l.titulo }}</div>
                <div class="meta">{{ l.autor ?? '' }}<template v-if="l.avaliacao"> · {{ '★'.repeat(l.avaliacao) }}</template></div>
              </div>
              <div class="valor">
                <button v-if="st === 'lendo'" class="btn" @click.stop="avancarPagina(l)">{{ l.paginas_total ? `${pct(l)}%` : `p. ${l.pagina_atual}` }}</button>
                <span v-else-if="l.fim" class="meta">{{ dataCurta(l.fim) }}</span>
              </div>
            </li>
          </ul>
        </section>
      </template>
      <div v-if="!livros.length" class="vazio painel bloco"><b>Nenhum livro</b><span>Monte sua lista de leitura.</span></div>
    </template>

    <!-- --------------------------------------------------------- sessões -->
    <template v-else-if="aba === 'sessoes'">
      <ul v-if="sessoes.length" class="lista painel bloco">
        <li v-for="s in sessoes" :key="s.id" class="clicavel" @click="modal = { tipo: 'sessao', item: s }">
          <span class="ico" style="--c: #4f46e5">⏱</span>
          <div><div class="titulo">{{ nomeSessao(s) }}</div><div class="meta">{{ [dataCurta(s.data), s.assunto].filter(Boolean).join(' · ') }}</div></div>
          <div class="valor">{{ horas(s.minutos) }}</div>
        </li>
      </ul>
      <div v-else class="vazio painel bloco"><b>Nada registrado</b><span>Registre o tempo de cada estudo para acompanhar a evolução.</span></div>
    </template>

    <EntidadeModal v-if="modal && def" :titulo="(modal.item ? 'Editar ' : 'Novo: ') + def.titulo.toLowerCase()" :rota="def.rota" :campos="def.campos"
      :item="modal.item" :padrao="modal.padrao ?? def.padrao" @fechar="modal = null" />
    <DisciplinaModal v-if="discAberta" :disciplina="discAberta" :media-aprovacao="Number(cursos.find((c) => c.id === discAberta.curso_id)?.media_aprovacao ?? 7)"
      @fechar="discAberta = null" @editar="modal = { tipo: 'disciplina', item: discAberta }; discAberta = null" />
  </div>
</template>

<style scoped>
.rapido > div { display: flex; gap: 6px; flex-wrap: wrap; }
.rapido .btn { min-height: 34px; padding: 6px 10px; font-size: 0.85rem; }
.grafico { padding: 16px 20px; }
.grafico header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
.barras { display: grid; grid-template-columns: repeat(28, 1fr); gap: 3px; height: 110px; align-items: end; }
.barras span { background: color-mix(in srgb, #4f46e5 70%, var(--surface)); border-radius: 3px 3px 1px 1px; min-height: 2px; }
.barras span.hoje { background: var(--marca); }
.duas { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 900px) { .duas { grid-template-columns: 1fr; } }
.secao > header h2 { font-size: 1rem; margin: 6px 0 0; }
.lista .medidor { margin-top: 6px; max-width: 220px; }
.acoes-topo { display: flex; gap: 8px; flex-wrap: wrap; }
.curso { overflow: hidden; }
.curso > header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--line); }
.curso > header.clicavel { cursor: pointer; }
.curso > header.clicavel:hover { background: var(--surface-2); }
.curso .meta { color: var(--ink-3); font-size: 0.8125rem; }
.btn-link { border: 0; background: none; color: var(--marca-tint-ink); font: 600 0.875rem var(--fonte); padding: 10px 18px 14px; cursor: pointer; }
@media (pointer: coarse) {
  .btn-link { min-height: 44px; }
}
</style>

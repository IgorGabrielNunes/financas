<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../core/api';
import { versao } from '../../core/store';
import { dataCurta, diasAte, dinheiro } from '../../core/format';
import Abas from '../../ui/Abas.vue';
import EntidadeModal from '../../ui/EntidadeModal.vue';
import { opcoes, type Campo } from '../../ui/campos';
import VagaModal from './VagaModal.vue';
import { CAMPOS_VAGA, ETAPA, MODALIDADE, STATUS_VAGA, VINCULO } from './comum';

const CAT_HAB = { tecnica: 'Técnicas', ferramenta: 'Ferramentas', dominio: 'Domínio de negócio', idioma: 'Idiomas', comportamental: 'Comportamentais' };
const CAT_META = { carreira: 'Carreira', salario: 'Salário', tecnica: 'Técnica', certificacao: 'Certificação', rede: 'Networking', outro: 'Outro' };
const STATUS_META = { aberta: 'Aberta', andamento: 'Em andamento', concluida: 'Concluída', abandonada: 'Abandonada' };
const NIVEL = ['', 'Básico', 'Intermediário', 'Avançado', 'Experiente', 'Referência'];
const COLUNAS_FUNIL = ['interesse', 'aplicada', 'em_processo', 'proposta'] as const;

const route = useRoute();
const aba = computed(() => (route.query.aba as string) || 'painel');
const resumo = ref<any>(null);
const vagas = ref<any[]>([]);
const metas = ref<any[]>([]);
const cv = ref<any>(null);
const erro = ref('');

async function carregar() {
  try {
    if (aba.value === 'painel') resumo.value = await api.get('/profissional/resumo');
    if (aba.value === 'painel' || aba.value === 'vagas') vagas.value = await api.get('/profissional/vagas');
    if (aba.value === 'metas') metas.value = await api.get('/profissional/metas');
    if (aba.value === 'curriculo') cv.value = await api.get('/profissional/curriculo');
  } catch (e) { erro.value = (e as Error).message; }
}
onMounted(carregar);
watch([aba, versao], carregar);

// --------------------------------------------------------------------- modais
type TipoModal = 'vaga' | 'meta' | 'experiencia' | 'habilidade';
const modal = ref<{ tipo: TipoModal; item: any } | null>(null);
const vagaAberta = ref<any>(null);
const CAMPOS: Record<TipoModal, { titulo: string; rota: string; campos: Campo[]; padrao: Record<string, any> }> = {
  vaga: { titulo: 'vaga', rota: '/profissional/vagas', campos: CAMPOS_VAGA, padrao: { status: 'interesse' } },
  meta: {
    titulo: 'meta', rota: '/profissional/metas', padrao: { categoria: 'carreira', status: 'aberta', progresso: 0 },
    campos: [
      { k: 'titulo', r: 'Meta', obrig: true, ph: 'Ex.: virar desenvolvedor sênior' },
      { k: 'categoria', r: 'Categoria', t: 'sel', op: opcoes(CAT_META), meia: true },
      { k: 'prazo', r: 'Prazo', t: 'data', meia: true },
      { k: 'status', r: 'Situação', t: 'sel', op: opcoes(STATUS_META), meia: true },
      { k: 'progresso', r: 'Progresso (%)', t: 'num', min: 0, max: 100, passo: 5, meia: true },
      { k: 'descricao', r: 'Como vou chegar lá', t: 'area', linhas: 4 },
    ],
  },
  experiencia: {
    titulo: 'experiência', rota: '/profissional/experiencias', padrao: { vinculo: 'clt', tecnologias: [] },
    campos: [
      { k: 'cargo', r: 'Cargo', obrig: true, meia: true },
      { k: 'empresa', r: 'Empresa', obrig: true, meia: true },
      { k: 'vinculo', r: 'Vínculo', t: 'sel', op: opcoes(VINCULO), meia: true },
      { k: 'modalidade', r: 'Modalidade', t: 'sel', op: opcoes(MODALIDADE), vazio: '—', meia: true },
      { k: 'inicio', r: 'Entrada', t: 'data', obrig: true, meia: true },
      { k: 'fim', r: 'Saída', t: 'data', meia: true, dica: 'Em branco: emprego atual' },
      { k: 'local', r: 'Cidade' },
      { k: 'descricao', r: 'Responsabilidades', t: 'area', linhas: 4 },
      { k: 'conquistas', r: 'Conquistas (com números, se possível)', t: 'area', linhas: 4, ph: 'Ex.: reduzi o tempo de fechamento de 2h para 15min' },
      { k: 'tecnologias', r: 'Tecnologias', t: 'tags', ph: 'GeneXus, Vue, SQL Server' },
    ],
  },
  habilidade: {
    titulo: 'habilidade', rota: '/profissional/habilidades', padrao: { categoria: 'tecnica', nivel: 3 },
    campos: [
      { k: 'nome', r: 'Habilidade', obrig: true },
      { k: 'categoria', r: 'Categoria', t: 'sel', op: opcoes(CAT_HAB), meia: true },
      { k: 'nivel', r: 'Nível', t: 'sel', op: [1, 2, 3, 4, 5].map((v) => ({ v, r: `${v} · ${NIVEL[v]}` })), meia: true },
    ],
  },
};
const def = computed(() => (modal.value ? CAMPOS[modal.value.tipo] : null));

const ativas = computed(() => vagas.value.filter((v) => (COLUNAS_FUNIL as readonly string[]).includes(v.status)));
const encerradas = computed(() => vagas.value.filter((v) => !(COLUNAS_FUNIL as readonly string[]).includes(v.status)));
const faixa = (v: any) => v.salario_min_centavos || v.salario_max_centavos
  ? [v.salario_min_centavos, v.salario_max_centavos].filter(Boolean).map((c: number) => dinheiro(c)).join(' a ') : null;
const habsPorCat = computed(() => {
  const g: Record<string, any[]> = {};
  for (const h of cv.value?.habilidades ?? []) (g[h.categoria] ??= []).push(h);
  return g;
});
const periodo = (e: any) => `${mesAno(e.inicio)} – ${e.fim ? mesAno(e.fim) : 'atual'}`;
const mesAno = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('. de ', '/').replace(' de ', '/');
const duracao = (e: any) => {
  const fim = e.fim ?? new Date().toISOString().slice(0, 10);
  const m = (+fim.slice(0, 4) - +e.inicio.slice(0, 4)) * 12 + (+fim.slice(5, 7) - +e.inicio.slice(5, 7)) + 1;
  const a = Math.floor(m / 12), r = m % 12;
  return [a ? `${a} ano${a > 1 ? 's' : ''}` : '', r ? `${r} ${r > 1 ? 'meses' : 'mês'}` : ''].filter(Boolean).join(' e ');
};
const imprimir = () => window.print();
const botao = computed<[TipoModal, string] | null>(() =>
  aba.value === 'metas' ? ['meta', 'Nova meta'] : aba.value === 'curriculo' ? ['experiencia', 'Nova experiência'] : ['vaga', 'Nova vaga']);
</script>

<template>
  <div class="pagina modulo">
    <header class="cabecalho nao-imprime">
      <div>
        <h1>Profissional</h1>
        <p>Carreira, metas, vagas e currículo.</p>
      </div>
      <button v-if="botao" class="btn primario" @click="modal = { tipo: botao[0], item: null }">{{ botao[1] }}</button>
    </header>

    <Abas class="nao-imprime" :abas="[{ id: 'painel', r: 'Painel' }, { id: 'vagas', r: 'Vagas' }, { id: 'metas', r: 'Metas' }, { id: 'curriculo', r: 'Currículo' }]" />
    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <!-- ---------------------------------------------------------- painel -->
    <template v-if="aba === 'painel' && resumo">
      <div class="kpis">
        <div v-for="s in COLUNAS_FUNIL" :key="s"><span>{{ STATUS_VAGA[s] }}</span><b>{{ resumo.funil[s] ?? 0 }}</b></div>
      </div>
      <div class="duas">
        <section class="secao">
          <header><h2>Próximas entrevistas</h2></header>
          <ul v-if="resumo.proximas_entrevistas.length" class="lista painel">
            <li v-for="e in resumo.proximas_entrevistas" :key="e.id" class="clicavel" @click="vagaAberta = vagas.find((v) => v.id === e.vaga_id)">
              <span class="ico" style="--c: #475569">{{ e.empresa.slice(0, 1) }}</span>
              <div><div class="titulo">{{ e.empresa }} · {{ ETAPA[e.etapa as keyof typeof ETAPA] }}</div><div class="meta">{{ e.cargo }}</div></div>
              <div class="valor"><div>{{ dataCurta(e.data) }}</div><div class="meta">{{ e.hora?.slice(0, 5) ?? '' }}</div></div>
            </li>
          </ul>
          <div v-else class="vazio painel"><span>Nenhuma entrevista marcada.</span></div>
        </section>
        <section class="secao">
          <header><h2>Metas em aberto</h2></header>
          <ul v-if="resumo.metas.length" class="lista painel">
            <li v-for="m in resumo.metas" :key="m.id" class="clicavel" @click="modal = { tipo: 'meta', item: m }">
              <span class="ico" style="--c: #0f4b3a">{{ m.progresso }}%</span>
              <div>
                <div class="titulo">{{ m.titulo }}</div>
                <div class="medidor"><i :style="{ width: m.progresso + '%', background: 'var(--marca)' }" /></div>
              </div>
              <div class="valor meta">{{ m.prazo ? dataCurta(m.prazo) : '' }}</div>
            </li>
          </ul>
          <div v-else class="vazio painel"><span>Defina para onde quer ir na carreira.</span></div>
        </section>
      </div>
    </template>

    <!-- ----------------------------------------------------------- vagas -->
    <template v-else-if="aba === 'vagas'">
      <div class="funil">
        <section v-for="s in COLUNAS_FUNIL" :key="s" class="coluna">
          <header><b>{{ STATUS_VAGA[s] }}</b><span>{{ ativas.filter((v) => v.status === s).length }}</span></header>
          <article v-for="v in ativas.filter((x) => x.status === s)" :key="v.id" class="vaga painel" tabindex="0" @click="vagaAberta = v" @keydown.enter="vagaAberta = v">
            <b>{{ v.cargo }}</b>
            <span>{{ v.empresa }}</span>
            <small v-if="faixa(v)">{{ faixa(v) }}</small>
            <small v-if="v.proxima_entrevista" class="entrevista">📅 {{ ETAPA[v.proxima_entrevista.etapa as keyof typeof ETAPA] }} {{ dataCurta(v.proxima_entrevista.data) }}</small>
            <small v-else-if="v.aplicada_em" class="suave">aplicou há {{ -diasAte(v.aplicada_em) }} dias</small>
          </article>
        </section>
      </div>
      <section v-if="encerradas.length" class="secao">
        <header><h2>Encerradas</h2></header>
        <ul class="lista painel">
          <li v-for="v in encerradas" :key="v.id" class="clicavel" @click="vagaAberta = v">
            <span class="ico" style="--c: #475569">{{ v.empresa.slice(0, 1) }}</span>
            <div><div class="titulo">{{ v.cargo }}</div><div class="meta">{{ v.empresa }}</div></div>
            <div class="valor"><span :class="['selo', v.status === 'aceita' ? 'paga' : '']">{{ STATUS_VAGA[v.status as keyof typeof STATUS_VAGA] }}</span></div>
          </li>
        </ul>
      </section>
    </template>

    <!-- ----------------------------------------------------------- metas -->
    <template v-else-if="aba === 'metas'">
      <ul v-if="metas.length" class="lista painel">
        <li v-for="m in metas" :key="m.id" class="clicavel" @click="modal = { tipo: 'meta', item: m }">
          <span class="ico" :style="{ '--c': m.status === 'concluida' ? 'var(--entra)' : '#0f4b3a' }">{{ m.status === 'concluida' ? '✓' : m.progresso + '%' }}</span>
          <div>
            <div class="titulo">{{ m.titulo }}</div>
            <div class="meta">{{ [CAT_META[m.categoria as keyof typeof CAT_META], m.prazo ? `até ${dataCurta(m.prazo)}` : null].filter(Boolean).join(' · ') }}</div>
          </div>
          <div class="valor"><span :class="['selo', m.status === 'concluida' ? 'paga' : m.prazo && diasAte(m.prazo) < 0 && m.status !== 'abandonada' ? 'vencida' : '']">{{ STATUS_META[m.status as keyof typeof STATUS_META] }}</span></div>
        </li>
      </ul>
      <div v-else class="vazio painel"><b>Sem metas</b><span>Ex.: certificação, faixa salarial, cargo, mudar de área.</span></div>
    </template>

    <!-- ------------------------------------------------------- currículo -->
    <template v-else-if="aba === 'curriculo' && cv">
      <div class="acoes-topo nao-imprime">
        <button class="btn" @click="modal = { tipo: 'habilidade', item: null }">Nova habilidade</button>
        <button class="btn" @click="imprimir">Imprimir / salvar PDF</button>
      </div>
      <article class="cv painel">
        <header>
          <h2>{{ cv.perfil?.nome }}</h2>
          <p>{{ [cv.perfil?.cargo, cv.perfil?.email].filter(Boolean).join(' · ') }}</p>
        </header>

        <section>
          <h3>Experiência</h3>
          <div v-for="e in cv.experiencias" :key="e.id" class="exp" @click="modal = { tipo: 'experiencia', item: e }">
            <div class="linha-exp"><b>{{ e.cargo }}</b><span class="suave">{{ periodo(e) }} · {{ duracao(e) }}</span></div>
            <div class="suave">{{ [e.empresa, VINCULO[e.vinculo as keyof typeof VINCULO], e.modalidade ? MODALIDADE[e.modalidade as keyof typeof MODALIDADE] : null, e.local].filter(Boolean).join(' · ') }}</div>
            <p v-if="e.descricao">{{ e.descricao }}</p>
            <p v-if="e.conquistas" class="conq">{{ e.conquistas }}</p>
            <div v-if="e.tecnologias.length" class="techs"><span v-for="t in e.tecnologias" :key="t">{{ t }}</span></div>
          </div>
          <p v-if="!cv.experiencias.length" class="suave nao-imprime">Adicione suas experiências com “Nova experiência”.</p>
        </section>

        <section v-if="cv.formacao.length">
          <h3>Formação</h3>
          <div v-for="f in cv.formacao" :key="f.nome" class="linha-exp">
            <span><b>{{ f.nome }}</b><template v-if="f.instituicao"> · {{ f.instituicao }}</template></span>
            <span class="suave">{{ f.status === 'concluido' ? `concluído ${f.concluido_em ? f.concluido_em.slice(0, 4) : ''}` : `em andamento${f.fim_previsto ? ` · previsão ${f.fim_previsto.slice(0, 4)}` : ''}` }}</span>
          </div>
        </section>

        <section v-if="cv.habilidades.length">
          <h3>Habilidades</h3>
          <div v-for="(hs, cat) in habsPorCat" :key="cat" class="habs">
            <span class="cat suave">{{ CAT_HAB[cat as keyof typeof CAT_HAB] }}</span>
            <span>
              <button v-for="h in hs" :key="h.id" class="hab" :title="NIVEL[h.nivel]" @click="modal = { tipo: 'habilidade', item: h }">
                {{ h.nome }}<i>{{ '●'.repeat(h.nivel) }}</i>
              </button>
            </span>
          </div>
        </section>
      </article>
      <p class="suave miudo nao-imprime">Formação vem de Estudos (cursos em andamento ou concluídos). Clique em qualquer item para editar.</p>
    </template>

    <EntidadeModal v-if="modal && def" :titulo="(modal.item ? 'Editar ' : 'Nova ') + def.titulo" :rota="def.rota" :campos="def.campos"
      :item="modal.item" :padrao="def.padrao" @fechar="modal = null" />
    <VagaModal v-if="vagaAberta" :vaga="vagaAberta" @fechar="vagaAberta = null" @editar="modal = { tipo: 'vaga', item: vagaAberta }; vagaAberta = null" />
  </div>
</template>

<style scoped>
.duas { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 900px) { .duas { grid-template-columns: 1fr; } }
.secao > header h2 { font-size: 1rem; margin: 6px 0 0; }
.lista .medidor { margin-top: 6px; max-width: 240px; }
.funil { display: grid; grid-template-columns: repeat(4, minmax(220px, 1fr)); gap: 12px; overflow-x: auto; padding-bottom: 6px; }
@media (max-width: 760px) { .funil { grid-template-columns: repeat(4, 78vw); scroll-snap-type: x mandatory; } }
.coluna { background: var(--surface-2); border-radius: var(--raio-m); padding: 10px; display: grid; gap: 8px; align-content: start; min-height: 120px; scroll-snap-align: start; }
.coluna > header { display: flex; justify-content: space-between; padding: 2px 4px; }
.coluna > header span { color: var(--ink-3); font-size: 0.85rem; }
.vaga { display: grid; gap: 2px; padding: 10px 12px; cursor: pointer; }
.vaga:hover { box-shadow: var(--sombra-flutuante); }
.vaga span { color: var(--ink-2); font-size: 0.875rem; }
.vaga small { font-size: 0.78rem; color: var(--ink-3); }
.vaga .entrevista { color: var(--marca-tint-ink); font-weight: 650; }
.acoes-topo { display: flex; gap: 8px; flex-wrap: wrap; }

.cv { padding: 32px 36px; display: grid; gap: 24px; max-width: 860px; }
.cv header h2 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; }
.cv header p { margin: 4px 0 0; color: var(--ink-2); }
.cv h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--marca-tint-ink); margin: 0 0 10px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
.exp { padding: 8px 10px; margin: 0 -10px 6px; border-radius: var(--raio-s); cursor: pointer; }
.exp:hover { background: var(--surface-2); }
.exp p { margin: 6px 0 0; white-space: pre-wrap; font-size: 0.9rem; }
.exp .conq { color: var(--ink-2); }
.linha-exp { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.techs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.techs span { font-size: 0.75rem; padding: 2px 8px; border-radius: 6px; background: var(--surface-2); font-weight: 600; color: var(--ink-2); }
.habs { display: grid; grid-template-columns: 170px 1fr; gap: 10px; margin-bottom: 8px; align-items: baseline; }
@media (max-width: 600px) { .habs { grid-template-columns: 1fr; gap: 4px; } .cv { padding: 20px; } }
.cat { font-size: 0.85rem; }
.hab { border: 1px solid var(--line-2); background: var(--surface); border-radius: 999px; padding: 3px 10px; margin: 0 6px 6px 0; font: 600 0.82rem var(--fonte); color: var(--ink); cursor: pointer; }
.hab i { font-style: normal; color: var(--marca); font-size: 0.55rem; margin-left: 6px; letter-spacing: 1px; vertical-align: 2px; }

@media (pointer: coarse) {
  .hab { min-height: 36px; padding: 6px 12px; }
}
@media print {
  .nao-imprime { display: none !important; }
  .cv { border: 0; box-shadow: none; padding: 0; max-width: none; }
  .exp:hover { background: none; }
}
</style>

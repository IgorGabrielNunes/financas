<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../core/api';
import { avisar, avisarMudanca, versao } from '../../core/store';
import { dataCurta, diasAte, dinheiro, hoje, horas, num } from '../../core/format';
import Abas from '../../ui/Abas.vue';
import EntidadeModal from '../../ui/EntidadeModal.vue';
import Academia from './academia/Academia.vue';
import Dieta from './academia/Dieta.vue';
import { opcoes, type Campo } from '../../ui/campos';

const TIPO_CONSULTA = { consulta: 'Consulta', exame: 'Exame', vacina: 'Vacina', procedimento: 'Procedimento', terapia: 'Terapia', odonto: 'Dentista' };
const STATUS_CONSULTA = { agendada: 'Agendada', realizada: 'Realizada', cancelada: 'Cancelada' };
const TIPO_TREINO = { musculacao: 'Musculação', corrida: 'Corrida', caminhada: 'Caminhada', bike: 'Bike', natacao: 'Natação', funcional: 'Funcional', esporte: 'Esporte', alongamento: 'Alongamento', outro: 'Outro' };
const ICONE_TREINO: Record<string, string> = { musculacao: '🏋️', corrida: '🏃', caminhada: '🚶', bike: '🚴', natacao: '🏊', funcional: '🤸', esporte: '⚽', alongamento: '🧘', outro: '💪' };

const route = useRoute();
const router = useRouter();
const aba = computed(() => (route.query.aba as string) || 'hoje');

const resumo = ref<any>(null);
const treinoHoje = ref<any>(null);
const lista = ref<any[]>([]);
const erro = ref('');
const ROTA: Record<string, string> = { consultas: '/saude/consultas', remedios: '/saude/remedios', medidas: '/saude/medidas', treinos: '/saude/treinos' };

async function carregar() {
  erro.value = '';
  try {
    if (aba.value === 'academia' || aba.value === 'dieta') return; // as abas carregam sozinhas
    resumo.value = await api.get('/saude/resumo');
    lista.value = ROTA[aba.value] ? await api.get(ROTA[aba.value]) : [];
    if (aba.value === 'hoje') treinoHoje.value = await api.get('/academia/hoje').catch(() => null);
  } catch (e) { erro.value = (e as Error).message; }
}
onMounted(() => { carregar(); abrirDaUrl(); });
watch([aba, versao], carregar);
watch(() => route.query.novo, abrirDaUrl);
function abrirDaUrl() {
  const n = route.query.novo as string | undefined;
  if (n && n in CAMPOS) { modal.value = { tipo: n as TipoModal, item: null }; router.replace({ query: { ...route.query, novo: undefined } }); }
}

// --------------------------------------------------------------------- modais
type TipoModal = 'consulta' | 'remedio' | 'medida' | 'treino';
const modal = ref<{ tipo: TipoModal; item: any; padrao?: Record<string, any> } | null>(null);
const ultimaAltura = computed(() => lista.value.find((m) => m.altura_cm)?.altura_cm ?? null);

const CAMPOS: Record<TipoModal, { titulo: string; rota: string; campos: Campo[]; padrao: () => Record<string, any> }> = {
  consulta: {
    titulo: 'consulta ou exame', rota: '/saude/consultas', padrao: () => ({ tipo: 'consulta', status: 'agendada', data: hoje() }),
    campos: [
      { k: 'titulo', r: 'O quê', obrig: true, ph: 'Ex.: Cardiologista, Hemograma' },
      { k: 'tipo', r: 'Tipo', t: 'sel', op: opcoes(TIPO_CONSULTA), meia: true },
      { k: 'status', r: 'Situação', t: 'sel', op: opcoes(STATUS_CONSULTA), meia: true },
      { k: 'data', r: 'Data', t: 'data', obrig: true, meia: true },
      { k: 'hora', r: 'Hora', t: 'hora', meia: true },
      { k: 'profissional', r: 'Profissional', meia: true },
      { k: 'local', r: 'Local', meia: true },
      { k: 'valor_centavos', r: 'Valor pago', t: 'dinheiro', meia: true, dica: 'Deixe zero se foi pelo plano' },
      { k: 'retorno_em', r: 'Retorno até', t: 'data', meia: true, se: (m) => m.status === 'realizada' },
      { k: 'resultado', r: 'Resultado / orientações', t: 'area', linhas: 4, se: (m) => m.status === 'realizada' },
      { k: 'observacoes', r: 'Observações', t: 'area', linhas: 2 },
    ],
  },
  remedio: {
    titulo: 'remédio', rota: '/saude/remedios', padrao: () => ({ ativo: true, inicio: hoje(), horarios: [] }),
    campos: [
      { k: 'nome', r: 'Nome', obrig: true, meia: true },
      { k: 'dosagem', r: 'Dosagem', meia: true, ph: '1 comprimido, 10 gotas…' },
      { k: 'horarios', r: 'Horários', t: 'tags', ph: '08:00, 20:00', dica: 'Formato HH:MM, separados por vírgula. Vazio = só quando precisar.' },
      { k: 'inicio', r: 'Começa em', t: 'data', meia: true },
      { k: 'fim', r: 'Termina em', t: 'data', meia: true, dica: 'Em branco: uso contínuo' },
      { k: 'ativo', r: 'Em uso', t: 'bool' },
      { k: 'observacoes', r: 'Observações', t: 'area', linhas: 2 },
    ],
  },
  medida: {
    titulo: 'medida', rota: '/saude/medidas', padrao: () => ({ data: hoje(), altura_cm: ultimaAltura.value }),
    campos: [
      { k: 'data', r: 'Dia', t: 'data', obrig: true, meia: true },
      { k: 'peso_kg', r: 'Peso (kg)', t: 'num', min: 20, max: 400, passo: 0.1, meia: true },
      { k: 'altura_cm', r: 'Altura (cm)', t: 'num', min: 50, max: 250, passo: 1, meia: true, dica: 'Usada no IMC' },
      { k: 'cintura_cm', r: 'Cintura (cm)', t: 'num', min: 30, max: 250, passo: 0.5, meia: true },
      { k: 'gordura_pct', r: '% de gordura', t: 'num', min: 1, max: 70, passo: 0.1, meia: true },
      { k: 'observacoes', r: 'Observações', t: 'area', linhas: 2 },
    ],
  },
  treino: {
    titulo: 'treino', rota: '/saude/treinos', padrao: () => ({ data: hoje(), tipo: 'musculacao', duracao_min: 60 }),
    campos: [
      { k: 'tipo', r: 'Tipo', t: 'sel', op: opcoes(TIPO_TREINO), meia: true },
      { k: 'data', r: 'Dia', t: 'data', obrig: true, meia: true },
      { k: 'duracao_min', r: 'Duração (min)', t: 'num', min: 1, max: 1440, passo: 5, obrig: true, meia: true },
      { k: 'distancia_km', r: 'Distância (km)', t: 'num', min: 0.01, passo: 0.01, meia: true, se: (m) => ['corrida', 'caminhada', 'bike', 'natacao'].includes(m.tipo) },
      { k: 'intensidade', r: 'Intensidade', t: 'sel', op: [[1, 'Leve'], [2, 'Moderada'], [3, 'Puxada'], [4, 'Forte'], [5, 'Máxima']].map(([v, r]) => ({ v, r: String(r) })), vazio: '—', meia: true },
      { k: 'observacoes', r: 'Observações', t: 'area', linhas: 3, ph: 'Ex.: treino A, supino 4x10 60kg' },
    ],
  },
};
const def = computed(() => (modal.value ? CAMPOS[modal.value.tipo] : null));

// ---------------------------------------------------------------------- doses
async function alternarDose(d: any) {
  try {
    if (d.tomada) await api.del(`/saude/remedios/${d.remedio_id}/doses?horario=${d.horario}`);
    else await api.post(`/saude/remedios/${d.remedio_id}/doses`, { horario: d.horario });
    d.tomada = !d.tomada;
  } catch (e) { avisar((e as Error).message, 'erro'); }
}
const dosesPendentes = computed(() => resumo.value?.doses_hoje.filter((d: any) => !d.tomada).length ?? 0);

// ---------------------------------------------------------------- gráfico peso
const grafico = computed(() => {
  const h: { data: string; peso_kg: number }[] = resumo.value?.peso?.historico ?? [];
  if (h.length < 2) return null;
  const min = Math.min(...h.map((p) => p.peso_kg)) - 0.5, max = Math.max(...h.map((p) => p.peso_kg)) + 0.5;
  const W = 300, H = 80;
  const pts = h.map((p, i) => [(i / (h.length - 1)) * W, H - ((p.peso_kg - min) / (max - min)) * H]);
  return { W, H, d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '), ult: pts[pts.length - 1], min, max };
});
const minTreino = computed(() => (resumo.value?.treinos_semana ?? []).reduce((s: number, t: any) => s + t.minutos, 0));
const qtdTreino = computed(() => (resumo.value?.treinos_semana ?? []).reduce((s: number, t: any) => s + t.qtd, 0));
const quando = (d: string) => { const n = diasAte(d); return n === 0 ? 'hoje' : n === 1 ? 'amanhã' : n < 0 ? `há ${-n} dias` : `em ${n} dias`; };

const botaoNovo = computed<[TipoModal, string]>(() =>
  aba.value === 'remedios' ? ['remedio', 'Novo remédio'] : aba.value === 'medidas' ? ['medida', 'Registrar medida']
  : aba.value === 'treinos' ? ['treino', 'Registrar treino'] : ['consulta', 'Nova consulta']);
</script>

<template>
  <div class="pagina modulo">
    <header class="cabecalho">
      <div>
        <h1>Saúde</h1>
        <p>Treinos, dieta, consultas, remédios e peso.</p>
      </div>
      <button v-if="aba !== 'academia' && aba !== 'dieta'" class="btn primario" @click="modal = { tipo: botaoNovo[0], item: null }">{{ botaoNovo[1] }}</button>
    </header>

    <Abas :abas="[{ id: 'hoje', r: 'Hoje', n: dosesPendentes || undefined }, { id: 'academia', r: 'Academia' }, { id: 'dieta', r: 'Dieta' }, { id: 'consultas', r: 'Consultas e exames' }, { id: 'remedios', r: 'Remédios' }, { id: 'medidas', r: 'Peso e medidas' }, { id: 'treinos', r: 'Histórico de treinos' }]" />
    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <!-- ------------------------------------------------------------ hoje -->
    <template v-if="aba === 'hoje' && resumo">
      <div class="kpis bloco">
        <div class="clicavel" @click="modal = { tipo: 'medida', item: null }">
          <span>Peso</span>
          <b>{{ resumo.peso ? `${num(resumo.peso.atual)} kg` : '—' }}</b>
          <small v-if="resumo.peso?.variacao_30d !== null && resumo.peso">{{ resumo.peso.variacao_30d > 0 ? '+' : '' }}{{ num(resumo.peso.variacao_30d) }} kg em 30 dias</small>
          <small v-else>toque para registrar</small>
        </div>
        <div>
          <span>IMC</span><b>{{ resumo.peso?.imc ? num(resumo.peso.imc.valor) : '—' }}</b>
          <small>{{ resumo.peso?.imc?.faixa ?? 'informe a altura' }}</small>
        </div>
        <div class="clicavel" @click="modal = { tipo: 'treino', item: null }">
          <span>Treinos (7 dias)</span><b>{{ qtdTreino }}</b><small>{{ minTreino ? horas(minTreino) : 'nenhum ainda' }}</small>
        </div>
        <div><span>Próxima consulta</span><b class="menor">{{ resumo.proximas_consultas[0] ? quando(resumo.proximas_consultas[0].data) : '—' }}</b><small>{{ resumo.proximas_consultas[0]?.titulo ?? '' }}</small></div>
      </div>

      <div class="duas bloco">
        <section class="secao">
          <template v-if="treinoHoje && (treinoHoje.fixas.length || treinoHoje.rodizio)">
            <header><h2>Treino de hoje</h2></header>
            <ul class="lista painel">
              <li v-for="f in [...treinoHoje.fixas, ...(treinoHoje.rodizio && !treinoHoje.fixas.some((x: any) => x.id === treinoHoje.rodizio.id) ? [treinoHoje.rodizio] : [])]" :key="f.id"
                class="clicavel" @click="router.replace({ query: { aba: 'academia' } })">
                <span class="ico" :style="{ '--c': f.cor }">🏋️</span>
                <div><div class="titulo">{{ f.nome }}{{ f.foco ? ` · ${f.foco}` : '' }}</div><div class="meta">{{ f.exercicios.length }} exercícios{{ f.horario ? ` · ${f.horario}` : '' }}</div></div>
                <div class="valor"><span v-if="treinoHoje.feitos.some((x: any) => x.ficha_id === f.id)" class="selo paga">Feito</span><span v-else class="suave">›</span></div>
              </li>
            </ul>
          </template>
          <header><h2>Remédios de hoje</h2></header>
          <ul v-if="resumo.doses_hoje.length" class="lista painel">
            <li v-for="d in resumo.doses_hoje" :key="d.remedio_id + d.horario">
              <button class="dose" :aria-pressed="d.tomada" :aria-label="`${d.tomada ? 'Desmarcar' : 'Marcar'} ${d.nome} das ${d.horario}`" @click="alternarDose(d)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>
              </button>
              <div><div class="titulo" :class="{ riscado: d.tomada }">{{ d.nome }}</div><div class="meta">{{ d.dosagem ?? '' }}</div></div>
              <div class="valor">{{ d.horario }}</div>
            </li>
          </ul>
          <div v-else class="vazio painel"><span>Nenhum remédio com horário hoje.</span></div>

          <template v-if="grafico">
            <header><h2>Peso</h2></header>
            <div class="painel peso">
              <svg :viewBox="`-4 -6 ${grafico.W + 8} ${grafico.H + 12}`" preserveAspectRatio="none" role="img" :aria-label="`Evolução do peso, atual ${num(resumo.peso.atual)} kg`">
                <path :d="grafico.d" />
                <circle :cx="grafico.ult[0]" :cy="grafico.ult[1]" r="3.5" />
              </svg>
              <div class="eixo suave miudo"><span>{{ dataCurta(resumo.peso.historico[0].data) }}</span><span>{{ num(resumo.peso.atual) }} kg</span></div>
            </div>
          </template>
        </section>

        <section class="secao">
          <header><h2>Agenda</h2></header>
          <ul v-if="resumo.proximas_consultas.length || resumo.retornos.length" class="lista painel">
            <li v-for="c in resumo.proximas_consultas" :key="c.id" class="clicavel" @click="modal = { tipo: 'consulta', item: c }">
              <span class="ico" style="--c: #dc2626">{{ TIPO_CONSULTA[c.tipo as keyof typeof TIPO_CONSULTA].slice(0, 1) }}</span>
              <div><div class="titulo">{{ c.titulo }}</div><div class="meta">{{ [c.profissional, c.local].filter(Boolean).join(' · ') }}</div></div>
              <div class="valor"><div>{{ dataCurta(c.data) }}</div><div class="meta">{{ c.hora?.slice(0, 5) ?? quando(c.data) }}</div></div>
            </li>
            <li v-for="c in resumo.retornos" :key="'r' + c.id" class="clicavel"
              @click="modal = { tipo: 'consulta', item: null, padrao: { titulo: c.titulo, tipo: c.tipo, profissional: c.profissional, local: c.local, status: 'agendada', data: c.retorno_em } }">
              <span class="ico" style="--c: #b45309">↻</span>
              <div><div class="titulo">Marcar retorno: {{ c.titulo }}</div><div class="meta">até {{ dataCurta(c.retorno_em) }} · toque para agendar</div></div>
            </li>
          </ul>
          <div v-else class="vazio painel"><span>Nada agendado.</span></div>
        </section>
      </div>
    </template>

    <!-- ------------------------------------------------------- consultas -->
    <ul v-else-if="aba === 'consultas' && lista.length" class="lista painel bloco">
      <li v-for="c in lista" :key="c.id" class="clicavel" :class="{ apagado: c.status === 'cancelada' }" @click="modal = { tipo: 'consulta', item: c }">
        <span class="ico" style="--c: #dc2626">{{ TIPO_CONSULTA[c.tipo as keyof typeof TIPO_CONSULTA].slice(0, 1) }}</span>
        <div>
          <div class="titulo">{{ c.titulo }}</div>
          <div class="meta">{{ [TIPO_CONSULTA[c.tipo as keyof typeof TIPO_CONSULTA], c.profissional, c.valor_centavos ? dinheiro(c.valor_centavos) : null].filter(Boolean).join(' · ') }}</div>
        </div>
        <div class="valor">
          <div>{{ dataCurta(c.data) }}</div>
          <span :class="['selo', c.status === 'agendada' ? 'previsto' : c.status === 'realizada' ? 'paga' : '']">{{ STATUS_CONSULTA[c.status as keyof typeof STATUS_CONSULTA] }}</span>
        </div>
      </li>
    </ul>

    <!-- -------------------------------------------------------- remédios -->
    <ul v-else-if="aba === 'remedios' && lista.length" class="lista painel bloco">
      <li v-for="r in lista" :key="r.id" class="clicavel" :class="{ apagado: !r.ativo }" @click="modal = { tipo: 'remedio', item: r }">
        <span class="ico" style="--c: #0891b2">💊</span>
        <div>
          <div class="titulo">{{ r.nome }} <span v-if="r.dosagem" class="suave">· {{ r.dosagem }}</span></div>
          <div class="meta">{{ r.horarios.length ? r.horarios.join(', ') : 'quando precisar' }}{{ r.fim ? ` · até ${dataCurta(r.fim)}` : ' · contínuo' }}</div>
        </div>
        <div class="valor"><span :class="['selo', r.ativo ? 'paga' : '']">{{ r.ativo ? 'Em uso' : 'Parado' }}</span></div>
      </li>
    </ul>

    <!-- --------------------------------------------------------- medidas -->
    <ul v-else-if="aba === 'medidas' && lista.length" class="lista painel bloco">
      <li v-for="m in lista" :key="m.id" class="clicavel" @click="modal = { tipo: 'medida', item: m }">
        <span class="ico" style="--c: #4f46e5">⚖</span>
        <div>
          <div class="titulo">{{ dataCurta(m.data) }}</div>
          <div class="meta">{{ [m.cintura_cm ? `cintura ${num(m.cintura_cm)} cm` : null, m.gordura_pct ? `${num(m.gordura_pct)}% gordura` : null, m.observacoes].filter(Boolean).join(' · ') }}</div>
        </div>
        <div class="valor">{{ m.peso_kg ? `${num(m.peso_kg)} kg` : '—' }}</div>
      </li>
    </ul>

    <!-- --------------------------------------------------------- treinos -->
    <ul v-else-if="aba === 'treinos' && lista.length" class="lista painel bloco">
      <li v-for="t in lista" :key="t.id" class="clicavel" @click="modal = { tipo: 'treino', item: t }">
        <span class="ico" style="--c: #13805a">{{ ICONE_TREINO[t.tipo] }}</span>
        <div>
          <div class="titulo">{{ TIPO_TREINO[t.tipo as keyof typeof TIPO_TREINO] }}</div>
          <div class="meta">{{ [dataCurta(t.data), t.distancia_km ? `${num(t.distancia_km, 2)} km` : null, t.observacoes].filter(Boolean).join(' · ') }}</div>
        </div>
        <div class="valor">{{ horas(t.duracao_min) }}</div>
      </li>
    </ul>

    <Academia v-if="aba === 'academia'" />
    <Dieta v-else-if="aba === 'dieta'" />

    <div v-if="!['hoje', 'academia', 'dieta'].includes(aba) && !lista.length" class="vazio painel bloco">
      <span>Nada registrado ainda.</span>
      <button class="btn" @click="modal = { tipo: botaoNovo[0], item: null }">{{ botaoNovo[1] }}</button>
    </div>

    <EntidadeModal v-if="modal && def" :titulo="(modal.item ? 'Editar ' : 'Novo: ') + def.titulo" :rota="def.rota" :campos="def.campos"
      :item="modal.item" :padrao="modal.padrao ?? def.padrao()" @fechar="modal = null" />
  </div>
</template>

<style scoped>
.kpis .clicavel { cursor: pointer; }
.kpis .clicavel:hover { background: var(--surface-2); }
.kpis b.menor { font-size: 1.15rem; }
.duas { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 900px) { .duas { grid-template-columns: 1fr; } }
.secao > header h2 { font-size: 1rem; margin: 6px 0 0; }
.dose {
  width: 28px; height: 28px; border-radius: 50%; border: 2px solid #0891b2; background: var(--surface); cursor: pointer;
  display: grid; place-items: center; padding: 0; color: transparent;
}
.dose[aria-pressed='true'] { background: #0891b2; color: #fff; }
.dose svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.riscado { text-decoration: line-through; color: var(--ink-3); }
.apagado { opacity: 0.55; }
.peso { padding: 14px 16px 10px; }
.peso svg { width: 100%; height: 100px; display: block; overflow: visible; }
.peso path { fill: none; stroke: var(--marca); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.peso circle { fill: var(--marca); }
.eixo { display: flex; justify-content: space-between; margin-top: 6px; }
.dose { position: relative; }
.dose::after { content: ''; position: absolute; inset: -10px; } /* 24px internos + 2×10 = 44px */
</style>

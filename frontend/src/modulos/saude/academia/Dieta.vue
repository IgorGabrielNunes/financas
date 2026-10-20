<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../core/api';
import { avisar, avisarMudanca, versao } from '../../../core/store';
import EntidadeModal from '../../../ui/EntidadeModal.vue';
import { opcoes, type Campo } from '../../../ui/campos';

type Totais = { kcal: number | null; proteina_g: number | null; carbo_g: number | null; gordura_g: number | null };
type Item = { id: string; alimento: string; quantidade: string | null; kcal: number | null; proteina_g: string | null; carbo_g: string | null; gordura_g: string | null; substituicoes: string | null };
type Refeicao = { id: string; nome: string; horario: string | null; lembrar: boolean; observacoes: string | null; itens: Item[]; totais: Totais; feita: boolean };
type Plano = {
  id: string; nome: string; aplica_em: 'todos' | 'treino' | 'descanso'; ativo: boolean; kcal_meta: number | null; proteina_g: number | null;
  carbo_g: number | null; gordura_g: number | null; agua_ml: number | null; profissional: string | null; observacoes: string | null;
  refeicoes?: Refeicao[]; totais?: Totais;
};
type Hoje = { data: string; dia_de_treino: boolean; automatico: boolean; tem_planos_por_tipo: boolean; plano: (Plano & { refeicoes: Refeicao[]; totais: Totais }) | null };

const APLICA = { todos: 'Todos os dias', treino: 'Dias de treino', descanso: 'Dias de descanso' };
const visao = ref<'hoje' | 'planos'>('hoje');
const tipo = ref<'treino' | 'descanso' | null>(null); // null = automático
const hoje = ref<Hoje | null>(null);
const planos = ref<Plano[]>([]);
const aberto = ref<(Plano & { refeicoes: Refeicao[]; totais: Totais }) | null>(null);
const erro = ref('');

async function carregar() {
  try {
    [hoje.value, planos.value] = await Promise.all([
      api.get<Hoje>(`/dieta/hoje${tipo.value ? `?tipo=${tipo.value}` : ''}`), api.get<Plano[]>('/dieta/planos'),
    ]);
    if (aberto.value) aberto.value = await api.get(`/dieta/planos/${aberto.value.id}/completo`);
  } catch (e) { erro.value = (e as Error).message; }
}
onMounted(carregar);
watch([versao, tipo], carregar);

async function alternar(r: Refeicao) {
  try {
    if (r.feita) await api.del(`/dieta/refeicoes/${r.id}/feita`); else await api.post(`/dieta/refeicoes/${r.id}/feita`, {});
    r.feita = !r.feita;
  } catch (e) { avisar((e as Error).message, 'erro'); }
}
async function abrirPlano(p: Plano) { aberto.value = await api.get(`/dieta/planos/${p.id}/completo`); visao.value = 'planos'; }

const consumido = computed(() => {
  const rs = hoje.value?.plano?.refeicoes.filter((r) => r.feita) ?? [];
  return rs.reduce((s, r) => s + (r.totais.kcal ?? 0), 0);
});
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
const macros = (t: Partial<Totais>) => [t.proteina_g != null ? `P ${n(t.proteina_g)}g` : null, t.carbo_g != null ? `C ${n(t.carbo_g)}g` : null, t.gordura_g != null ? `G ${n(t.gordura_g)}g` : null].filter(Boolean).join(' · ');

// ------------------------------------------------------------------- modais
const camposPlano: Campo[] = [
  { k: 'nome', r: 'Nome', obrig: true, ph: 'Plano da nutricionista' },
  { k: 'aplica_em', r: 'Vale em', t: 'sel', op: opcoes(APLICA), meia: true, dica: 'Planos diferentes para dia de treino e descanso' },
  { k: 'ativo', r: 'Em uso', t: 'bool', meia: true },
  { k: 'kcal_meta', r: 'Meta de calorias (kcal)', t: 'num', min: 500, max: 10000, passo: 10, meia: true },
  { k: 'agua_ml', r: 'Água (ml)', t: 'num', min: 0, max: 10000, passo: 100, meia: true },
  { k: 'proteina_g', r: 'Proteína (g)', t: 'num', min: 0, passo: 1, meia: true },
  { k: 'carbo_g', r: 'Carboidrato (g)', t: 'num', min: 0, passo: 1, meia: true },
  { k: 'gordura_g', r: 'Gordura (g)', t: 'num', min: 0, passo: 1, meia: true },
  { k: 'profissional', r: 'Quem passou', meia: true, ph: 'Nutricionista' },
  { k: 'observacoes', r: 'Orientações gerais', t: 'area', linhas: 3 },
];
const camposRefeicao: Campo[] = [
  { k: 'nome', r: 'Refeição', obrig: true, meia: true, ph: 'Café da manhã' },
  { k: 'horario', r: 'Horário', t: 'hora', meia: true },
  { k: 'lembrar', r: 'Avisar no horário', t: 'bool', dica: 'Mensagem no WhatsApp/Telegram (ative "refeições" em Avisos)' },
  { k: 'observacoes', r: 'Observações', t: 'area', linhas: 2 },
];
const camposItem: Campo[] = [
  { k: 'alimento', r: 'Alimento', obrig: true, meia: true, ph: 'Ovo mexido' },
  { k: 'quantidade', r: 'Quantidade', meia: true, ph: '2 unidades, 100 g' },
  { k: 'kcal', r: 'kcal', t: 'num', min: 0, passo: 1, meia: true },
  { k: 'proteina_g', r: 'Proteína (g)', t: 'num', min: 0, passo: 0.1, meia: true },
  { k: 'carbo_g', r: 'Carboidrato (g)', t: 'num', min: 0, passo: 0.1, meia: true },
  { k: 'gordura_g', r: 'Gordura (g)', t: 'num', min: 0, passo: 0.1, meia: true },
  { k: 'substituicoes', r: 'Pode trocar por', ph: 'ou 1 iogurte natural' },
];
const mPlano = ref<{ item: Plano | null } | null>(null);
const mRef = ref<{ item: Refeicao | null } | null>(null);
const mItem = ref<{ item: Item | null; refeicao: Refeicao } | null>(null);
function planoSalvo(linha: any) { if (linha?.id && !mPlano.value?.item) abrirPlano(linha); }
</script>

<template>
  <div class="dieta">
    <p v-if="erro" class="erro-form">{{ erro }}</p>
    <div class="topo">
      <div class="segmentado" role="tablist">
        <button :aria-pressed="visao === 'hoje'" @click="visao = 'hoje'">Hoje</button>
        <button :aria-pressed="visao === 'planos'" @click="visao = 'planos'; aberto = null">Planos</button>
      </div>
      <button class="btn" @click="mPlano = { item: null }">Novo plano</button>
    </div>
    <p class="suave miudo">Cadastre o plano passado pelo seu nutricionista. O Vida organiza e lembra; não monta dieta.</p>

    <!-- --------------------------------------------------------------- hoje -->
    <template v-if="visao === 'hoje' && hoje">
      <div v-if="hoje.tem_planos_por_tipo" class="tipo-dia">
        <span class="suave">Hoje é</span>
        <div class="segmentado">
          <button :aria-pressed="hoje.dia_de_treino" @click="tipo = 'treino'">Dia de treino</button>
          <button :aria-pressed="!hoje.dia_de_treino" @click="tipo = 'descanso'">Descanso</button>
        </div>
        <button v-if="tipo" class="btn-link" @click="tipo = null">automático</button>
      </div>

      <template v-if="hoje.plano">
        <div class="kpis">
          <div><span>Plano</span><b class="menor">{{ hoje.plano.nome }}</b><small>{{ APLICA[hoje.plano.aplica_em] }}</small></div>
          <div><span>Meta</span><b>{{ hoje.plano.kcal_meta ? `${n(hoje.plano.kcal_meta)} kcal` : '—' }}</b><small>{{ macros(hoje.plano) || 'sem metas de macros' }}</small></div>
          <div><span>No plano</span><b>{{ hoje.plano.totais.kcal != null ? `${n(hoje.plano.totais.kcal)} kcal` : '—' }}</b><small>{{ macros(hoje.plano.totais) || 'informe kcal nos alimentos' }}</small></div>
          <div><span>Feito hoje</span><b>{{ hoje.plano.refeicoes.filter((r) => r.feita).length }}/{{ hoje.plano.refeicoes.length }}</b><small>{{ consumido ? `${n(consumido)} kcal` : 'refeições' }}</small></div>
        </div>
        <p v-if="hoje.plano.agua_ml" class="agua">💧 Meta de água: {{ n(hoje.plano.agua_ml! / 1000) }} L</p>
        <ul class="refeicoes">
          <li v-for="r in hoje.plano.refeicoes" :key="r.id" :class="['painel', { feita: r.feita }]">
            <button class="check" :aria-pressed="r.feita" :aria-label="`${r.feita ? 'Desmarcar' : 'Marcar'} ${r.nome}`" @click="alternar(r)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>
            </button>
            <div class="corpo">
              <div class="cab"><b>{{ r.nome }}</b><span class="suave">{{ r.horario ?? '' }}</span></div>
              <ul v-if="r.itens.length" class="itens">
                <li v-for="i in r.itens" :key="i.id">
                  <span>{{ i.alimento }}<span v-if="i.quantidade" class="suave"> · {{ i.quantidade }}</span></span>
                  <span v-if="i.substituicoes" class="troca">ou {{ i.substituicoes.replace(/^ou\s+/i, '') }}</span>
                </li>
              </ul>
              <div v-if="r.totais.kcal != null || macros(r.totais)" class="meta">{{ [r.totais.kcal != null ? `${n(r.totais.kcal)} kcal` : null, macros(r.totais)].filter(Boolean).join(' · ') }}</div>
            </div>
          </li>
        </ul>
        <p v-if="hoje.plano.observacoes" class="obs painel">{{ hoje.plano.observacoes }}</p>
      </template>
      <div v-else class="vazio painel">
        <b>Sem plano para hoje</b>
        <span>{{ planos.length ? 'Nenhum plano ativo vale para este tipo de dia.' : 'Cadastre o plano alimentar com as refeições e os alimentos.' }}</span>
        <button class="btn primario" @click="mPlano = { item: null }">Cadastrar plano</button>
      </div>
    </template>

    <!-- ------------------------------------------------------------- planos -->
    <template v-else-if="visao === 'planos'">
      <ul v-if="!aberto && planos.length" class="lista painel">
        <li v-for="p in planos" :key="p.id" class="clicavel" :class="{ inativo: !p.ativo }" @click="abrirPlano(p)">
          <span class="ico" style="--c: #13805a">🍽</span>
          <div><div class="titulo">{{ p.nome }}</div><div class="meta">{{ APLICA[p.aplica_em] }}{{ p.kcal_meta ? ` · ${n(p.kcal_meta)} kcal` : '' }}{{ p.profissional ? ` · ${p.profissional}` : '' }}</div></div>
          <div class="valor"><span :class="['selo', p.ativo ? 'paga' : '']">{{ p.ativo ? 'Em uso' : 'Pausado' }}</span></div>
        </li>
      </ul>
      <div v-else-if="!aberto" class="vazio painel"><span>Nenhum plano ainda.</span></div>

      <template v-if="aberto">
        <div class="plano-topo">
          <button class="btn-link voltar" @click="aberto = null">← Planos</button>
          <div class="botoes">
            <button class="btn" @click="mPlano = { item: aberto }">Editar plano</button>
            <button class="btn primario" @click="mRef = { item: null }">Nova refeição</button>
          </div>
        </div>
        <h3 class="nome-plano">{{ aberto.nome }} <span class="suave">· {{ APLICA[aberto.aplica_em] }}</span></h3>
        <p class="suave miudo">Total do plano: {{ aberto.totais.kcal != null ? `${n(aberto.totais.kcal)} kcal` : '—' }}{{ aberto.kcal_meta ? ` de ${n(aberto.kcal_meta)} kcal` : '' }}{{ macros(aberto.totais) ? ` · ${macros(aberto.totais)}` : '' }}</p>
        <article v-for="r in aberto.refeicoes" :key="r.id" class="painel refeicao">
          <header class="clicavel" @click="mRef = { item: r }">
            <div><b>{{ r.nome }}</b><span class="suave">{{ r.horario ? ` · ${r.horario}` : '' }}{{ r.lembrar ? ' · 🔔' : '' }}</span></div>
            <span class="suave miudo">{{ r.totais.kcal != null ? `${n(r.totais.kcal)} kcal` : '' }}</span>
          </header>
          <ul class="lista">
            <li v-for="i in r.itens" :key="i.id" class="clicavel" @click="mItem = { item: i, refeicao: r }">
              <div><div class="titulo">{{ i.alimento }}</div><div class="meta">{{ [i.quantidade, i.substituicoes ? `troca: ${i.substituicoes}` : null].filter(Boolean).join(' · ') }}</div></div>
              <div class="valor meta">{{ i.kcal != null ? `${i.kcal} kcal` : '' }}</div>
            </li>
          </ul>
          <button class="btn-link" @click="mItem = { item: null, refeicao: r }">+ alimento</button>
        </article>
        <div v-if="!aberto.refeicoes.length" class="vazio painel"><span>Adicione as refeições do plano (café, almoço, lanche…).</span></div>
      </template>
    </template>

    <EntidadeModal v-if="mPlano" :titulo="mPlano.item ? 'Editar plano' : 'Novo plano'" rota="/dieta/planos" :campos="camposPlano" :item="mPlano.item"
      :padrao="{ aplica_em: 'todos', ativo: true }" confirmar-exclusao="Excluir o plano com todas as refeições?"
      @salvo="planoSalvo" @excluido="aberto = null" @fechar="mPlano = null" />
    <EntidadeModal v-if="mRef && aberto" :titulo="mRef.item ? 'Editar refeição' : 'Nova refeição'" rota="/dieta/refeicoes" :campos="camposRefeicao"
      :item="mRef.item" :padrao="{ lembrar: false }" :fixos="{ plano_id: aberto.id }" confirmar-exclusao="Excluir a refeição e os alimentos dela?" @fechar="mRef = null" />
    <EntidadeModal v-if="mItem" :titulo="mItem.item ? 'Editar alimento' : `Alimento · ${mItem.refeicao.nome}`" rota="/dieta/itens" :campos="camposItem"
      :item="mItem.item" :fixos="{ refeicao_id: mItem.refeicao.id }" confirmar-exclusao="Remover este alimento?" @fechar="mItem = null" />
  </div>
</template>

<style scoped>
.dieta { display: grid; gap: 16px; }
.topo { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dieta > .suave.miudo { margin: -8px 0 0; }
.tipo-dia { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.tipo-dia .segmentado button { white-space: nowrap; }
.kpis b.menor { font-size: 1.05rem; }
.agua { margin: 0; color: var(--ink-2); }
.refeicoes { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.refeicoes > li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; padding: 14px 16px; align-items: start; }
.refeicoes > li.feita .cab b { text-decoration: line-through; color: var(--ink-3); }
.cab { display: flex; justify-content: space-between; gap: 12px; }
.itens { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 3px; font-size: 0.9rem; }
.itens li { display: grid; }
.troca { font-size: 0.78rem; color: var(--ink-3); }
.meta { color: var(--ink-3); font-size: 0.8125rem; margin-top: 6px; }
.check {
  width: 28px; height: 28px; margin-top: 2px; border-radius: 50%; border: 2px solid #13805a; background: var(--surface); cursor: pointer;
  display: grid; place-items: center; padding: 0; color: transparent; position: relative;
}
.check::after { content: ''; position: absolute; inset: -10px; }
.check[aria-pressed='true'] { background: #13805a; color: #fff; }
.check svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.obs { padding: 14px 16px; margin: 0; white-space: pre-wrap; font-size: 0.9rem; }
.plano-topo { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.botoes { display: flex; gap: 8px; flex-wrap: wrap; }
.nome-plano { margin: 0; font-size: 1.15rem; }
.refeicao { padding: 0; overflow: hidden; }
.refeicao > header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); cursor: pointer; }
.refeicao > header:hover { background: var(--surface-2); }
.btn-link { border: 0; background: none; color: var(--marca-tint-ink); font: 600 0.875rem var(--fonte); padding: 10px 16px 12px; cursor: pointer; }
.voltar { padding-left: 0; }
.inativo { opacity: 0.6; }
@media (pointer: coarse) { .btn-link { min-height: 44px; } }
</style>

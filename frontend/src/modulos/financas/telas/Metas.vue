<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../../../core/api';
import { versao } from '../../../core/store';
import { dataBR, dinheiro } from '../../../core/format';
import MetaForm from '../componentes/MetaForm.vue';
import MetaMovForm from '../componentes/MetaMovForm.vue';
import MetaDetalhe from '../componentes/MetaDetalhe.vue';
import VincularInvestimento from '../componentes/VincularInvestimento.vue';
import { TIPOS_META, type Meta } from '../investir';

const metas = ref<Meta[]>([]);
const erro = ref('');
watch(versao, async () => {
  try { metas.value = await api.get<Meta[]>('/metas'); } catch (e) { erro.value = (e as Error).message; }
}, { immediate: true });

const ativas = computed(() => metas.value.filter((m) => !m.arquivada && !m.concluida));
const concluidas = computed(() => metas.value.filter((m) => !m.arquivada && m.concluida));
const arquivadas = computed(() => metas.value.filter((m) => m.arquivada));
const total = computed(() => ({
  guardado: ativas.value.reduce((s, m) => s + m.guardado_centavos, 0),
  alvo: ativas.value.reduce((s, m) => s + m.valor_alvo_centavos, 0),
  mensal: ativas.value.reduce((s, m) => s + (m.mensal_com_rendimento_centavos ?? m.mensal_necessario_centavos ?? 0), 0),
}));

const form = ref<{ aberto: boolean; meta: Meta | null }>({ aberto: false, meta: null });
const mov = ref<{ meta: Meta; tipo: 'guardar' | 'retirar' } | null>(null);
const detalhe = ref<string | null>(null);
const investir = ref<Meta | null>(null);
function acao(tipo: 'guardar' | 'retirar' | 'editar' | 'investir', meta: Meta) {
  if (tipo === 'editar') { detalhe.value = null; form.value = { aberto: true, meta }; }
  else if (tipo === 'investir') { detalhe.value = null; investir.value = meta; }
  else mov.value = { meta, tipo };
}
// anel de progresso: circunferência de r=26
const C = 2 * Math.PI * 26;
</script>

<template>
  <div class="pagina">
    <header class="cabecalho">
      <div>
        <h1>Metas</h1>
        <p v-if="ativas.length">
          {{ dinheiro(total.guardado) }} guardados de {{ dinheiro(total.alvo) }}.
          <template v-if="total.mensal">Para chegar no prazo: cerca de {{ dinheiro(total.mensal) }} por mês somando tudo.</template>
        </p>
        <p v-else>Viagem, reserva, cofrinho com o nome que quiser. O que você guarda sai do disponível e não vira gasto.</p>
      </div>
      <button class="btn primario" @click="form = { aberto: true, meta: null }">Nova meta</button>
    </header>

    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <div v-if="!metas.length" class="painel vazio">
      <h2>Qual é o próximo objetivo?</h2>
      <p>Crie uma meta com o valor e a data. O Vida mostra quanto guardar por mês e, se você ligar um investimento, já conta o rendimento.</p>
      <button class="btn primario" @click="form = { aberto: true, meta: null }">Nova meta</button>
    </div>

    <div class="cartelas">
      <article v-for="m in [...ativas, ...concluidas]" :key="m.id" class="painel meta" :style="{ '--c': m.cor }">
        <button class="abrir" type="button" :aria-label="`Ver meta ${m.nome}`" @click="detalhe = m.id" />
        <div class="topo">
          <div class="anel" role="img" :aria-label="`${m.pct}% guardado`">
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="26" class="fundo" />
              <circle cx="32" cy="32" r="26" class="feito" :stroke-dasharray="`${(m.pct / 100) * C} ${C}`" />
            </svg>
            <span>{{ m.icone ?? TIPOS_META[m.tipo]?.icone }}</span>
          </div>
          <div class="txt">
            <h3>{{ m.nome }}</h3>
            <p class="sub">{{ TIPOS_META[m.tipo]?.nome }}<template v-if="m.usuario_nome"> · {{ m.usuario_nome }}</template><template v-if="m.data_alvo"> · até {{ dataBR(m.data_alvo) }}</template></p>
          </div>
        </div>
        <p class="valores">
          <b>{{ dinheiro(m.guardado_centavos) }}</b>
          <span>de {{ dinheiro(m.valor_alvo_centavos) }} · {{ m.pct.toLocaleString('pt-BR') }}%</span>
        </p>
        <p v-if="m.concluida" class="dica feito-txt">Meta atingida 🎉</p>
        <p v-else-if="m.meses_restantes === 0" class="dica sai">O prazo passou e faltam {{ dinheiro(m.falta_centavos) }}.</p>
        <p v-else-if="m.mensal_necessario_centavos" class="dica">
          Guarde <b>{{ dinheiro(m.mensal_com_rendimento_centavos ?? m.mensal_necessario_centavos) }}/mês</b> por {{ m.meses_restantes }} {{ m.meses_restantes === 1 ? 'mês' : 'meses' }}
          <template v-if="m.mensal_com_rendimento_centavos !== null && m.mensal_com_rendimento_centavos < m.mensal_necessario_centavos">
            (o rendimento ajuda: sem ele seriam {{ dinheiro(m.mensal_necessario_centavos) }})
          </template>
        </p>
        <p v-else class="dica">Faltam {{ dinheiro(m.falta_centavos) }}. Defina uma data para ver quanto guardar por mês.</p>
        <p v-if="m.em_investimentos_centavos" class="miudo suave">{{ dinheiro(m.em_investimentos_centavos) }} em {{ m.investimentos.map((i) => i.nome).join(', ') }}</p>
        <div class="acoes-meta">
          <button class="btn" type="button" @click="mov = { meta: m, tipo: 'guardar' }">Guardar</button>
          <button class="btn link" type="button" :disabled="m.guardado_manual_centavos <= 0" @click="mov = { meta: m, tipo: 'retirar' }">Retirar</button>
        </div>
      </article>
    </div>

    <details v-if="arquivadas.length" class="painel arquivadas">
      <summary>Arquivadas ({{ arquivadas.length }})</summary>
      <ul class="lista">
        <li v-for="m in arquivadas" :key="m.id" class="clicavel" @click="detalhe = m.id">
          <span class="ico" :style="{ '--c': m.cor }">{{ m.icone ?? '🎯' }}</span>
          <div><div class="titulo">{{ m.nome }}</div><div class="meta">{{ m.pct.toLocaleString('pt-BR') }}% de {{ dinheiro(m.valor_alvo_centavos) }}</div></div>
          <div class="valor">{{ dinheiro(m.guardado_centavos) }}</div>
        </li>
      </ul>
    </details>

    <MetaForm v-if="form.aberto" :meta="form.meta" @fechar="form.aberto = false" />
    <MetaMovForm v-if="mov" :meta="mov.meta" :tipo="mov.tipo" @fechar="mov = null" />
    <MetaDetalhe v-if="detalhe" :id="detalhe" @fechar="detalhe = null" @acao="acao" />
    <VincularInvestimento v-if="investir" :meta="investir" @fechar="investir = null" />
  </div>
</template>

<style scoped>
.cartelas { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); align-items: start; }
.meta { --c: var(--marca); padding: 18px; display: grid; gap: 10px; position: relative; border-top: 4px solid var(--c); }
.meta:hover { border-color: var(--ink-3); border-top-color: var(--c); }
.abrir { position: absolute; inset: 0; border: 0; background: transparent; border-radius: inherit; cursor: pointer; }
.topo { display: flex; gap: 14px; align-items: center; min-width: 0; }
.txt { min-width: 0; }
.txt h3 { font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { color: var(--ink-3); font-size: 0.8125rem; }
.anel { position: relative; width: 60px; height: 60px; flex: none; }
.anel svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.anel circle { fill: none; stroke-width: 6; }
.anel .fundo { stroke: var(--surface-3); }
.anel .feito { stroke: var(--c); stroke-linecap: round; }
.anel span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 1.4rem; }
.valores { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.valores b { font-size: 1.35rem; letter-spacing: -0.02em; }
.valores span { color: var(--ink-2); font-size: 0.875rem; }
.dica { font-size: 0.875rem; color: var(--ink-2); }
.feito-txt { color: var(--entra); font-weight: 600; }
.acoes-meta { display: flex; gap: 8px; position: relative; z-index: 1; }
.acoes-meta .btn { min-height: 40px; }
.arquivadas summary { padding: 14px 18px; cursor: pointer; font-weight: 600; }
</style>

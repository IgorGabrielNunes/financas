<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../../core/api';
import { avisarMudanca, versao } from '../../../core/store';
import { dataBR, dataCurta, dinheiro, mesAno, pct } from '../../../core/format';
import Modal from '../../../ui/Modal.vue';
import GraficoLinhas from '../../../ui/GraficoLinhas.vue';
import { rotuloModelo, taxa2, TIPOS_INVEST, type InvestimentoDetalhe } from '../investir';

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ fechar: []; acao: [tipo: 'aporte' | 'resgate' | 'saldo' | 'editar', inv: InvestimentoDetalhe] }>();
const router = useRouter();
const d = ref<InvestimentoDetalhe | null>(null);
const erro = ref('');
watch(versao, async () => {
  try { d.value = await api.get<InvestimentoDetalhe>(`/investimentos/${props.id}`); } catch (e) { erro.value = (e as Error).message; }
}, { immediate: true });

const p = computed(() => d.value?.posicao);
const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const grafico = computed(() => {
  const ev = d.value?.evolucao ?? [];
  return {
    rotulos: ev.map((e, k) => (k === ev.length - 1 ? 'hoje' : mesAno(e.data))),
    series: [
      { nome: 'Saldo', cor: 'var(--entra)', valores: ev.map((e) => e.saldo_centavos) },
      { nome: 'Seu dinheiro aplicado', cor: 'var(--ink-3)', valores: ev.map((e) => e.investido_centavos), tracejada: true },
    ],
  };
});

async function apagarMov(id: string) {
  if (!confirm('Apagar este movimento? O efeito no saldo da conta é desfeito.')) return;
  try { await api.del(`/investimentos/${props.id}/movimentos/${id}`); avisarMudanca(); } catch (e) { erro.value = (e as Error).message; }
}
async function apagarSaldo(id: string) {
  if (!confirm('Apagar este saldo informado?')) return;
  try { await api.del(`/investimentos/${props.id}/saldos/${id}`); avisarMudanca(); } catch (e) { erro.value = (e as Error).message; }
}
function simular() {
  emit('fechar');
  router.push({ path: '/financas/investimentos', query: { aba: 'simulador', atual: props.id } });
}
</script>

<template>
  <Modal :titulo="d?.nome ?? 'Investimento'" largo @fechar="emit('fechar')">
    <p v-if="erro" class="erro-form">{{ erro }}</p>
    <div v-if="d && p" class="det">
      <p class="sub">
        {{ TIPOS_INVEST[d.tipo]?.nome }} · {{ rotuloModelo(d) }} · em {{ d.conta_nome ?? 'conta não informada' }}
        <template v-if="d.vencimento"> · vence {{ dataBR(d.vencimento) }}</template>
        <template v-if="d.meta_nome"> · meta {{ d.meta_nome }}</template>
      </p>

      <div class="kpis">
        <div><span>Saldo hoje</span><b>{{ dinheiro(p.saldo_bruto_centavos) }}</b>
          <small>{{ p.origem === 'informado' ? `pelo saldo de ${dataCurta(p.saldo_informado!.data)} + estimativa` : 'estimado pelo modelo' }}</small></div>
        <div><span>Rendeu até agora</span><b class="entra">+ {{ dinheiro(p.rendimento_bruto_centavos) }}</b>
          <small>{{ pct(p.rentabilidade_pct) }} sobre {{ dinheiro(p.investido_centavos) }}</small></div>
        <div><span>Se resgatar hoje</span><b>{{ dinheiro(p.saldo_liquido_centavos) }}</b>
          <small v-if="p.ir_estimado">− {{ dinheiro(p.ir_centavos) }} IR<template v-if="p.iof_centavos"> − {{ dinheiro(p.iof_centavos) }} IOF</template></small>
          <small v-else>IR de renda variável não estimado</small></div>
        <div><span>Rende por mês (agora)</span><b>{{ dinheiro(p.rendimento_mes_centavos) }}</b>
          <small v-if="d.indexador !== 'nenhum'">{{ taxa2(p.taxa_aa_pct) }} a.a. bruto · {{ taxa2(p.taxa_liquida_aa_pct) }} líquido</small></div>
      </div>

      <div class="botoes">
        <button class="btn primario" @click="emit('acao', 'aporte', d)">Aplicar mais</button>
        <button class="btn" @click="emit('acao', 'resgate', d)">Resgatar</button>
        <button class="btn" @click="emit('acao', 'saldo', d)">Informar saldo</button>
        <button class="btn" @click="simular">Comparar com outras opções</button>
        <button class="btn link" @click="emit('acao', 'editar', d)">Editar</button>
      </div>

      <section v-if="d.evolucao.length > 1" class="painel bloco">
        <h3>Evolução</h3>
        <GraficoLinhas :series="grafico.series" :rotulos="grafico.rotulos" :formatar="reais" :altura="200" />
      </section>

      <div class="grade-2">
        <section class="bloco">
          <h3>Aportes e resgates</h3>
          <ul v-if="d.movimentos.length" class="lista painel">
            <li v-for="m in d.movimentos" :key="m.id">
              <div>
                <div class="titulo">{{ m.tipo === 'aporte' ? 'Aporte' : 'Resgate' }}</div>
                <div class="meta">{{ dataBR(m.data) }} · {{ m.conta_nome ? (m.tipo === 'aporte' ? `saiu de ${m.conta_nome}` : `voltou para ${m.conta_nome}`) : (m.observacao ?? 'sem mexer em conta') }}</div>
              </div>
              <div :class="['valor', m.tipo === 'aporte' ? 'entra' : 'sai']">{{ m.tipo === 'aporte' ? '+' : '−' }} {{ dinheiro(m.valor_centavos) }}</div>
              <button class="x" :aria-label="`Apagar ${m.tipo} de ${dataBR(m.data)}`" @click="apagarMov(m.id)">×</button>
            </li>
          </ul>
          <p v-else class="painel vazio miudo">Nenhum movimento.</p>
        </section>
        <section class="bloco">
          <h3>Saldos informados</h3>
          <ul v-if="d.saldos.length" class="lista painel">
            <li v-for="s in d.saldos" :key="s.id">
              <div><div class="titulo">{{ dataBR(s.data) }}</div></div>
              <div class="valor">{{ dinheiro(s.valor_centavos) }}</div>
              <button class="x" :aria-label="`Apagar saldo de ${dataBR(s.data)}`" @click="apagarSaldo(s.id)">×</button>
            </li>
          </ul>
          <p v-else class="painel vazio miudo">Sem saldo informado: tudo é estimativa. Informe o que o app do banco mostra para ver o rendimento real.</p>
        </section>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.det { display: grid; gap: 18px; min-width: 0; }
.sub { color: var(--ink-2); font-size: 0.9rem; margin-top: -6px; }
.botoes { display: flex; flex-wrap: wrap; gap: 8px; }
.bloco { display: grid; gap: 10px; min-width: 0; }
.painel.bloco { padding: 16px; }
h3 { font-size: 0.95rem; }
.entra { color: var(--entra); }
.sai { color: var(--sai); }
.lista li { grid-template-columns: minmax(0, 1fr) auto auto; }
.x { width: 32px; height: 32px; border: 0; background: transparent; color: var(--ink-3); font-size: 1.3rem; border-radius: 8px; cursor: pointer; position: relative; }
.x:hover { background: var(--surface-2); color: var(--sai); }
@media (pointer: coarse) { .x::after { content: ''; position: absolute; inset: -6px; } }
</style>

<script setup lang="ts">
// Aporte, resgate ou saldo informado de um investimento.
import { computed, reactive, ref } from 'vue';
import { api } from '../../../core/api';
import { avisar, avisarMudanca, cadastros } from '../../../core/store';
import { dinheiro, hoje } from '../../../core/format';
import Modal from '../../../ui/Modal.vue';
import MoneyInput from '../../../ui/MoneyInput.vue';
import type { Investimento } from '../investir';

const props = defineProps<{ investimento: Investimento; tipo: 'aporte' | 'resgate' | 'saldo' }>();
const emit = defineEmits<{ fechar: [] }>();
const inv = props.investimento;
const contas = computed(() => cadastros.contas.filter((c) => c.ativa));
const f = reactive({
  valor_centavos: props.tipo === 'saldo' ? inv.posicao.saldo_bruto_centavos : 0,
  data: hoje(),
  conta_id: (props.tipo === 'saldo' ? null : inv.conta_id) as string | null,
  observacao: '',
});
const erro = ref('');
const titulo = { aporte: 'Aplicar mais', resgate: 'Resgatar', saldo: 'Informar saldo atual' }[props.tipo];
const saldoConta = computed(() => cadastros.contas.find((c) => c.id === f.conta_id)?.saldo_centavos ?? null);

async function salvar() {
  erro.value = '';
  if (props.tipo !== 'saldo' && f.valor_centavos <= 0) { erro.value = 'Informe o valor'; return; }
  try {
    if (props.tipo === 'saldo') await api.post(`/investimentos/${inv.id}/saldos`, { data: f.data, valor_centavos: f.valor_centavos });
    else await api.post(`/investimentos/${inv.id}/movimentos`, { tipo: props.tipo, data: f.data, valor_centavos: f.valor_centavos, conta_id: f.conta_id, observacao: f.observacao || null });
    avisar(props.tipo === 'saldo' ? 'Saldo atualizado' : props.tipo === 'aporte' ? 'Aporte registrado' : 'Resgate registrado');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="`${titulo}: ${inv.nome}`" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo">
          <span>{{ tipo === 'saldo' ? 'Saldo que o app do banco mostra' : 'Valor' }}</span>
          <MoneyInput v-model="f.valor_centavos" grande />
        </label>
        <label class="campo"><span>Data</span><input v-model="f.data" type="date" :max="hoje()" required /></label>
      </div>
      <p v-if="tipo === 'saldo'" class="miudo suave">
        Hoje o Vida estima {{ dinheiro(inv.posicao.saldo_bruto_centavos) }}. O saldo informado corrige o rendimento real até esta data;
        dali pra frente segue a estimativa pelo modelo ({{ inv.posicao.taxa_aa_pct.toLocaleString('pt-BR') }}% a.a.).
      </p>
      <p v-if="tipo === 'resgate' && f.valor_centavos > inv.posicao.saldo_bruto_centavos" class="aviso">
        Maior que o saldo estimado ({{ dinheiro(inv.posicao.saldo_bruto_centavos) }}). Se o banco mostra mais, informe o saldo atual antes.
      </p>
      <label v-if="tipo !== 'saldo'" class="campo">
        <span>{{ tipo === 'aporte' ? 'Sai de qual conta?' : 'Volta para qual conta?' }}</span>
        <select v-model="f.conta_id">
          <option v-for="c in contas" :key="c.id" :value="c.id">{{ c.nome }}</option>
          <option :value="null">Nenhuma (não mexer no saldo das contas)</option>
        </select>
        <small v-if="tipo === 'aporte' && saldoConta !== null && saldoConta < f.valor_centavos" class="sai">A conta tem {{ dinheiro(saldoConta) }}: vai ficar negativa.</small>
        <small v-else>Não vira despesa nem receita do mês: o dinheiro só muda de lugar.</small>
      </label>
      <label v-if="tipo !== 'saldo'" class="campo"><span>Observação</span><input v-model="f.observacao" maxlength="200" /></label>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes"><button class="btn primario" type="submit">{{ titulo }}</button></div>
    </form>
  </Modal>
</template>

<style scoped>
.aviso { background: var(--previsto-tint); padding: 10px 12px; border-radius: var(--raio-s); font-size: 0.875rem; }
</style>

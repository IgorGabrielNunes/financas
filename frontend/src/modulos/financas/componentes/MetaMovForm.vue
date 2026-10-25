<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api } from '../../../core/api';
import { avisar, avisarMudanca, cadastros } from '../../../core/store';
import { dinheiro, hoje } from '../../../core/format';
import Modal from '../../../ui/Modal.vue';
import MoneyInput from '../../../ui/MoneyInput.vue';
import type { Meta } from '../investir';

const props = defineProps<{ meta: Meta; tipo: 'guardar' | 'retirar' }>();
const emit = defineEmits<{ fechar: [] }>();
const contas = computed(() => cadastros.contas.filter((c) => c.ativa));
const f = reactive({
  valor_centavos: props.tipo === 'guardar' && props.meta.mensal_necessario_centavos ? props.meta.mensal_necessario_centavos : 0,
  data: hoje(),
  conta_id: (contas.value.find((c) => c.tipo === 'corrente')?.id ?? contas.value[0]?.id ?? null) as string | null,
  descricao: '',
});
const erro = ref('');
const saldoConta = computed(() => cadastros.contas.find((c) => c.id === f.conta_id)?.saldo_centavos ?? null);

async function salvar() {
  erro.value = '';
  if (f.valor_centavos <= 0) { erro.value = 'Informe o valor'; return; }
  try {
    await api.post(`/metas/${props.meta.id}/movimentos`, { tipo: props.tipo, ...f, descricao: f.descricao || null });
    avisar(props.tipo === 'guardar' ? `Guardado em ${props.meta.nome}` : 'Retirada registrada');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="`${tipo === 'guardar' ? 'Guardar em' : 'Retirar de'} ${meta.icone ?? ''} ${meta.nome}`" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo"><span>Valor</span><MoneyInput v-model="f.valor_centavos" grande /></label>
        <label class="campo"><span>Data</span><input v-model="f.data" type="date" :max="hoje()" required /></label>
      </div>
      <p v-if="tipo === 'retirar'" class="miudo suave">Guardado direto na meta: {{ dinheiro(meta.guardado_manual_centavos) }}. O que está em investimento vinculado sai pelo resgate do investimento.</p>
      <label class="campo">
        <span>{{ tipo === 'guardar' ? 'Sai de qual conta?' : 'Volta para qual conta?' }}</span>
        <select v-model="f.conta_id">
          <option v-for="c in contas" :key="c.id" :value="c.id">{{ c.nome }}</option>
          <option :value="null">Nenhuma (dinheiro separado fora das contas)</option>
        </select>
        <small v-if="tipo === 'guardar' && saldoConta !== null && saldoConta < f.valor_centavos" class="sai">A conta tem {{ dinheiro(saldoConta) }}: vai ficar negativa.</small>
        <small v-else>Sai do saldo da conta e do disponível, sem virar despesa do mês.</small>
      </label>
      <label class="campo"><span>Descrição (opcional)</span><input v-model="f.descricao" maxlength="120" /></label>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes"><button class="btn primario" type="submit">{{ tipo === 'guardar' ? 'Guardar' : 'Retirar' }}</button></div>
    </form>
  </Modal>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api, type Fatura } from '../../../core/api';
import { avisar, avisarMudanca, cadastros } from '../../../core/store';
import { dinheiro, hoje, mesAno } from '../../../core/format';
import Modal from '../../../ui/Modal.vue';
import MoneyInput from '../../../ui/MoneyInput.vue';

const props = defineProps<{ fatura: Fatura; contaPadrao?: string | null }>();
const emit = defineEmits<{ fechar: [] }>();
const fa = props.fatura;
const f = reactive({
  valor_pago_centavos: fa.valor_pago_centavos || fa.total_centavos,
  pago_em: fa.pago_em ?? hoje(),
  conta_pagamento_id: fa.conta_pagamento_id ?? props.contaPadrao ?? cadastros.contas.find((c) => c.ativa)?.id ?? null,
});
const erro = ref('');

async function salvar(desfazer = false) {
  try {
    await api.put(`/faturas/${fa.id}/pagamento`, desfazer ? { valor_pago_centavos: 0, pago_em: null, conta_pagamento_id: null } : f);
    avisar(desfazer ? 'Pagamento removido' : 'Pagamento registrado');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="`Pagar fatura de ${mesAno(fa.competencia)}`" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar()">
      <p>Total da fatura: <b>{{ dinheiro(fa.total_centavos) }}</b></p>
      <label class="campo"><span>Valor pago</span><MoneyInput v-model="f.valor_pago_centavos" /></label>
      <p v-if="f.valor_pago_centavos < fa.total_centavos" class="sai miudo">
        Faltam {{ dinheiro(fa.total_centavos - f.valor_pago_centavos) }}. Pagamento parcial joga o restante no rotativo, o juro mais caro do mercado.
      </p>
      <div class="linha">
        <label class="campo"><span>Data</span><input v-model="f.pago_em" type="date" required /></label>
        <label class="campo"><span>Saiu da conta</span>
          <select v-model="f.conta_pagamento_id">
            <option :value="null">Pago fora do Caixa (não mexe no saldo)</option>
            <option v-for="c in cadastros.contas.filter((c) => c.ativa)" :key="c.id" :value="c.id">{{ c.nome }}</option>
          </select>
        </label>
      </div>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button v-if="fa.valor_pago_centavos > 0" class="btn perigo" type="button" @click="salvar(true)">Desfazer pagamento</button>
        <button class="btn primario" type="submit">Registrar pagamento</button>
      </div>
    </form>
  </Modal>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api, type Trabalho } from '../api';
import { avisar, avisarMudanca } from '../store';
import Modal from './Modal.vue';
import MoneyInput from './MoneyInput.vue';

const props = defineProps<{ t: Trabalho }>();
const emit = defineEmits<{ fechar: [] }>();
const p = props.t.pessoa;
const f = reactive({
  data_admissao: p.data_admissao ?? '',
  dependentes_ir: p.dependentes_ir ?? 0,
  outros_descontos_centavos: Number(p.outros_descontos_centavos ?? 0),
  paga_mes_seguinte: p.paga_mes_seguinte ?? true,
  ferias_quitadas_ate: p.ferias_quitadas_ate ?? '',
  saque_aniversario: p.saque_aniversario ?? false,
  saldo_fgts_centavos: p.saldo_fgts_centavos === null ? 0 : Number(p.saldo_fgts_centavos),
  saldo_fgts_em: p.saldo_fgts_em ?? '',
  gerar_decimo: p.gerar_decimo ?? true,
});
const erro = ref('');

async function salvar() {
  try {
    await api.put(`/pessoas/${p.id}/trabalho`, {
      ...f,
      data_admissao: f.data_admissao || null,
      ferias_quitadas_ate: f.ferias_quitadas_ate || null,
      saldo_fgts_centavos: f.saldo_fgts_centavos > 0 ? f.saldo_fgts_centavos : null,
      saldo_fgts_em: f.saldo_fgts_centavos > 0 ? f.saldo_fgts_em || null : null,
    });
    avisar('Contrato salvo');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="`Contrato de ${p.nome}`" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo"><span>Data de admissão</span><input v-model="f.data_admissao" type="date" /></label>
        <label class="campo"><span>Dependentes no IR</span><input v-model.number="f.dependentes_ir" type="number" min="0" max="20" /></label>
      </div>
      <label class="campo"><span>Quando o salário cai</span>
        <select v-model="f.paga_mes_seguinte">
          <option :value="true">No mês seguinte (até o 5º dia útil), referente ao mês trabalhado</option>
          <option :value="false">No próprio mês trabalhado</option>
        </select>
        <small>Define em que mês um aumento aparece no dinheiro que cai na conta.</small>
      </label>
      <label class="campo">
        <span>Outros descontos fixos no holerite</span><MoneyInput v-model="f.outros_descontos_centavos" />
        <small>Vale-transporte, plano de saúde, etc. Consignado em folha vem sozinho de Dívidas.</small>
      </label>
      <label class="campo">
        <span>Férias resolvidas até</span><input v-model="f.ferias_quitadas_ate" type="date" />
        <small>Fim do último período aquisitivo que você já tirou antes de usar o Caixa. Os anteriores não contam como pendentes.</small>
      </label>
      <div class="linha">
        <label class="campo"><span>Saldo do FGTS</span><MoneyInput v-model="f.saldo_fgts_centavos" /><small>Do app FGTS, opcional</small></label>
        <label class="campo"><span>Saldo consultado em</span><input v-model="f.saldo_fgts_em" type="date" /></label>
      </div>
      <div class="linha">
        <label class="campo"><span>Saque-aniversário do FGTS</span>
          <select v-model="f.saque_aniversario"><option :value="false">Não aderiu</option><option :value="true">Aderiu</option></select>
        </label>
        <label class="campo"><span>13º nos fixos</span>
          <select v-model="f.gerar_decimo"><option :value="true">Prever as parcelas</option><option :value="false">Não prever</option></select>
        </label>
      </div>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes"><button class="btn primario" type="submit">Salvar contrato</button></div>
    </form>
  </Modal>
</template>

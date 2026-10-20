<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api, type SalarioHist } from '../../../core/api';
import { avisar, avisarMudanca } from '../../../core/store';
import { hoje } from '../../../core/format';
import Modal from '../../../ui/Modal.vue';
import MoneyInput from '../../../ui/MoneyInput.vue';

const props = defineProps<{ pessoaId: string; salario?: SalarioHist | null; cargoAtual?: string | null }>();
const emit = defineEmits<{ fechar: [] }>();
const s = props.salario;
const f = reactive({
  vigencia: s?.vigencia ?? hoje().slice(0, 8) + '01',
  bruto_centavos: s?.bruto_centavos ?? 0,
  liquido_centavos: s?.liquido_centavos ?? 0,
  cargo: s?.cargo ?? '',
  observacao: s?.observacao ?? '',
});
const erro = ref('');

async function salvar() {
  if (f.bruto_centavos <= 0) return (erro.value = 'Informe o salário bruto.');
  const body = {
    ...f,
    liquido_centavos: f.liquido_centavos > 0 ? f.liquido_centavos : null,
    cargo: f.cargo.trim() || null,
    observacao: f.observacao.trim() || null,
  };
  try {
    if (s) await api.put(`/pessoas/${props.pessoaId}/salarios/${s.id}`, body);
    else await api.post(`/pessoas/${props.pessoaId}/salarios`, body);
    avisar('Salário salvo');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function excluir() {
  if (!s || !confirm('Excluir este registro do histórico?')) return;
  await api.del(`/pessoas/${props.pessoaId}/salarios/${s.id}`);
  avisarMudanca();
  emit('fechar');
}
</script>

<template>
  <Modal :titulo="s ? 'Editar salário' : 'Novo salário'" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo"><span>Vale a partir de</span><input v-model="f.vigencia" type="date" required /><small>Aumento, dissídio, promoção</small></label>
        <label class="campo"><span>Salário bruto</span><MoneyInput v-model="f.bruto_centavos" /><small>O valor do contrato / holerite</small></label>
      </div>
      <label class="campo"><span>Cargo</span><input v-model="f.cargo" maxlength="80" :placeholder="cargoAtual ?? 'Se mudou junto'" /></label>
      <label class="campo">
        <span>Líquido exato do holerite</span><MoneyInput v-model="f.liquido_centavos" />
        <small>Opcional. Em branco, o Caixa calcula: bruto − INSS − IR − descontos fixos − consignado.</small>
      </label>
      <label class="campo"><span>Observação</span><input v-model="f.observacao" maxlength="200" placeholder="Ex.: dissídio 2026" /></label>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button v-if="s" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit">Salvar salário</button>
      </div>
    </form>
  </Modal>
</template>

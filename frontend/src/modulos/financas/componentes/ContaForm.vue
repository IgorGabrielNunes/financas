<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api, type Conta } from '../../../core/api';
import { avisar, avisarMudanca, cadastros } from '../../../core/store';
import Modal from '../../../ui/Modal.vue';
import MoneyInput from '../../../ui/MoneyInput.vue';

const props = defineProps<{ conta?: Conta | null }>();
const emit = defineEmits<{ fechar: [] }>();
const f = reactive({
  nome: props.conta?.nome ?? '',
  tipo: props.conta?.tipo ?? 'corrente',
  saldo_inicial_centavos: props.conta?.saldo_inicial_centavos ?? 0,
  cor: props.conta?.cor ?? '#2f6b4f',
  ativa: props.conta?.ativa ?? true,
  pessoa_id: props.conta?.pessoa_id ?? cadastros.pessoas[0]?.id ?? null,
  cartao_debito: props.conta?.cartao_debito ?? false,
});
const erro = ref('');

async function salvar() {
  try {
    if (props.conta) await api.put(`/contas/${props.conta.id}`, f);
    else await api.post('/contas', f);
    avisar('Conta salva');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function excluir() {
  if (!props.conta || !confirm(`Excluir a conta "${props.conta.nome}"?`)) return;
  try {
    await api.del(`/contas/${props.conta.id}`);
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="conta ? 'Editar conta' : 'Nova conta'" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <label class="campo"><span>Nome</span><input v-model="f.nome" required maxlength="60" placeholder="Ex.: Nubank, Sicredi, Dinheiro na carteira" /></label>
      <div class="linha">
        <label class="campo"><span>Tipo</span>
          <select v-model="f.tipo">
            <option value="corrente">Conta corrente</option>
            <option value="poupanca">Poupança</option>
            <option value="carteira">Dinheiro em espécie</option>
            <option value="investimento">Investimento / reserva</option>
          </select>
        </label>
        <label class="campo"><span>Cor</span><input v-model="f.cor" type="color" /></label>
      </div>
      <div class="linha">
        <label class="campo"><span>Titular</span>
          <select v-model="f.pessoa_id">
            <option :value="null">Conjunta / sem titular</option>
            <option v-for="p in cadastros.pessoas" :key="p.id" :value="p.id">{{ p.nome }}</option>
          </select>
        </label>
        <label class="campo"><span>Cartão de débito</span>
          <select v-model="f.cartao_debito"><option :value="true">Tem cartão de débito</option><option :value="false">Não tem</option></select>
        </label>
      </div>
      <label class="campo">
        <span>Saldo inicial</span>
        <MoneyInput v-model="f.saldo_inicial_centavos" />
        <small>O saldo que a conta tinha quando você começou a usar o Caixa. Depois disso, o saldo é calculado pelos lançamentos.</small>
      </label>
      <label v-if="conta" class="campo"><span>Situação</span>
        <select v-model="f.ativa"><option :value="true">Ativa</option><option :value="false">Inativa (some dos totais)</option></select>
      </label>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button v-if="conta" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit">Salvar conta</button>
      </div>
    </form>
  </Modal>
</template>

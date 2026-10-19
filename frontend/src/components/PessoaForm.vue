<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api, type Pessoa } from '../api';
import { avisar, avisarMudanca, cadastros } from '../store';
import Modal from './Modal.vue';
import MoneyInput from './MoneyInput.vue';

const props = defineProps<{ pessoa?: Pessoa | null }>();
const emit = defineEmits<{ fechar: [] }>();
const p = props.pessoa;
const f = reactive({
  nome: p?.nome ?? '',
  cargo: p?.cargo ?? '',
  salario_centavos: p?.salario_centavos ?? 0,
  dia_salario: p?.dia_salario ?? 5,
  conta_salario_id: p?.conta_salario_id ?? null,
  cor: p?.cor ?? '#2f6b4f',
});
const erro = ref('');

async function salvar() {
  const body = {
    ...f,
    cargo: f.cargo.trim() || null,
    salario_centavos: f.salario_centavos > 0 ? f.salario_centavos : null,
    dia_salario: f.salario_centavos > 0 ? f.dia_salario : null,
  };
  try {
    if (p) await api.put(`/pessoas/${p.id}`, body);
    else await api.post('/pessoas', body);
    avisar('Perfil salvo');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function excluir() {
  if (!p || !confirm(`Excluir o perfil de ${p.nome}? Contas e cartões ficam sem titular; o salário previsto deixa de aparecer.`)) return;
  await api.del(`/pessoas/${p.id}`);
  avisarMudanca();
  emit('fechar');
}
</script>

<template>
  <Modal :titulo="p ? `Perfil de ${p.nome}` : 'Nova pessoa'" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo"><span>Nome</span><input v-model="f.nome" required maxlength="40" /></label>
        <label class="campo"><span>Cor</span><input v-model="f.cor" type="color" /></label>
      </div>
      <label class="campo"><span>Cargo atual</span><input v-model="f.cargo" maxlength="80" placeholder="Ex.: Desenvolvedor, Assistente de RH" /></label>
      <div class="linha">
        <label class="campo">
          <span>Salário líquido</span><MoneyInput v-model="f.salario_centavos" />
          <small>O que cai na conta, já sem descontos. Com histórico de salário bruto (em "Salário e férias"), este valor é calculado sozinho.</small>
        </label>
        <label class="campo"><span>Cai todo dia</span><input v-model.number="f.dia_salario" type="number" min="1" max="31" /></label>
      </div>
      <label class="campo"><span>Cai na conta</span>
        <select v-model="f.conta_salario_id">
          <option :value="null">Escolher depois</option>
          <option v-for="c in cadastros.contas.filter((c) => c.ativa)" :key="c.id" :value="c.id">{{ c.nome }}</option>
        </select>
        <small>O salário vira um fixo do mês automaticamente. Para mudar o valor, edite aqui.</small>
      </label>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button v-if="p" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit">Salvar perfil</button>
      </div>
    </form>
  </Modal>
</template>

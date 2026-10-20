<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api, type Cartao } from '../../../core/api';
import { avisar, avisarMudanca, cadastros } from '../../../core/store';
import Modal from '../../../ui/Modal.vue';
import MoneyInput from '../../../ui/MoneyInput.vue';

const props = defineProps<{ cartao?: Cartao | null }>();
const emit = defineEmits<{ fechar: [] }>();
const c = props.cartao;
const f = reactive({
  nome: c?.nome ?? '',
  bandeira: c?.bandeira ?? '',
  final: c?.final ?? '',
  limite_centavos: c?.limite_centavos ?? 0,
  dia_fechamento: c?.dia_fechamento ?? 1,
  dia_vencimento: c?.dia_vencimento ?? 10,
  conta_pagamento_id: c?.conta_pagamento_id ?? cadastros.contas.find((x) => x.ativa)?.id ?? null,
  cor: c?.cor ?? '#5b2a86',
  ativo: c?.ativo ?? true,
  pessoa_id: c?.pessoa_id ?? cadastros.pessoas[0]?.id ?? null,
});
const erro = ref('');
const mudouCiclo = computed(() => !!c && (c.dia_fechamento !== f.dia_fechamento || c.dia_vencimento !== f.dia_vencimento));

async function salvar() {
  const body = { ...f, bandeira: f.bandeira || null, final: f.final || null };
  try {
    if (c) await api.put(`/cartoes/${c.id}`, body);
    else await api.post('/cartoes', body);
    avisar('Cartão salvo');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function excluir() {
  if (!c || !confirm(`Excluir o cartão "${c.nome}"?`)) return;
  try {
    await api.del(`/cartoes/${c.id}`);
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="c ? 'Editar cartão' : 'Novo cartão'" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo"><span>Nome</span><input v-model="f.nome" required maxlength="60" placeholder="Ex.: Nubank" /></label>
        <label class="campo"><span>Bandeira</span><input v-model="f.bandeira" maxlength="30" placeholder="Mastercard" /></label>
      </div>
      <label class="campo"><span>Titular</span>
        <select v-model="f.pessoa_id">
          <option :value="null">Sem titular</option>
          <option v-for="p in cadastros.pessoas" :key="p.id" :value="p.id">{{ p.nome }}</option>
        </select>
      </label>
      <div class="linha">
        <label class="campo"><span>Limite total</span><MoneyInput v-model="f.limite_centavos" /></label>
        <label class="campo"><span>4 últimos dígitos</span><input v-model="f.final" inputmode="numeric" maxlength="4" pattern="\d{4}" placeholder="opcional" /></label>
      </div>
      <div class="linha">
        <label class="campo"><span>Dia que fecha</span><input v-model.number="f.dia_fechamento" type="number" min="1" max="31" required /></label>
        <label class="campo"><span>Dia que vence</span><input v-model.number="f.dia_vencimento" type="number" min="1" max="31" required /></label>
      </div>
      <p class="miudo suave">Compras feitas no dia do fechamento ou depois entram na fatura seguinte.</p>
      <p v-if="mudouCiclo" class="miudo previsto">A mudança vale para compras novas. Faturas já existentes mantêm as datas atuais.</p>
      <div class="linha">
        <label class="campo"><span>Paga a fatura pela conta</span>
          <select v-model="f.conta_pagamento_id">
            <option :value="null">Escolher na hora</option>
            <option v-for="x in cadastros.contas.filter((x) => x.ativa)" :key="x.id" :value="x.id">{{ x.nome }}</option>
          </select>
        </label>
        <label class="campo"><span>Cor</span><input v-model="f.cor" type="color" /></label>
      </div>
      <label v-if="c" class="campo"><span>Situação</span>
        <select v-model="f.ativo"><option :value="true">Ativo</option><option :value="false">Cancelado / guardado</option></select>
      </label>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button v-if="c" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit">Salvar cartão</button>
      </div>
    </form>
  </Modal>
</template>

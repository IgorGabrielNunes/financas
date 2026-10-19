<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api, type Inadimplencia, type OrigemInad } from '../api';
import { avisar, avisarMudanca, cadastros } from '../store';
import { dinheiro, ORIGENS_INAD, STATUS_INAD } from '../format';
import Modal from './Modal.vue';
import MoneyInput from './MoneyInput.vue';

const props = defineProps<{ item?: Inadimplencia | null }>();
const emit = defineEmits<{ fechar: [] }>();
const i = props.item;
const f = reactive({
  pessoa_id: i?.pessoa_id ?? cadastros.pessoas[0]?.id ?? null,
  credor: i?.credor ?? '',
  origem: (i?.origem ?? 'faculdade') as OrigemInad,
  motivo: i?.motivo ?? '',
  valor_original_centavos: i?.valor_original_centavos ?? 0,
  valor_atual_centavos: i?.valor_atual_centavos ?? 0,
  desde: i?.desde ?? '',
  negativado: i?.negativado ?? false,
  status: i?.status ?? 'em_aberto',
  acordo_parcelas: i?.acordo_parcelas ?? 12,
  acordo_valor_parcela_centavos: i?.acordo_valor_parcela_centavos ?? 0,
  acordo_primeira_parcela: i?.acordo_primeira_parcela ?? '',
  acordo_forma_pagamento: i?.acordo_forma_pagamento ?? 'boleto',
  acordo_conta_id: i?.acordo_conta_id ?? cadastros.contas.find((c) => c.ativa)?.id ?? null,
  quitada_em: i?.quitada_em ?? null,
  observacao: i?.observacao ?? '',
});
const erro = ref('');
const devido = computed(() => f.valor_atual_centavos || f.valor_original_centavos);
const acordoTotal = computed(() => f.acordo_parcelas * f.acordo_valor_parcela_centavos);

async function salvar() {
  const acordo = f.status === 'acordo';
  const body = {
    ...f,
    motivo: f.motivo.trim() || null,
    observacao: f.observacao.trim() || null,
    valor_atual_centavos: f.valor_atual_centavos > 0 ? f.valor_atual_centavos : null,
    acordo_parcelas: acordo ? f.acordo_parcelas : null,
    acordo_valor_parcela_centavos: acordo && f.acordo_valor_parcela_centavos > 0 ? f.acordo_valor_parcela_centavos : null,
    acordo_primeira_parcela: acordo ? f.acordo_primeira_parcela || null : null,
    acordo_forma_pagamento: acordo ? f.acordo_forma_pagamento : null,
    acordo_conta_id: acordo && f.acordo_forma_pagamento === 'debito' ? f.acordo_conta_id : null,
  };
  try {
    if (i) await api.put(`/inadimplencias/${i.id}`, body);
    else await api.post('/inadimplencias', body);
    avisar('Registro salvo');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function excluir() {
  if (!i || !confirm(`Excluir o registro de ${i.credor}?`)) return;
  await api.del(`/inadimplencias/${i.id}`);
  avisarMudanca();
  emit('fechar');
}
</script>

<template>
  <Modal :titulo="i ? i.credor : 'Registrar dívida atrasada'" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo"><span>Com quem</span><input v-model="f.credor" required maxlength="80" placeholder="Ex.: Faculdade, banco, loja" /></label>
        <label class="campo"><span>O que era</span>
          <select v-model="f.origem"><option v-for="(n, k) in ORIGENS_INAD" :key="k" :value="k">{{ n }}</option></select>
        </label>
      </div>
      <label class="campo"><span>De quem</span>
        <select v-model="f.pessoa_id">
          <option :value="null">Do casal</option>
          <option v-for="p in cadastros.pessoas" :key="p.id" :value="p.id">{{ p.nome }}</option>
        </select>
      </label>
      <label class="campo">
        <span>O que levou a atrasar</span>
        <textarea v-model="f.motivo" rows="3" maxlength="1000" placeholder="Ex.: perdi o emprego no meio do semestre e não consegui manter as mensalidades" />
        <small>Registrar a causa ajuda a não repetir o caminho.</small>
      </label>
      <div class="linha">
        <label class="campo"><span>Valor que ficou devendo</span><MoneyInput v-model="f.valor_original_centavos" /></label>
        <label class="campo"><span>Valor cobrado hoje</span><MoneyInput v-model="f.valor_atual_centavos" /><small>Com juros e multa, se souber.</small></label>
      </div>
      <div class="linha">
        <label class="campo"><span>Atrasado desde</span><input v-model="f.desde" type="date" required /><small>Vencimento da 1ª parcela não paga.</small></label>
        <label class="campo"><span>Nome negativado?</span>
          <select v-model="f.negativado"><option :value="false">Não / não sei</option><option :value="true">Sim (Serasa, SPC)</option></select>
        </label>
      </div>
      <label class="campo"><span>Situação</span>
        <select v-model="f.status"><option v-for="(n, k) in STATUS_INAD" :key="k" :value="k">{{ n }}</option></select>
      </label>

      <fieldset v-if="f.status === 'acordo'" class="acordo">
        <legend>Acordo</legend>
        <div class="linha">
          <label class="campo"><span>Parcelas</span><input v-model.number="f.acordo_parcelas" type="number" min="1" max="120" /></label>
          <label class="campo"><span>Valor da parcela</span><MoneyInput v-model="f.acordo_valor_parcela_centavos" /></label>
        </div>
        <div class="linha">
          <label class="campo"><span>1ª parcela vence</span><input v-model="f.acordo_primeira_parcela" type="date" /></label>
          <label class="campo"><span>Paga com</span>
            <select v-model="f.acordo_forma_pagamento"><option value="boleto">Boleto</option><option value="pix">Pix</option><option value="debito">Débito em conta</option></select>
          </label>
        </div>
        <label v-if="f.acordo_forma_pagamento === 'debito'" class="campo"><span>Conta</span>
          <select v-model="f.acordo_conta_id"><option v-for="c in cadastros.contas.filter((c) => c.ativa)" :key="c.id" :value="c.id">{{ c.nome }}</option></select>
        </label>
        <p v-if="f.acordo_valor_parcela_centavos > 0" class="miudo">
          Total do acordo {{ dinheiro(acordoTotal) }}<template v-if="devido > acordoTotal">, {{ dinheiro(devido - acordoTotal) }} a menos que o cobrado</template>.
          As parcelas entram nos fixos de cada mês.
        </p>
      </fieldset>

      <label v-if="f.status === 'quitada'" class="campo"><span>Quitada em</span><input v-model="f.quitada_em" type="date" /></label>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button v-if="i" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit">Salvar</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.acordo { border: 1px solid var(--line); border-radius: var(--raio-s); padding: 12px; display: grid; gap: 12px; margin: 0; min-width: 0; }
.acordo legend { font-weight: 600; font-size: 0.875rem; padding: 0 4px; }
</style>

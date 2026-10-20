<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api, type Divida, type TipoDivida } from '../../../core/api';
import { avisar, avisarMudanca, cadastros } from '../../../core/store';
import { dinheiro, FORMAS_DIVIDA, hoje, TIPOS_DIVIDA } from '../../../core/format';
import Modal from '../../../ui/Modal.vue';
import MoneyInput from '../../../ui/MoneyInput.vue';

const props = defineProps<{ divida?: Divida | null }>();
const emit = defineEmits<{ fechar: [] }>();
const d = props.divida;
const f = reactive({
  pessoa_id: d?.pessoa_id ?? cadastros.pessoas[0]?.id ?? null,
  tipo: (d?.tipo ?? 'consignado') as TipoDivida,
  credor: d?.credor ?? '',
  descricao: d?.descricao ?? '',
  valor_contratado_centavos: d?.valor_contratado_centavos ?? 0,
  taxa_mensal_pct: d?.taxa_mensal_pct ?? (null as number | null),
  parcelas_total: d?.parcelas_total ?? 24,
  valor_parcela_centavos: d?.valor_parcela_centavos ?? 0,
  primeira_parcela: d?.primeira_parcela ?? hoje(),
  forma_pagamento: d?.forma_pagamento ?? 'folha',
  conta_id: d?.conta_id ?? cadastros.contas.find((c) => c.ativa)?.id ?? null,
  quitada_em: d?.quitada_em ?? (null as string | null),
  observacao: d?.observacao ?? '',
});
const erro = ref('');
const totalFinal = computed(() => f.parcelas_total * f.valor_parcela_centavos);
const juros = computed(() => (f.valor_contratado_centavos > 0 ? totalFinal.value - f.valor_contratado_centavos : null));

function aoMudarTipo() {
  f.forma_pagamento = f.tipo === 'consignado' ? 'folha' : f.forma_pagamento === 'folha' ? 'debito' : f.forma_pagamento;
}

async function salvar() {
  if (f.valor_parcela_centavos <= 0) return (erro.value = 'Informe o valor da parcela.');
  const body = {
    ...f,
    descricao: f.descricao.trim() || null,
    observacao: f.observacao.trim() || null,
    valor_contratado_centavos: f.valor_contratado_centavos > 0 ? f.valor_contratado_centavos : null,
    taxa_mensal_pct: f.taxa_mensal_pct === null || (f.taxa_mensal_pct as any) === '' ? null : Number(f.taxa_mensal_pct),
    conta_id: f.forma_pagamento === 'folha' ? null : f.conta_id,
  };
  try {
    if (d) await api.put(`/dividas/${d.id}`, body);
    else await api.post('/dividas', body);
    avisar('Dívida salva');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function excluir() {
  if (!d || !confirm(`Excluir "${TIPOS_DIVIDA[d.tipo]} ${d.credor}"? As parcelas previstas somem dos próximos meses.`)) return;
  await api.del(`/dividas/${d.id}`);
  avisarMudanca();
  emit('fechar');
}
</script>

<template>
  <Modal :titulo="d ? 'Editar dívida' : 'Nova dívida'" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo"><span>Tipo</span>
          <select v-model="f.tipo" @change="aoMudarTipo"><option v-for="(n, k) in TIPOS_DIVIDA" :key="k" :value="k">{{ n }}</option></select>
        </label>
        <label class="campo"><span>De quem</span>
          <select v-model="f.pessoa_id">
            <option :value="null">Do casal</option>
            <option v-for="p in cadastros.pessoas" :key="p.id" :value="p.id">{{ p.nome }}</option>
          </select>
        </label>
      </div>
      <div class="linha">
        <label class="campo"><span>Banco / credor</span><input v-model="f.credor" required maxlength="80" placeholder="Ex.: Banrisul" /></label>
        <label class="campo"><span>Para que foi</span><input v-model="f.descricao" maxlength="120" placeholder="opcional" /></label>
      </div>
      <div class="linha">
        <label class="campo"><span>Valor da parcela</span><MoneyInput v-model="f.valor_parcela_centavos" /></label>
        <label class="campo"><span>Total de parcelas</span><input v-model.number="f.parcelas_total" type="number" min="1" max="600" required /></label>
      </div>
      <div class="linha">
        <label class="campo">
          <span>Vencimento da 1ª parcela</span><input v-model="f.primeira_parcela" type="date" required />
          <small>As parcelas pagas e restantes são calculadas a partir desta data.</small>
        </label>
        <label class="campo"><span>Como é pago</span>
          <select v-model="f.forma_pagamento"><option v-for="(n, k) in FORMAS_DIVIDA" :key="k" :value="k">{{ n }}</option></select>
        </label>
      </div>
      <p v-if="f.forma_pagamento === 'folha'" class="miudo suave">
        Desconto em folha não gera saída no caixa: o salário cadastrado no perfil já é o líquido, depois do desconto.
      </p>
      <label v-else class="campo"><span>Sai da conta</span>
        <select v-model="f.conta_id">
          <option :value="null">Nenhuma</option>
          <option v-for="c in cadastros.contas.filter((c) => c.ativa)" :key="c.id" :value="c.id">{{ c.nome }}</option>
        </select>
      </label>
      <div class="linha">
        <label class="campo"><span>Valor que pegou</span><MoneyInput v-model="f.valor_contratado_centavos" /><small>opcional</small></label>
        <label class="campo">
          <span>Juros ao mês (%)</span><input v-model.number="f.taxa_mensal_pct" type="number" step="0.01" min="0" max="30" placeholder="Ex.: 1,85" />
          <small>Está no contrato (CET ou taxa mensal). Permite estimar a quitação.</small>
        </label>
      </div>
      <p v-if="f.valor_parcela_centavos > 0" class="previa">
        No fim você terá pago {{ dinheiro(totalFinal) }}<template v-if="juros !== null && juros > 0">, {{ dinheiro(juros) }} só de juros</template>.
      </p>
      <label class="campo"><span>Quitada em</span><input v-model="f.quitada_em" type="date" /><small>Preencha ao quitar antes do prazo.</small></label>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button v-if="d" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit">Salvar dívida</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.previa { border-left: 3px solid var(--sai); padding: 8px 12px; background: var(--surface-2); border-radius: 0 var(--raio-s) var(--raio-s) 0; font-size: 0.9rem; }
</style>

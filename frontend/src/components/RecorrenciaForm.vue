<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api, type Meio, type Recorrencia } from '../api';
import { avisar, avisarMudanca, cadastros } from '../store';
import { hoje, MEIOS } from '../format';
import Modal from './Modal.vue';
import MoneyInput from './MoneyInput.vue';

const props = defineProps<{ recorrencia?: Recorrencia | null; modelo?: Partial<Recorrencia> & { categoria?: string } }>();
const emit = defineEmits<{ fechar: [] }>();
const r = props.recorrencia;
const m = props.modelo ?? {};
const catModelo = m.categoria ? cadastros.categorias.find((c) => c.nome === m.categoria)?.id : null;

const f = reactive({
  descricao: r?.descricao ?? m.descricao ?? '',
  tipo: r?.tipo ?? m.tipo ?? 'despesa',
  valor_previsto_centavos: r?.valor_previsto_centavos ?? 0,
  dia_mes: r?.dia_mes ?? m.dia_mes ?? 10,
  meio: (r?.meio ?? m.meio ?? 'pix') as Meio,
  categoria_id: r?.categoria_id ?? catModelo ?? null,
  conta_id: r?.conta_id ?? cadastros.contas.find((c) => c.ativa)?.id ?? null,
  cartao_id: r?.cartao_id ?? null,
  inicio: r?.inicio ?? hoje().slice(0, 8) + '01',
  fim: r?.fim ?? null as string | null,
  ativa: r?.ativa ?? true,
});
const erro = ref('');
const meios = computed<Meio[]>(() => (f.tipo === 'receita' ? ['transferencia', 'pix', 'dinheiro'] : ['pix', 'boleto', 'debito', 'credito', 'dinheiro', 'transferencia']));
const categorias = computed(() => cadastros.categorias.filter((c) => c.tipo === f.tipo));

async function salvar() {
  if (f.valor_previsto_centavos <= 0) return (erro.value = 'Informe o valor (para contas que variam, use uma média).');
  const body = {
    ...f,
    cartao_id: f.meio === 'credito' ? f.cartao_id ?? cadastros.cartoes.find((c) => c.ativo)?.id ?? null : null,
    conta_id: f.meio === 'credito' ? null : f.conta_id,
  };
  try {
    if (r) await api.put(`/recorrencias/${r.id}`, body);
    else await api.post('/recorrencias', body);
    avisar('Fixo salvo');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function excluir() {
  if (!r || !confirm(`Excluir "${r.descricao}"? Os meses já confirmados continuam no histórico.`)) return;
  await api.del(`/recorrencias/${r.id}`);
  avisarMudanca();
  emit('fechar');
}
</script>

<template>
  <Modal :titulo="r ? 'Editar fixo' : 'Novo fixo do mês'" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="segmentado" role="group" aria-label="Tipo">
        <button type="button" :aria-pressed="f.tipo === 'despesa'" @click="f.tipo = 'despesa'">Despesa</button>
        <button type="button" :aria-pressed="f.tipo === 'receita'" @click="f.tipo = 'receita'">Receita</button>
      </div>
      <label class="campo"><span>Descrição</span><input v-model="f.descricao" required maxlength="120" /></label>
      <div class="linha">
        <label class="campo">
          <span>Valor previsto</span><MoneyInput v-model="f.valor_previsto_centavos" />
          <small>Varia todo mês? Use a média. Você corrige o valor real ao confirmar.</small>
        </label>
        <label class="campo"><span>Todo dia</span><input v-model.number="f.dia_mes" type="number" min="1" max="31" required /></label>
      </div>
      <div class="linha">
        <label class="campo"><span>Como paga/recebe</span>
          <select v-model="f.meio"><option v-for="x in meios" :key="x" :value="x">{{ MEIOS[x] }}</option></select>
        </label>
        <label v-if="f.meio === 'credito'" class="campo"><span>Cartão</span>
          <select v-model="f.cartao_id"><option v-for="c in cadastros.cartoes.filter((c) => c.ativo)" :key="c.id" :value="c.id">{{ c.nome }}</option></select>
        </label>
        <label v-else class="campo"><span>Conta</span>
          <select v-model="f.conta_id">
            <option :value="null">Nenhuma</option>
            <option v-for="c in cadastros.contas.filter((c) => c.ativa)" :key="c.id" :value="c.id">{{ c.nome }}</option>
          </select>
        </label>
      </div>
      <div class="linha">
        <label class="campo"><span>Categoria</span>
          <select v-model="f.categoria_id">
            <option :value="null">Sem categoria</option>
            <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
          </select>
        </label>
        <label class="campo"><span>A partir de</span><input v-model="f.inicio" type="date" required /></label>
      </div>
      <p v-if="r" class="miudo suave">Ao salvar, os meses ainda não confirmados (deste mês em diante) passam a usar os novos valores.</p>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button v-if="r" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit">Salvar fixo</button>
      </div>
    </form>
  </Modal>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api } from '../../../core/api';
import { avisar, avisarMudanca } from '../../../core/store';
import Modal from '../../../ui/Modal.vue';
import { numero, type Taxas } from '../investir';

const props = defineProps<{ taxas: Taxas }>();
const emit = defineEmits<{ fechar: [] }>();
const v = (x: number) => String(x).replace('.', ',');
const f = reactive({ selic_aa: v(props.taxas.selic_aa), cdi_aa: v(props.taxas.cdi_aa), ipca_aa: v(props.taxas.ipca_aa), tr_am: v(props.taxas.tr_am) });
const erro = ref('');

async function salvar() {
  const b = Object.fromEntries(Object.entries(f).map(([k, x]) => [k, numero(x)]));
  if (Object.values(b).some((x) => x === null)) { erro.value = 'Preencha todas as taxas'; return; }
  try { await api.put('/investimentos/taxas', b); avisar('Taxas atualizadas'); avisarMudanca(); emit('fechar'); } catch (e) { erro.value = (e as Error).message; }
}
async function doBC() {
  try {
    const r = await api.post<Taxas & { atualizou: boolean }>('/investimentos/taxas/atualizar');
    avisar(r.atualizou ? 'Taxas atualizadas pelo Banco Central' : 'Banco Central indisponível agora; mantive as taxas', r.atualizou ? 'ok' : 'erro');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal titulo="Taxas de referência" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <p class="miudo suave">Usadas para estimar o rendimento e nas simulações. O padrão é buscar do Banco Central a cada 12 horas; editar aqui fixa os valores até você pedir para atualizar de novo.</p>
      <div class="linha">
        <label class="campo"><span>CDI (% a.a.)</span><input v-model="f.cdi_aa" inputmode="decimal" required /></label>
        <label class="campo"><span>Selic (% a.a.)</span><input v-model="f.selic_aa" inputmode="decimal" required /></label>
      </div>
      <div class="linha">
        <label class="campo"><span>IPCA 12 meses (%)</span><input v-model="f.ipca_aa" inputmode="decimal" required /></label>
        <label class="campo"><span>TR (% ao mês)</span><input v-model="f.tr_am" inputmode="decimal" required /></label>
      </div>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button class="btn" type="button" @click="doBC">Buscar do Banco Central</button>
        <button class="btn primario" type="submit">Salvar</button>
      </div>
    </form>
  </Modal>
</template>

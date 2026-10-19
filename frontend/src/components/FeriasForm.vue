<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { api, type SimFerias } from '../api';
import { avisar, avisarMudanca } from '../store';
import { dinheiro, hoje } from '../format';
import Modal from './Modal.vue';

const props = defineProps<{ pessoaId: string }>();
const emit = defineEmits<{ fechar: [] }>();
const f = reactive({ inicio: hoje(), dias: 30, abono_dias: 0 });
const erro = ref('');
const sim = ref<SimFerias | null>(null);

watch(() => [f.inicio, f.dias, f.abono_dias], async () => {
  sim.value = null;
  if (f.dias + f.abono_dias > 30 || !f.inicio) return;
  sim.value = await api.get<SimFerias>(`/pessoas/${props.pessoaId}/simular-ferias?dias=${f.dias}&abono=${f.abono_dias}&inicio=${f.inicio}`).catch(() => null);
}, { immediate: true });

async function salvar() {
  try {
    await api.post(`/pessoas/${props.pessoaId}/ferias`, f);
    avisar('Férias registradas');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal titulo="Registrar férias" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo"><span>Início</span><input v-model="f.inicio" type="date" required /></label>
        <label class="campo"><span>Dias de descanso</span>
          <select v-model.number="f.dias"><option v-for="d in [30, 20, 15, 14, 10, 5]" :key="d" :value="d">{{ d }} dias</option></select>
        </label>
        <label class="campo"><span>Dias vendidos</span>
          <select v-model.number="f.abono_dias"><option v-for="d in [0, 5, 10]" :key="d" :value="d">{{ d ? `${d} dias` : 'Nenhum' }}</option></select>
        </label>
      </div>
      <p v-if="f.dias + f.abono_dias > 30" class="erro-form">Descanso + venda não podem passar de 30 dias.</p>
      <dl v-if="sim" class="sim">
        <div><dt>Férias ({{ sim.dias }} dias)</dt><dd>{{ dinheiro(sim.valorFerias) }}</dd></div>
        <div><dt>1/3 constitucional</dt><dd>{{ dinheiro(sim.tercoFerias) }}</dd></div>
        <div v-if="sim.abono"><dt>Venda de {{ sim.abonoDias }} dias + 1/3</dt><dd>{{ dinheiro(sim.abono + sim.tercoAbono) }}</dd></div>
        <div><dt>INSS</dt><dd class="sai">− {{ dinheiro(sim.inss) }}</dd></div>
        <div><dt>IR</dt><dd class="sai">− {{ dinheiro(sim.irrf) }}</dd></div>
        <div class="total"><dt>Cai na conta até 2 dias antes</dt><dd class="entra">{{ dinheiro(sim.liquido) }}</dd></div>
      </dl>
      <p class="miudo suave">As férias abatem do período aquisitivo mais antigo em aberto. O salário do mês das férias vem menor, porque esses dias já foram pagos adiantados.</p>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes"><button class="btn primario" type="submit" :disabled="f.dias + f.abono_dias > 30">Registrar férias</button></div>
    </form>
  </Modal>
</template>

<style scoped>
.sim { margin: 0; background: var(--surface-2); border-radius: var(--raio-s); padding: 4px 12px; }
.sim div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 0.9rem; }
.sim div:last-child { border-bottom: 0; }
.sim dt { color: var(--ink-2); }
.sim dd { margin: 0; font-weight: 600; }
.sim .total dd { font-size: 1.05rem; }
</style>

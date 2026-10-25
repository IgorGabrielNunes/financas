<script setup lang="ts">
// Liga um investimento existente a uma meta (o saldo dele passa a contar no progresso) ou cadastra um novo.
import { ref } from 'vue';
import { api } from '../../../core/api';
import { avisar, avisarMudanca } from '../../../core/store';
import { dinheiro } from '../../../core/format';
import Modal from '../../../ui/Modal.vue';
import InvestimentoForm from './InvestimentoForm.vue';
import { rotuloModelo, type Carteira, type Investimento, type Meta } from '../investir';

const props = defineProps<{ meta: Meta }>();
const emit = defineEmits<{ fechar: [] }>();
const itens = ref<Investimento[]>([]);
const novo = ref(false);
const erro = ref('');
api.get<Carteira>('/investimentos').then((c) => { itens.value = c.itens.filter((i) => i.ativo); }).catch((e) => { erro.value = e.message; });

async function ligar(i: Investimento, metaId: string | null) {
  const { posicao: _p, conta_nome: _c, conta_cor: _cc, meta_nome: _m, usuario_nome: _u, id, ...resto } = i as Investimento & Record<string, unknown>;
  const corpo = Object.fromEntries(Object.entries(resto).filter(([k]) => !['casa_id', 'created_at', 'modelo'].includes(k)));
  try {
    await api.put(`/investimentos/${id}`, { ...corpo, meta_id: metaId });
    avisar(metaId ? `${i.nome} agora conta na meta` : `${i.nome} desligado da meta`);
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <InvestimentoForm v-if="novo" :meta-id="meta.id" @fechar="emit('fechar')" />
  <Modal v-else :titulo="`Investimentos da meta ${meta.nome}`" @fechar="emit('fechar')">
    <div class="form">
      <p class="miudo suave">O saldo do investimento ligado conta no progresso da meta e o rendimento entra no cálculo de quanto guardar por mês.</p>
      <ul v-if="itens.length" class="lista painel">
        <li v-for="i in itens" :key="i.id">
          <div>
            <div class="titulo">{{ i.nome }}</div>
            <div class="meta">{{ rotuloModelo(i) }} · {{ dinheiro(i.posicao.saldo_bruto_centavos) }}<template v-if="i.meta_nome && i.meta_id !== meta.id"> · hoje em {{ i.meta_nome }}</template></div>
          </div>
          <button v-if="i.meta_id === meta.id" class="btn" type="button" @click="ligar(i, null)">Desligar</button>
          <button v-else class="btn primario" type="button" @click="ligar(i, meta.id)">Ligar</button>
        </li>
      </ul>
      <p v-else class="painel vazio miudo">Nenhum investimento cadastrado.</p>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes"><button class="btn" type="button" @click="novo = true">Cadastrar novo investimento</button></div>
    </div>
  </Modal>
</template>

<style scoped>
.lista li { grid-template-columns: minmax(0, 1fr) auto; }
</style>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api } from '../core/api';
import { avisar, avisarMudanca } from '../core/store';
import { paraPayload, type Campo } from './campos';
import Modal from './Modal.vue';
import FormCampos from './FormCampos.vue';

/**
 * Cadastro genérico: monta o formulário a partir dos campos, faz POST (novo) ou PUT (edição)
 * em `rota`, e opcionalmente exclui. `fixos` vão no payload sem aparecer (ex.: projeto_id).
 */
const props = defineProps<{
  titulo: string; rota: string; campos: Campo[];
  item?: Record<string, any> | null; padrao?: Record<string, any>; fixos?: Record<string, any>;
  rotuloSalvar?: string; confirmarExclusao?: string;
}>();
const emit = defineEmits<{ fechar: []; salvo: [linha: any]; excluido: [] }>();

const inicial: Record<string, any> = {};
for (const c of props.campos) inicial[c.k] = props.item?.[c.k] ?? props.padrao?.[c.k] ?? (c.t === 'bool' ? false : c.t === 'tags' ? [] : c.t === 'sel' && c.vazio ? null : '');
const modelo = reactive(inicial);
const erro = ref('');
const salvando = ref(false);

async function salvar() {
  erro.value = '';
  salvando.value = true;
  try {
    const body = { ...paraPayload(props.campos, modelo), ...(props.fixos ?? {}) };
    const linha = props.item?.id ? await api.put(`${props.rota}/${props.item.id}`, body) : await api.post(props.rota, body);
    avisar(props.item?.id ? 'Alterações salvas' : 'Salvo');
    avisarMudanca();
    emit('salvo', linha);
    emit('fechar');
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    salvando.value = false;
  }
}
async function excluir() {
  if (!props.item?.id || !confirm(props.confirmarExclusao ?? 'Excluir este registro?')) return;
  try {
    await api.del(`${props.rota}/${props.item.id}`);
    avisar('Excluído');
    emit('excluido');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="titulo" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <slot name="topo" :modelo="modelo" />
      <FormCampos :campos="campos" :modelo="modelo" />
      <slot :modelo="modelo" />
      <p v-if="erro" class="erro-form" role="alert">{{ erro }}</p>
      <div class="acoes">
        <button v-if="item?.id" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit" :disabled="salvando">{{ salvando ? 'Salvando…' : rotuloSalvar ?? 'Salvar' }}</button>
      </div>
    </form>
  </Modal>
</template>

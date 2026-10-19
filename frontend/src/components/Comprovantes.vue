<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type Comprovante } from '../api';
import { avisar, avisarMudanca } from '../store';
import { enviarComprovante } from './comprimir';

const props = defineProps<{ lancamentoId: string }>();
const itens = ref<Comprovante[]>([]);
const enviando = ref(false);

async function carregar() {
  itens.value = await api.get<Comprovante[]>(`/lancamentos/${props.lancamentoId}/comprovantes`);
}
onMounted(carregar);

async function enviar(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  enviando.value = true;
  try {
    for (const f of files) await enviarComprovante(props.lancamentoId, f);
    await carregar();
    avisarMudanca();
  } catch (err) {
    avisar((err as Error).message, 'erro');
  } finally {
    enviando.value = false;
  }
}

async function abrir(c: Comprovante) {
  // abre a aba ANTES do await: Safari/iOS bloqueia window.open fora do gesto do usuário
  const aba = window.open('about:blank', '_blank');
  try {
    const { url } = await api.get<{ url: string }>(`/comprovantes/${c.id}/url`);
    if (aba) aba.location.href = url; else location.href = url;
  } catch (err) {
    aba?.close();
    avisar((err as Error).message, 'erro');
  }
}

async function remover(c: Comprovante) {
  if (!confirm(`Excluir o comprovante "${c.nome_original}"?`)) return;
  await api.del(`/comprovantes/${c.id}`);
  await carregar();
  avisarMudanca();
}
</script>

<template>
  <div class="comprovantes">
    <ul v-if="itens.length" class="lista painel">
      <li v-for="c in itens" :key="c.id">
        <span class="pin" />
        <button class="btn link titulo" type="button" @click="abrir(c)">{{ c.nome_original }}</button>
        <button class="btn link perigo" type="button" @click="remover(c)">Excluir</button>
      </li>
    </ul>
    <label class="btn">
      {{ enviando ? 'Enviando…' : 'Anexar comprovante' }}
      <input class="sr" type="file" accept="image/*,application/pdf" multiple :disabled="enviando" @change="enviar" />
    </label>
  </div>
</template>

<style scoped>
.comprovantes { display: grid; gap: 8px; }
.comprovantes .titulo { justify-self: start; text-align: left; }
</style>

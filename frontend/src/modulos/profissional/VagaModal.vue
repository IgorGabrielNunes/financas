<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../../core/api';
import { avisar, avisarMudanca, versao } from '../../core/store';
import { dataCurta, dinheiro, hoje } from '../../core/format';
import Modal from '../../ui/Modal.vue';
import EntidadeModal from '../../ui/EntidadeModal.vue';
import { CAMPOS_ENTREVISTA, ETAPA, MODALIDADE, RESULTADO, STATUS_VAGA } from './comum';

const props = defineProps<{ vaga: any }>();
const emit = defineEmits<{ fechar: []; editar: [] }>();
const entrevistas = ref<any[]>([]);
const status = ref(props.vaga.status);
async function carregar() { entrevistas.value = await api.get(`/profissional/entrevistas?vaga_id=${props.vaga.id}`); }
onMounted(carregar);
watch(versao, carregar);
const ent = ref<{ item: any } | null>(null);

async function mudarStatus() {
  try {
    await api.patch(`/profissional/vagas/${props.vaga.id}`, { status: status.value });
    avisarMudanca();
  } catch (e) { avisar((e as Error).message, 'erro'); status.value = props.vaga.status; }
}
</script>

<template>
  <Modal :titulo="`${vaga.cargo} · ${vaga.empresa}`" @fechar="emit('fechar')">
    <div class="info">
      <label class="campo"><span>Situação</span>
        <select v-model="status" @change="mudarStatus"><option v-for="(r, k) in STATUS_VAGA" :key="k" :value="k">{{ r }}</option></select>
      </label>
      <p class="suave">
        {{ [vaga.modalidade ? MODALIDADE[vaga.modalidade as keyof typeof MODALIDADE] : null, vaga.local, vaga.fonte ? `via ${vaga.fonte}` : null,
            vaga.salario_min_centavos ? `a partir de ${dinheiro(vaga.salario_min_centavos)}` : null].filter(Boolean).join(' · ') }}
      </p>
      <a v-if="vaga.url" :href="vaga.url" target="_blank" rel="noopener noreferrer">Abrir vaga ↗</a>
      <p v-if="vaga.observacoes" class="obs">{{ vaga.observacoes }}</p>
    </div>

    <h3>Entrevistas</h3>
    <ul v-if="entrevistas.length" class="lista painel">
      <li v-for="e in entrevistas" :key="e.id" class="clicavel" @click="ent = { item: e }">
        <span class="ico" style="--c: #475569">{{ ETAPA[e.etapa as keyof typeof ETAPA].slice(0, 1) }}</span>
        <div><div class="titulo">{{ ETAPA[e.etapa as keyof typeof ETAPA] }}</div><div class="meta">{{ e.entrevistador ?? '' }}</div></div>
        <div class="valor"><div>{{ dataCurta(e.data) }} {{ e.hora?.slice(0, 5) ?? '' }}</div><div class="meta">{{ RESULTADO[e.resultado as keyof typeof RESULTADO] }}</div></div>
      </li>
    </ul>
    <p v-else class="suave">Nenhuma entrevista ainda.</p>

    <div class="acoes">
      <button class="btn" @click="emit('editar')">Editar vaga</button>
      <button class="btn primario" @click="ent = { item: null }">Marcar entrevista</button>
    </div>

    <EntidadeModal v-if="ent" :titulo="ent.item ? 'Entrevista' : 'Nova entrevista'" rota="/profissional/entrevistas" :campos="CAMPOS_ENTREVISTA"
      :item="ent.item" :padrao="{ etapa: 'rh', resultado: 'agendada', data: hoje() }" :fixos="{ vaga_id: vaga.id }" @fechar="ent = null" />
  </Modal>
</template>

<style scoped>
.info { display: grid; gap: 8px; margin-bottom: 16px; }
.info p { margin: 0; }
.info a { color: var(--marca-tint-ink); font-weight: 650; text-decoration: none; }
.obs { white-space: pre-wrap; font-size: 0.9rem; }
h3 { font-size: 0.95rem; margin: 0 0 8px; }
.acoes { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
</style>

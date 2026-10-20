<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../core/api';
import { versao } from '../../core/store';
import { dataCurta, num } from '../../core/format';
import Modal from '../../ui/Modal.vue';
import EntidadeModal from '../../ui/EntidadeModal.vue';
import { opcoes, type Campo } from '../../ui/campos';

const props = defineProps<{ disciplina: any; mediaAprovacao: number }>();
const emit = defineEmits<{ fechar: []; editar: [] }>();
const TIPOS = { prova: 'Prova', apol: 'APOL', discursiva: 'Discursiva', atividade: 'Atividade', trabalho: 'Trabalho', projeto: 'Projeto', outro: 'Outro' };

const avs = ref<any[]>([]);
async function carregar() { avs.value = await api.get(`/estudos/avaliacoes?disciplina_id=${props.disciplina.id}`); }
onMounted(carregar);
watch(versao, carregar);

// mesma regra do backend (situacaoDisciplina): média ponderada normalizada para 0–10
const calc = computed(() => {
  const l = avs.value.map((a) => ({ nota: a.nota === null ? null : Number(a.nota), max: Number(a.nota_maxima), peso: Number(a.peso) }));
  const feitas = l.filter((a) => a.nota !== null);
  const pesoTotal = l.reduce((s, a) => s + a.peso, 0);
  const pesoFeito = feitas.reduce((s, a) => s + a.peso, 0);
  const pontos = feitas.reduce((s, a) => s + (a.nota! / a.max) * 10 * a.peso, 0);
  const media = pesoFeito ? pontos / pesoFeito : null;
  const restante = pesoTotal - pesoFeito;
  const precisa = restante > 0 ? Math.max(0, (props.mediaAprovacao * pesoTotal - pontos) / restante) : null;
  return { media, precisa, completo: l.length > 0 && !restante };
});

const av = ref<{ item: any } | null>(null);
const campos: Campo[] = [
  { k: 'titulo', r: 'Nome', obrig: true, ph: 'Ex.: APOL 1, Prova objetiva' },
  { k: 'tipo', r: 'Tipo', t: 'sel', op: opcoes(TIPOS), meia: true },
  { k: 'data', r: 'Data', t: 'data', meia: true },
  { k: 'nota', r: 'Nota obtida', t: 'num', min: 0, passo: 0.01, meia: true, dica: 'Em branco até sair o resultado' },
  { k: 'nota_maxima', r: 'Vale', t: 'num', min: 0.01, passo: 0.01, meia: true },
  { k: 'peso', r: 'Peso na média', t: 'num', min: 0.01, passo: 0.01, dica: 'Ex.: APOLs peso 1, prova objetiva peso 2' },
  { k: 'observacoes', r: 'Observações', t: 'area', linhas: 2 },
];
</script>

<template>
  <Modal :titulo="disciplina.nome" @fechar="emit('fechar')">
    <div class="topo">
      <div><span class="suave miudo">Média atual</span><b>{{ calc.media === null ? '—' : num(calc.media, 2) }}</b></div>
      <div><span class="suave miudo">Para aprovar</span><b>{{ num(mediaAprovacao) }}</b></div>
      <div v-if="calc.precisa !== null">
        <span class="suave miudo">Precisa nas restantes</span>
        <b :class="{ sai: calc.precisa > 10 }">{{ calc.precisa > 10 ? 'impossível' : num(calc.precisa, 2) }}</b>
      </div>
      <div v-else-if="calc.completo">
        <span class="suave miudo">Resultado</span>
        <b :class="calc.media! >= mediaAprovacao ? 'entra' : 'sai'">{{ calc.media! >= mediaAprovacao ? 'Aprovado' : 'Reprovado' }}</b>
      </div>
    </div>

    <ul v-if="avs.length" class="lista painel">
      <li v-for="a in avs" :key="a.id" class="clicavel" @click="av = { item: a }">
        <span class="ico" :style="{ '--c': disciplina.cor }">{{ TIPOS[a.tipo as keyof typeof TIPOS].slice(0, 1) }}</span>
        <div>
          <div class="titulo">{{ a.titulo }}</div>
          <div class="meta">{{ [a.data ? dataCurta(a.data) : null, `peso ${num(a.peso)}`].filter(Boolean).join(' · ') }}</div>
        </div>
        <div class="valor">{{ a.nota === null ? '—' : `${num(a.nota, 2)}/${num(a.nota_maxima)}` }}</div>
      </li>
    </ul>
    <p v-else class="suave">Cadastre as avaliações (APOLs, provas, trabalhos) para acompanhar a média.</p>

    <div class="acoes">
      <button class="btn" @click="emit('editar')">Editar disciplina</button>
      <button class="btn primario" @click="av = { item: null }">Nova avaliação</button>
    </div>

    <EntidadeModal v-if="av" :titulo="av.item ? 'Editar avaliação' : 'Nova avaliação'" rota="/estudos/avaliacoes" :campos="campos" :item="av.item"
      :padrao="{ tipo: 'apol', peso: 1, nota_maxima: 10 }" :fixos="{ disciplina_id: disciplina.id }" @fechar="av = null" />
  </Modal>
</template>

<style scoped>
.topo { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 16px; }
.topo > div { display: grid; gap: 2px; }
.topo b { font-size: 1.4rem; letter-spacing: -0.02em; }
.acoes { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
</style>

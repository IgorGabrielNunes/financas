<script setup lang="ts">
// Execução do treino: marca exercício a exercício, ajusta carga/repetições feitas e conclui.
// O início fica salvo no navegador: fechar a tela no meio do treino não perde a duração.
import { computed, onUnmounted, reactive, ref } from 'vue';
import { api } from '../../../core/api';
import { avisar, avisarMudanca } from '../../../core/store';
import Modal from '../../../ui/Modal.vue';
import { GRUPO, kg, prescricao, type Ficha } from './comum';

const props = defineProps<{ ficha: Ficha }>();
const emit = defineEmits<{ fechar: [] }>();
const CHAVE = `vida.treino.${props.ficha.id}`;

function lerInicio(): number {
  try {
    const v = Number(localStorage.getItem(CHAVE));
    if (v && Date.now() - v < 6 * 3600_000) return v; // treino aberto há mais de 6h: recomeça
  } catch { /* navegação privada */ }
  const agora = Date.now();
  try { localStorage.setItem(CHAVE, String(agora)); } catch { /* ignora */ }
  return agora;
}
const inicio = lerInicio();
const agora = ref(Date.now());
const relogio = setInterval(() => (agora.value = Date.now()), 15000);
onUnmounted(() => clearInterval(relogio));
const decorrido = computed(() => Math.max(1, Math.round((agora.value - inicio) / 60000)));

const linhas = reactive(props.ficha.exercicios.map((e) => ({
  e, feito: false,
  series: e.series ?? null as number | null,
  repeticoes: e.ultimo?.repeticoes ?? e.repeticoes ?? '',
  carga: e.carga_kg === null || e.carga_kg === undefined ? '' : String(Number(e.carga_kg)),
})));
const feitos = computed(() => linhas.filter((l) => l.feito).length);
const duracao = ref<number | null>(null);
const intensidade = ref<number | null>(null);
const atualizar = ref(true);
const salvando = ref(false);
const aberto = ref<string | null>(props.ficha.exercicios[0]?.id ?? null);

function marcar(i: number) {
  linhas[i].feito = !linhas[i].feito;
  // abre o próximo pendente: no celular, a tela acompanha o treino
  if (linhas[i].feito) aberto.value = linhas.find((l, j) => j > i && !l.feito)?.e.id ?? null;
}

async function concluir() {
  if (!feitos.value && !confirm('Nenhum exercício marcado. Concluir mesmo assim?')) return;
  salvando.value = true;
  try {
    await api.post(`/academia/fichas/${props.ficha.id}/concluir`, {
      duracao_min: duracao.value ?? decorrido.value,
      intensidade: intensidade.value,
      atualizar_cargas: atualizar.value,
      registros: linhas.map((l) => ({
        exercicio_id: l.e.id, concluido: l.feito,
        series_feitas: l.series === null || (l.series as unknown) === '' ? null : Number(l.series),
        repeticoes: l.repeticoes || null,
        carga_kg: l.carga === '' ? null : Number(String(l.carga).replace(',', '.')),
      })),
    });
    try { localStorage.removeItem(CHAVE); } catch { /* ignora */ }
    avisar(`${props.ficha.nome} concluído 💪`);
    avisarMudanca();
    emit('fechar');
  } catch (e) { avisar((e as Error).message, 'erro'); } finally { salvando.value = false; }
}
function cancelar() {
  if (feitos.value && !confirm('Sair sem concluir? O que foi marcado não será salvo.')) return;
  try { localStorage.removeItem(CHAVE); } catch { /* ignora */ }
  emit('fechar');
}
</script>

<template>
  <Modal :titulo="`${ficha.nome}${ficha.foco ? ' · ' + ficha.foco : ''}`" @fechar="emit('fechar')">
    <div class="topo">
      <span><b>{{ feitos }}/{{ linhas.length }}</b> exercícios</span>
      <span class="suave">⏱ {{ decorrido }} min</span>
    </div>
    <div class="medidor"><i :style="{ width: (linhas.length ? (feitos / linhas.length) * 100 : 0) + '%', background: ficha.cor }" /></div>

    <ol class="exercicios">
      <li v-for="(l, i) in linhas" :key="l.e.id" :class="{ feito: l.feito, aberto: aberto === l.e.id }">
        <div class="cab">
          <button class="check" :style="{ '--c': ficha.cor }" :aria-pressed="l.feito" :aria-label="`${l.feito ? 'Desmarcar' : 'Marcar'} ${l.e.nome}`" @click="marcar(i)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>
          </button>
          <button class="info" :aria-expanded="aberto === l.e.id" @click="aberto = aberto === l.e.id ? null : l.e.id">
            <span class="nome">{{ l.e.nome }}</span>
            <span class="meta">{{ GRUPO[l.e.grupo] }} · {{ prescricao(l.e) || 'sem prescrição' }}</span>
          </button>
        </div>
        <div v-if="aberto === l.e.id" class="detalhe">
          <div class="campos">
            <label class="campo"><span>Séries</span><input v-model.number="l.series" type="number" inputmode="numeric" min="0" max="50" /></label>
            <label class="campo"><span>Repetições</span><input v-model="l.repeticoes" maxlength="30" /></label>
            <label class="campo"><span>Carga (kg)</span><input v-model="l.carga" inputmode="decimal" /></label>
          </div>
          <p v-if="l.e.ultimo" class="suave miudo">Última vez: {{ kg(l.e.ultimo.carga_kg) ?? '—' }} kg × {{ l.e.ultimo.repeticoes ?? '—' }}</p>
          <p v-if="l.e.observacoes" class="obs">{{ l.e.observacoes }}</p>
          <a v-if="l.e.video_url" :href="l.e.video_url" target="_blank" rel="noopener noreferrer" class="video">Ver vídeo ↗</a>
          <button v-if="!l.feito" class="btn primario feito-btn" @click="marcar(i)">Feito</button>
        </div>
      </li>
    </ol>

    <div class="fim">
      <div class="campos">
        <label class="campo"><span>Duração (min)</span><input v-model.number="duracao" type="number" inputmode="numeric" min="1" :placeholder="String(decorrido)" /></label>
        <label class="campo"><span>Como foi</span>
          <select v-model="intensidade">
            <option :value="null">—</option>
            <option v-for="[v, r] in [[1, 'Leve'], [2, 'Moderado'], [3, 'Puxado'], [4, 'Forte'], [5, 'Máximo']]" :key="v" :value="v">{{ r }}</option>
          </select>
        </label>
      </div>
      <label class="interruptor"><input v-model="atualizar" type="checkbox" /> Levar as cargas de hoje para a ficha</label>
      <div class="acoes">
        <button class="btn" type="button" @click="cancelar">Sair sem salvar</button>
        <button class="btn primario" :disabled="salvando" @click="concluir">{{ salvando ? 'Salvando…' : 'Concluir treino' }}</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.topo { display: flex; justify-content: space-between; margin-bottom: 8px; }
.exercicios { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 8px; }
.exercicios li { border: 1px solid var(--line); border-radius: var(--raio-s); background: var(--surface); }
.exercicios li.aberto { border-color: var(--line-2); box-shadow: var(--sombra-flutuante); }
.cab { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: center; padding: 10px 12px; }
.info { display: grid; text-align: left; border: 0; background: none; padding: 4px 0; cursor: pointer; font: inherit; color: inherit; min-height: 40px; }
.nome { font-weight: 600; }
.meta { color: var(--ink-3); font-size: 0.8125rem; }
.feito .nome { text-decoration: line-through; color: var(--ink-3); }
.check {
  width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--c); background: var(--surface); cursor: pointer;
  display: grid; place-items: center; padding: 0; color: transparent; position: relative;
}
.check::after { content: ''; position: absolute; inset: -9px; }
.check[aria-pressed='true'] { background: var(--c); color: #fff; }
.check svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.detalhe { padding: 0 12px 12px; display: grid; gap: 8px; }
.campos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.fim .campos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.obs { margin: 0; font-size: 0.875rem; color: var(--ink-2); white-space: pre-wrap; }
.video { color: var(--marca-tint-ink); font-weight: 650; text-decoration: none; font-size: 0.875rem; }
.feito-btn { justify-self: end; }
.fim { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); display: grid; gap: 12px; }
.interruptor { display: flex; gap: 10px; align-items: center; font-size: 0.9rem; color: var(--ink-2); cursor: pointer; min-height: 40px; }
.interruptor input { width: 20px; height: 20px; min-height: 0; accent-color: var(--marca); }
.acoes { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
@media (max-width: 380px) { .campos { grid-template-columns: 1fr 1fr; } }
</style>

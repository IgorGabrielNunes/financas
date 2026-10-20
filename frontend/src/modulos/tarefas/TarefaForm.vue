<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api } from '../../core/api';
import { avisar, avisarMudanca, sessao } from '../../core/store';
import { hoje } from '../../core/format';
import Modal from '../../ui/Modal.vue';
import { DIAS, tarefasEstado, type Repeticao, type Tarefa } from './tipos';

const props = defineProps<{ tarefa?: Tarefa | null; areaPadrao?: string | null }>();
const emit = defineEmits<{ fechar: [] }>();
const t = props.tarefa;
const amanha = (() => { const d = new Date(hoje() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();

const f = reactive({
  titulo: t?.titulo ?? '',
  notas: t?.notas ?? '',
  area_id: t?.area_id ?? props.areaPadrao ?? null,
  prioridade: t?.prioridade ?? 2,
  data: t ? t.data : hoje(),
  repeticao: (t?.repeticao ?? 'nenhuma') as Repeticao,
  dias_semana: [...(t?.dias_semana ?? [])],
  fim: t?.fim ?? '',
  compartilhada: t?.compartilhada ?? false,
  responsavel_id: t?.responsavel_id ?? null,
});
const quando = ref<'hoje' | 'amanha' | 'data' | 'sem'>(!t ? 'hoje' : !t.data ? 'sem' : t.data === hoje() ? 'hoje' : t.data === amanha ? 'amanha' : 'data');
const erro = ref('');
const souDono = computed(() => !t || t.user_id === sessao.eu?.id);

function alternarDia(d: number) {
  const i = f.dias_semana.indexOf(d);
  if (i >= 0) f.dias_semana.splice(i, 1); else f.dias_semana.push(d);
}
function dataFinal() {
  if (f.repeticao !== 'nenhuma') return f.data || hoje();
  return quando.value === 'hoje' ? hoje() : quando.value === 'amanha' ? amanha : quando.value === 'sem' ? null : f.data || null;
}

async function salvar() {
  erro.value = '';
  const body = {
    titulo: f.titulo, notas: f.notas.trim() || null, area_id: f.area_id, prioridade: f.prioridade,
    data: dataFinal(), repeticao: f.repeticao, dias_semana: f.repeticao === 'semanal' ? f.dias_semana : null,
    fim: f.repeticao !== 'nenhuma' && f.fim ? f.fim : null, compartilhada: f.compartilhada, responsavel_id: f.responsavel_id,
  };
  try {
    if (t) await api.put(`/tarefas/${t.id}`, body); else await api.post('/tarefas', body);
    avisar(t ? 'Tarefa atualizada' : 'Tarefa criada');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function arquivar() {
  try {
    await api.put(`/tarefas/${t!.id}`, { ...t, arquivada: true, dias_semana: t!.dias_semana, notas: t!.notas });
    avisar('Tarefa arquivada');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function excluir() {
  if (!confirm(`Excluir "${t!.titulo}"? O histórico dela também some.`)) return;
  try {
    await api.del(`/tarefas/${t!.id}`);
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="t ? 'Editar tarefa' : 'Nova tarefa'" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <input v-model="f.titulo" class="titulo-grande" placeholder="O que precisa ser feito?" maxlength="200" required autofocus />

      <div class="campo">
        <span>Área</span>
        <div class="chips">
          <button v-for="a in tarefasEstado.areas" :key="a.id" type="button" :style="{ '--c': a.cor }" :aria-pressed="f.area_id === a.id"
            @click="f.area_id = f.area_id === a.id ? null : a.id">{{ a.nome }}</button>
        </div>
      </div>

      <div class="campo">
        <span>Repetir</span>
        <div class="segmentado">
          <button v-for="[v, r] in [['nenhuma', 'Não'], ['diaria', 'Todo dia'], ['semanal', 'Na semana'], ['mensal', 'Todo mês']]" :key="v" type="button"
            :aria-pressed="f.repeticao === v" @click="f.repeticao = v as Repeticao">{{ r }}</button>
        </div>
      </div>

      <div v-if="f.repeticao === 'semanal'" class="dias">
        <button v-for="(d, i) in DIAS" :key="d" type="button" :aria-pressed="f.dias_semana.includes(i)" @click="alternarDia(i)">{{ d }}</button>
      </div>

      <template v-if="f.repeticao === 'nenhuma'">
        <div class="campo">
          <span>Quando</span>
          <div class="segmentado">
            <button v-for="[v, r] in [['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['data', 'Escolher'], ['sem', 'Algum dia']]" :key="v" type="button"
              :aria-pressed="quando === v" @click="quando = v as typeof quando">{{ r }}</button>
          </div>
        </div>
        <label v-if="quando === 'data'" class="campo"><span>Data</span><input v-model="f.data" type="date" required /></label>
      </template>
      <div v-else class="linha">
        <label class="campo"><span>{{ f.repeticao === 'mensal' ? 'Primeira vez (define o dia do mês)' : 'Começa em' }}</span><input v-model="f.data" type="date" required /></label>
        <label class="campo"><span>Termina em</span><input v-model="f.fim" type="date" /><small>Em branco: sem fim</small></label>
      </div>

      <div class="linha">
        <div class="campo">
          <span>Prioridade</span>
          <div class="segmentado">
            <button v-for="[v, r] in [[1, 'Alta'], [2, 'Normal'], [3, 'Baixa']]" :key="v" type="button" :aria-pressed="f.prioridade === v" @click="f.prioridade = v as 1 | 2 | 3">{{ r }}</button>
          </div>
        </div>
        <label v-if="tarefasEstado.membros.length > 1" class="campo"><span>Responsável</span>
          <select v-model="f.responsavel_id">
            <option :value="null">Ninguém em específico</option>
            <option v-for="m in tarefasEstado.membros" :key="m.id" :value="m.id">{{ m.nome }}</option>
          </select>
        </label>
      </div>

      <label v-if="souDono && tarefasEstado.membros.length > 1" class="interruptor">
        <input v-model="f.compartilhada" type="checkbox" />
        <span><b>Tarefa da casa</b><small>Todos da casa veem e podem marcar como feita (limpeza, compras, contas).</small></span>
      </label>

      <label class="campo"><span>Anotações</span><textarea v-model="f.notas" rows="3" maxlength="4000" /></label>

      <p v-if="erro" class="erro-form" role="alert">{{ erro }}</p>
      <div class="acoes">
        <button v-if="t && souDono" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button v-if="t" class="btn" type="button" @click="arquivar">Arquivar</button>
        <button class="btn primario" type="submit">{{ t ? 'Salvar' : 'Criar tarefa' }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.titulo-grande { font-size: 1.15rem; font-weight: 600; min-height: 52px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips button {
  font: 600 0.85rem var(--fonte); padding: 7px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2);
}
.chips button[aria-pressed='true'] { background: color-mix(in srgb, var(--c) 16%, var(--surface)); border-color: var(--c); color: color-mix(in srgb, var(--c) 80%, var(--ink)); }
.dias { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.dias button { font: 600 0.8rem var(--fonte); padding: 9px 0; border-radius: var(--raio-s); border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2); cursor: pointer; }
.dias button[aria-pressed='true'] { background: var(--marca); border-color: var(--marca); color: var(--marca-ink); }
.interruptor { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: var(--raio-s); cursor: pointer; }
.interruptor input { width: 20px; height: 20px; min-height: 0; margin-top: 2px; accent-color: var(--marca); flex: none; }
.interruptor span { display: grid; gap: 2px; }
.interruptor small { color: var(--ink-3); font-size: 0.8rem; }
</style>

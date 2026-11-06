<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../../../core/api';
import { avisar, avisarMudanca, cadastros } from '../../../core/store';
import Modal from '../../../ui/Modal.vue';
import MoneyInput from '../../../ui/MoneyInput.vue';
import { TIPOS_META, type Membro, type Meta } from '../investir';

const props = defineProps<{ meta?: Meta | null }>();
const emit = defineEmits<{ fechar: [] }>();
const m = props.meta;
const CORES = ['#0f4b3a', '#13805a', '#2563eb', '#6d28d9', '#c23a5e', '#b46a00', '#0e7490', '#334155'];
const f = reactive({
  nome: m?.nome ?? '',
  tipo: m?.tipo ?? 'viagem',
  icone: m?.icone ?? TIPOS_META.viagem.icone,
  cor: m?.cor ?? CORES[0],
  valor_alvo_centavos: m?.valor_alvo_centavos ?? 0,
  data_alvo: m?.data_alvo ?? '',
  usuario_id: m?.usuario_id ?? null,
  arquivada: m?.arquivada ?? false,
  observacao: m?.observacao ?? '',
});
const ini = reactive({ guardado_inicial_centavos: 0, conta_origem_id: null as string | null });
const erro = ref('');
const membros = ref<Membro[]>([]);
api.get<Membro[]>('/membros').then((x) => { membros.value = x; }).catch(() => {});
const contas = computed(() => cadastros.contas.filter((c) => c.ativa));

// trocar o tipo troca o ícone sugerido, se o usuário não escolheu outro
watch(() => f.tipo, (t, antes) => { if (!f.icone || f.icone === TIPOS_META[antes]?.icone) f.icone = TIPOS_META[t].icone; });
const ICONES = ['✈️', '🏖️', '🐷', '📈', '🛟', '🏠', '🚗', '💍', '🎓', '🛍️', '💻', '🎯'];

async function salvar() {
  erro.value = '';
  if (f.valor_alvo_centavos <= 0) { erro.value = 'Quanto você quer juntar?'; return; }
  const corpo = { ...f, data_alvo: f.data_alvo || null, observacao: f.observacao || null, icone: f.icone || null };
  try {
    if (m) await api.put(`/metas/${m.id}`, corpo);
    else await api.post('/metas', { ...corpo, ...ini });
    avisar('Meta salva');
    avisarMudanca();
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function excluir() {
  if (!m || !confirm(`Excluir a meta "${m.nome}"? O que foi guardado direto nela volta para as contas de origem; investimentos vinculados continuam, só desvinculados.`)) return;
  try { await api.del(`/metas/${m.id}`); avisarMudanca(); emit('fechar'); } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="m ? 'Editar meta' : 'Nova meta'" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo"><span>Tipo</span>
          <select v-model="f.tipo"><option v-for="(t, k) in TIPOS_META" :key="k" :value="k">{{ t.icone }} {{ t.nome }}</option></select>
        </label>
        <label class="campo"><span>Nome</span><input v-model="f.nome" required maxlength="60" placeholder="Ex.: Viagem pro Chile, Cofrinho do carro" /></label>
      </div>
      <div class="linha">
        <label class="campo"><span>Quanto quer juntar</span><MoneyInput v-model="f.valor_alvo_centavos" grande /></label>
        <label class="campo"><span>Até quando (opcional)</span><input v-model="f.data_alvo" type="date" /></label>
      </div>
      <div class="campo">
        <span>Ícone e cor</span>
        <div class="escolhas">
          <button v-for="i in ICONES" :key="i" type="button" :class="['emoji', { sel: f.icone === i }]" :aria-pressed="f.icone === i" @click="f.icone = i">{{ i }}</button>
        </div>
        <div class="escolhas">
          <button v-for="c in CORES" :key="c" type="button" :class="['cor', { sel: f.cor === c }]" :style="{ background: c }" :aria-label="`Cor ${c}`" :aria-pressed="f.cor === c" @click="f.cor = c" />
        </div>
      </div>
      <label class="campo"><span>De quem é</span>
        <select v-model="f.usuario_id">
          <option :value="null">Da casa (os dois)</option>
          <option v-for="u in membros" :key="u.id" :value="u.id">{{ u.nome }}</option>
        </select>
      </label>
      <template v-if="!m">
        <div class="linha">
          <label class="campo"><span>Já tem algo guardado?</span><MoneyInput v-model="ini.guardado_inicial_centavos" /></label>
          <label v-if="ini.guardado_inicial_centavos > 0" class="campo"><span>Esse valor sai de uma conta?</span>
            <select v-model="ini.conta_origem_id">
              <option :value="null">Não, já estava separado</option>
              <option v-for="c in contas" :key="c.id" :value="c.id">Sim, sai de {{ c.nome }}</option>
            </select>
          </label>
        </div>
        <small class="suave miudo">Dinheiro guardado numa meta sai do saldo da conta (não entra no disponível), sem virar despesa. Investimentos podem ser ligados à meta depois.</small>
      </template>
      <label v-if="m" class="campo"><span>Situação</span>
        <select v-model="f.arquivada"><option :value="false">Ativa</option><option :value="true">Arquivada</option></select>
      </label>
      <label class="campo"><span>Observação</span><input v-model="f.observacao" maxlength="500" /></label>
      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button v-if="m" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit">Salvar meta</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.escolhas { display: flex; flex-wrap: wrap; gap: 6px; }
.emoji { width: 44px; height: 44px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--surface); font-size: 1.3rem; cursor: pointer; }
.emoji.sel { border-color: var(--marca); box-shadow: 0 0 0 2px var(--marca); }
.cor { width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--line-2); cursor: pointer; position: relative; }
.cor.sel { box-shadow: 0 0 0 2px var(--ink); }
@media (pointer: coarse) { .cor::after { content: ''; position: absolute; inset: -8px; } .escolhas:has(.cor) { gap: 14px; } }
</style>

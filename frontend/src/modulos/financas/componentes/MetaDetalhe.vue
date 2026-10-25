<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../../../core/api';
import { avisarMudanca, versao } from '../../../core/store';
import { dataBR, dinheiro } from '../../../core/format';
import Modal from '../../../ui/Modal.vue';
import type { Meta, MovMeta } from '../investir';

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ fechar: []; acao: [tipo: 'guardar' | 'retirar' | 'editar' | 'investir', meta: Meta] }>();
const d = ref<(Meta & { movimentos: MovMeta[] }) | null>(null);
const erro = ref('');
watch(versao, async () => {
  try { d.value = await api.get(`/metas/${props.id}`); } catch (e) { erro.value = (e as Error).message; }
}, { immediate: true });

async function apagar(id: string) {
  if (!confirm('Apagar este movimento? O efeito no saldo da conta é desfeito.')) return;
  try { await api.del(`/metas/${props.id}/movimentos/${id}`); avisarMudanca(); } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="d ? `${d.icone ?? ''} ${d.nome}` : 'Meta'" @fechar="emit('fechar')">
    <p v-if="erro" class="erro-form">{{ erro }}</p>
    <div v-if="d" class="det">
      <div class="progresso" :style="{ '--c': d.cor }"><i :style="{ width: d.pct + '%' }" /></div>
      <p class="resumo">
        <b>{{ dinheiro(d.guardado_centavos) }}</b> de {{ dinheiro(d.valor_alvo_centavos) }} ({{ d.pct.toLocaleString('pt-BR') }}%)
        <template v-if="d.concluida"> · meta atingida 🎉</template>
        <template v-else-if="d.data_alvo"> · até {{ dataBR(d.data_alvo) }}</template>
      </p>
      <div class="botoes">
        <button class="btn primario" @click="emit('acao', 'guardar', d)">Guardar</button>
        <button class="btn" :disabled="d.guardado_manual_centavos <= 0" @click="emit('acao', 'retirar', d)">Retirar</button>
        <button class="btn" @click="emit('acao', 'investir', d)">Investimentos da meta</button>
        <button class="btn link" @click="emit('acao', 'editar', d)">Editar</button>
      </div>

      <section v-if="d.investimentos.length" class="bloco">
        <h3>Em investimentos</h3>
        <ul class="lista painel">
          <li v-for="i in d.investimentos" :key="i.id" class="clicavel" @click="$router.push({ path: '/financas/investimentos' }); emit('fechar')">
            <span class="pin" :style="{ background: d.cor }" />
            <div><div class="titulo">{{ i.nome }}</div><div class="meta">rende junto com a meta</div></div>
            <div class="valor">{{ dinheiro(i.saldo_centavos) }}</div>
          </li>
        </ul>
      </section>

      <section class="bloco">
        <h3>Guardado direto ({{ dinheiro(d.guardado_manual_centavos) }})</h3>
        <ul v-if="d.movimentos.length" class="lista painel">
          <li v-for="m in d.movimentos" :key="m.id">
            <div>
              <div class="titulo">{{ m.descricao ?? (m.valor_centavos > 0 ? 'Guardado' : 'Retirado') }}</div>
              <div class="meta">{{ dataBR(m.data) }} · {{ m.conta_nome ? (m.valor_centavos > 0 ? `saiu de ${m.conta_nome}` : `voltou para ${m.conta_nome}`) : 'sem mexer em conta' }}</div>
            </div>
            <div :class="['valor', m.valor_centavos > 0 ? 'entra' : 'sai']">{{ m.valor_centavos > 0 ? '+' : '−' }} {{ dinheiro(Math.abs(m.valor_centavos)) }}</div>
            <button class="x" :aria-label="`Apagar movimento de ${dataBR(m.data)}`" @click="apagar(m.id)">×</button>
          </li>
        </ul>
        <p v-else class="painel vazio miudo">Nada guardado direto ainda.</p>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.det { display: grid; gap: 16px; min-width: 0; }
.progresso { --c: var(--marca); height: 12px; border-radius: 6px; background: var(--surface-3); overflow: hidden; }
.progresso i { display: block; height: 100%; background: var(--c); border-radius: 6px; }
.resumo b { font-size: 1.15rem; }
.botoes { display: flex; flex-wrap: wrap; gap: 8px; }
.bloco { display: grid; gap: 10px; }
h3 { font-size: 0.95rem; }
.lista li { grid-template-columns: minmax(0, 1fr) auto auto; }
.lista li.clicavel { grid-template-columns: auto minmax(0, 1fr) auto; }
.x { width: 32px; height: 32px; border: 0; background: transparent; color: var(--ink-3); font-size: 1.3rem; border-radius: 8px; cursor: pointer; position: relative; }
.x:hover { background: var(--surface-2); color: var(--sai); }
@media (pointer: coarse) { .x::after { content: ''; position: absolute; inset: -6px; } }
</style>

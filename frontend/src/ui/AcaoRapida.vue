<script setup lang="ts">
import { useRouter } from 'vue-router';
import { abrirLancamento, acaoRapida } from '../core/store';
import { I } from '../modulos';
import Modal from './Modal.vue';

const router = useRouter();
// cada atalho abre o formulário certo: as telas leem ?novo= e abrem o cadastro correspondente
const OPCOES = [
  { r: 'Gasto ou entrada', d: 'Débito, pix, cartão, salário', icone: I.financas, acao: () => abrirLancamento() },
  { r: 'Tarefa', d: 'Para hoje ou com data', icone: I.tarefas, acao: () => router.push({ path: '/tarefas', query: { novo: '1' } }) },
  { r: 'Anotação', d: 'Ideia, lista, lembrete', icone: I.notas, acao: () => router.push({ path: '/notas', query: { novo: '1' } }) },
  { r: 'Tempo de estudo', d: 'Registrar uma sessão', icone: I.estudos, acao: () => router.push({ path: '/estudos', query: { novo: 'sessao' } }) },
  { r: 'Treino de hoje', d: 'Abrir a ficha do dia', icone: I.saude, acao: () => router.push({ path: '/saude', query: { aba: 'academia' } }) },
  { r: 'Outro treino', d: 'Corrida, caminhada, bike', icone: I.saude, acao: () => router.push({ path: '/saude', query: { aba: 'treinos', novo: 'treino' } }) },
  { r: 'Peso', d: 'Nova medida', icone: I.saude, acao: () => router.push({ path: '/saude', query: { aba: 'medidas', novo: 'medida' } }) },
];
function escolher(o: (typeof OPCOES)[number]) {
  acaoRapida.aberta = false;
  o.acao();
}
</script>

<template>
  <Modal titulo="Adicionar" @fechar="acaoRapida.aberta = false">
    <div class="grade">
      <button v-for="o in OPCOES" :key="o.r" class="opcao" @click="escolher(o)">
        <span class="ico-op"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="o.icone" /></svg></span>
        <b>{{ o.r }}</b>
        <small>{{ o.d }}</small>
      </button>
    </div>
  </Modal>
</template>

<style scoped>
.grade { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.opcao {
  display: grid; justify-items: start; gap: 4px; text-align: left; padding: 14px; cursor: pointer;
  border: 1px solid var(--line-2); border-radius: var(--raio-m); background: var(--surface); color: var(--ink); font: inherit;
}
.opcao:hover { border-color: var(--marca); background: var(--marca-tint); }
.opcao b { font-weight: 650; }
.opcao small { color: var(--ink-3); font-size: 0.8rem; }
.ico-op { width: 36px; height: 36px; border-radius: 11px; background: var(--marca-tint); color: var(--marca-tint-ink); display: grid; place-items: center; margin-bottom: 4px; }
.ico-op svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
</style>

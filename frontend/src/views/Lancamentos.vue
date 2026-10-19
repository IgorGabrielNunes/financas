<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api, type Lancamento } from '../api';
import { abrirLancamento, cadastros, versao } from '../store';
import { dataCurta, dinheiro, hoje, MEIOS } from '../format';
import LancamentoLinha from '../components/LancamentoLinha.vue';

const h = hoje();
const filtro = reactive({ de: h.slice(0, 8) + '01', ate: '', meio: '', cartao_id: '', categoria_id: '', q: '' });
const itens = ref<Lancamento[]>([]);

let t: ReturnType<typeof setTimeout>;
async function carregar() {
  const qs = new URLSearchParams(Object.entries(filtro).filter(([, v]) => v) as [string, string][]);
  itens.value = await api.get<Lancamento[]>(`/lancamentos?${qs}`);
}
watch([filtro, versao], () => { clearTimeout(t); t = setTimeout(carregar, 200); }, { immediate: true, deep: true });

// agrupa por dia, como um extrato
const dias = computed(() => {
  const g = new Map<string, Lancamento[]>();
  for (const l of itens.value) g.set(l.data, [...(g.get(l.data) ?? []), l]);
  return [...g.entries()];
});
const totalSaidas = computed(() => itens.value.filter((l) => l.tipo === 'despesa').reduce((s, l) => s + l.valor_centavos, 0));
</script>

<template>
  <div class="pagina">
    <header class="cabecalho">
      <div>
        <h1>Lançamentos</h1>
        <p>{{ itens.length }} lançamentos, {{ dinheiro(totalSaidas) }} em saídas no filtro.</p>
      </div>
      <button class="btn primario" @click="abrirLancamento()">Novo lançamento</button>
    </header>

    <div class="painel recheado filtros">
      <label class="campo"><span>Buscar</span><input v-model="filtro.q" placeholder="descrição" /></label>
      <label class="campo"><span>De</span><input v-model="filtro.de" type="date" /></label>
      <label class="campo"><span>Até</span><input v-model="filtro.ate" type="date" /></label>
      <label class="campo"><span>Meio</span>
        <select v-model="filtro.meio"><option value="">Todos</option><option v-for="(n, k) in MEIOS" :key="k" :value="k">{{ n }}</option></select>
      </label>
      <label class="campo"><span>Cartão</span>
        <select v-model="filtro.cartao_id"><option value="">Todos</option><option v-for="c in cadastros.cartoes" :key="c.id" :value="c.id">{{ c.nome }}</option></select>
      </label>
      <label class="campo"><span>Categoria</span>
        <select v-model="filtro.categoria_id"><option value="">Todas</option><option v-for="c in cadastros.categorias" :key="c.id" :value="c.id">{{ c.nome }}</option></select>
      </label>
    </div>

    <section v-for="[dia, ls] in dias" :key="dia" class="secao">
      <header><h3>{{ dataCurta(dia) }}</h3></header>
      <ul class="lista painel">
        <LancamentoLinha v-for="l in ls" :key="l.id" :l="l" :mostrar-data="false" @confirmar="(x) => abrirLancamento(x.id, { status: 'realizado' })" />
      </ul>
    </section>
    <p v-if="!itens.length" class="painel vazio">Nada encontrado com esses filtros.</p>
  </div>
</template>

<style scoped>
.filtros { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
</style>

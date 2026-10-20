<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../core/api';
import { versao } from '../../core/store';
import { dataCurta, diasAte } from '../../core/format';
import EntidadeModal from '../../ui/EntidadeModal.vue';
import { camposProjeto, STATUS_PROJETO, TIPO_PROJETO } from './comum';
import { useRouter } from 'vue-router';

const router = useRouter();
const projetos = ref<any[]>([]);
const filtro = ref<string | null>(null);
const verArquivados = ref(false);
const erro = ref('');
const novo = ref(false);

async function carregar() {
  try { projetos.value = await api.get('/projetos'); } catch (e) { erro.value = (e as Error).message; }
}
onMounted(carregar);
watch(versao, carregar);

const visiveis = computed(() => projetos.value.filter((p) =>
  (!filtro.value || p.tipo === filtro.value) && (verArquivados.value ? p.status === 'arquivado' : p.status !== 'arquivado')));
const progresso = (p: any) => (p.cards_total ? Math.round((p.cards_feitos / p.cards_total) * 100) : 0);
const seloStatus = (s: string) => (s === 'andamento' ? 'previsto' : s === 'lancado' || s === 'concluido' ? 'paga' : '');
function criado(linha: any) { if (linha?.id) router.push(`/projetos/${linha.id}`); }
</script>

<template>
  <div class="pagina modulo">
    <header class="cabecalho">
      <div>
        <h1>Projetos</h1>
        <p>Projetos pessoais, sistemas e produtos que um dia vão gerar dinheiro.</p>
      </div>
      <button class="btn primario" @click="novo = true">Novo projeto</button>
    </header>

    <div class="filtros">
      <button :aria-pressed="!filtro" @click="filtro = null">Todos</button>
      <button v-for="(r, k) in TIPO_PROJETO" :key="k" :aria-pressed="filtro === k" @click="filtro = filtro === k ? null : k">{{ r }}</button>
      <label><input v-model="verArquivados" type="checkbox" /> Arquivados</label>
    </div>
    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <div v-if="visiveis.length" class="grade">
      <RouterLink v-for="p in visiveis" :key="p.id" :to="`/projetos/${p.id}`" class="projeto painel" :style="{ '--c': p.cor }">
        <header>
          <span class="tipo">{{ TIPO_PROJETO[p.tipo as keyof typeof TIPO_PROJETO] }}</span>
          <span :class="['selo', seloStatus(p.status)]">{{ STATUS_PROJETO[p.status as keyof typeof STATUS_PROJETO] }}</span>
        </header>
        <h2>{{ p.nome }}</h2>
        <p v-if="p.descricao" class="desc">{{ p.descricao }}</p>
        <div v-if="p.stack?.length" class="stack"><span v-for="s in p.stack.slice(0, 5)" :key="s">{{ s }}</span></div>
        <footer>
          <div class="medidor"><i :style="{ width: progresso(p) + '%', background: 'var(--c)' }" /></div>
          <div class="nums">
            <span>{{ p.cards_feitos }}/{{ p.cards_total }} cards</span>
            <span v-if="p.cards_fazendo">{{ p.cards_fazendo }} em andamento</span>
            <span v-if="p.bugs_abertos" class="sai">{{ p.bugs_abertos }} bug{{ p.bugs_abertos > 1 ? 's' : '' }}</span>
          </div>
          <div v-if="p.proximo_marco" class="marco">
            ◆ {{ p.proximo_marco.nome }}<template v-if="p.proximo_marco.data_alvo"> · {{ dataCurta(p.proximo_marco.data_alvo) }}
              <span v-if="diasAte(p.proximo_marco.data_alvo) < 0" class="sai">(atrasado)</span></template>
          </div>
        </footer>
      </RouterLink>
    </div>
    <div v-else class="vazio painel bloco">
      <b>{{ verArquivados ? 'Nada arquivado' : 'Nenhum projeto ainda' }}</b>
      <span v-if="!verArquivados">Coloque aquela ideia no papel: ela vira um quadro com cards e marcos.</span>
    </div>

    <EntidadeModal v-if="novo" titulo="Novo projeto" rota="/projetos" :campos="camposProjeto"
      :padrao="{ tipo: filtro ?? 'pessoal', status: 'ideia', cor: '#0f4b3a', stack: [] }" @fechar="novo = false" @salvo="criado" />
  </div>
</template>

<style scoped>
.filtros { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.filtros button { font: 600 0.82rem var(--fonte); padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2); cursor: pointer; }
.filtros button[aria-pressed='true'] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.filtros label { margin-left: auto; display: inline-flex; gap: 6px; align-items: center; font-size: 0.9rem; color: var(--ink-2); cursor: pointer; }
.filtros input { min-height: 0; width: 18px; height: 18px; accent-color: var(--marca); }
.grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 14px; }
.projeto { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; text-decoration: none; color: inherit; border-top: 4px solid var(--c); transition: box-shadow 0.15s; }
.projeto:hover { box-shadow: var(--sombra-flutuante); }
.projeto header { display: flex; justify-content: space-between; align-items: center; }
.tipo { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); font-weight: 650; }
.projeto h2 { margin: 0; font-size: 1.1rem; }
.desc { margin: 0; color: var(--ink-2); font-size: 0.875rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.stack { display: flex; flex-wrap: wrap; gap: 4px; }
.stack span { font-size: 0.75rem; padding: 2px 8px; border-radius: 6px; background: var(--surface-2); color: var(--ink-2); font-weight: 600; }
.projeto footer { margin-top: auto; display: grid; gap: 6px; padding-top: 6px; }
.nums { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.8rem; color: var(--ink-3); }
.marco { font-size: 0.8rem; color: var(--ink-2); font-weight: 550; }
@media (pointer: coarse) {
  .filtros button { min-height: 40px; padding: 8px 14px; }
}
</style>

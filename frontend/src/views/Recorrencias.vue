<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, type Recorrencia } from '../api';
import { versao } from '../store';
import { dinheiro, MEIOS, mesAno } from '../format';
import { useRouter } from 'vue-router';
import RecorrenciaForm from '../components/RecorrenciaForm.vue';

const itens = ref<Recorrencia[]>([]);
const router = useRouter();
const ORIGEM: Record<string, string> = { salario: 'do perfil', divida: 'da dívida', acordo: 'do acordo' };
// fixo vinculado é editado na origem (perfil/dívida), para não haver duas verdades
function abrir(r: Recorrencia) {
  if (r.origem === 'salario') return router.push('/pessoas');
  if (r.origem === 'divida') return router.push('/dividas');
  if (r.origem === 'acordo') return router.push('/dividas?aba=inadimplencia');
  form.value = { aberto: true, rec: r };
}
const form = ref<{ aberto: boolean; rec: Recorrencia | null; modelo?: any }>({ aberto: false, rec: null });
watch(versao, async () => { itens.value = await api.get<Recorrencia[]>('/recorrencias'); }, { immediate: true });

// Os fixos que quase todo mundo tem. Só aparecem os que ainda não foram cadastrados.
const MODELOS = [
  { descricao: 'Aluguel', tipo: 'despesa', dia_mes: 10, meio: 'pix', categoria: 'Moradia' },
  { descricao: 'Água', tipo: 'despesa', dia_mes: 15, meio: 'boleto', categoria: 'Contas da casa' },
  { descricao: 'Luz', tipo: 'despesa', dia_mes: 15, meio: 'boleto', categoria: 'Contas da casa' },
  { descricao: 'Internet', tipo: 'despesa', dia_mes: 20, meio: 'boleto', categoria: 'Contas da casa' },
];
const sugestoes = computed(() =>
  MODELOS.filter((m) => !itens.value.some((i) => i.descricao.toLowerCase() === m.descricao.toLowerCase())),
);

const receitas = computed(() => itens.value.filter((i) => i.tipo === 'receita'));
const despesas = computed(() => itens.value.filter((i) => i.tipo === 'despesa'));
const totalAtivo = (arr: Recorrencia[]) => arr.filter((i) => i.ativa).reduce((s, i) => s + i.valor_previsto_centavos, 0);
</script>

<template>
  <div class="pagina">
    <header class="cabecalho">
      <div>
        <h1>Fixos do mês</h1>
        <p>O que entra e sai todo mês. Cada fixo aparece no mês como previsto, e você confirma com o valor real. Salários vêm dos perfis em Pessoas; parcelas, de Dívidas.</p>
      </div>
      <button class="btn primario" @click="form = { aberto: true, rec: null }">Adicionar fixo</button>
    </header>

    <section v-if="sugestoes.length" class="secao">
      <header><h2>Comece por estes</h2></header>
      <div class="sugestoes">
        <button v-for="m in sugestoes" :key="m.descricao" class="btn" @click="form = { aberto: true, rec: null, modelo: m }">
          {{ m.descricao }}
        </button>
      </div>
    </section>

    <div class="grade-2">
      <section v-for="grupo in [{ t: 'Receitas', arr: receitas, cls: 'entra' }, { t: 'Despesas', arr: despesas, cls: '' }]" :key="grupo.t" class="secao">
        <header><h2>{{ grupo.t }}</h2><span>{{ dinheiro(totalAtivo(grupo.arr)) }} por mês</span></header>
        <ul v-if="grupo.arr.length" class="lista painel">
          <li v-for="r in grupo.arr" :key="r.id" class="clicavel" :class="{ inativa: !r.ativa }" @click="abrir(r)">
            <span class="dia">{{ r.dia_mes }}</span>
            <div>
              <div class="titulo">{{ r.descricao }}</div>
              <div class="meta">
                {{ r.meio === 'credito' ? r.cartao_nome : MEIOS[r.meio] }}<template v-if="r.categoria_nome">, {{ r.categoria_nome }}</template>
                <template v-if="r.fim">, até {{ mesAno(r.fim) }}</template>
                <span v-if="r.origem !== 'manual'" class="selo">{{ ORIGEM[r.origem] }}</span>
              </div>
            </div>
            <div :class="['valor', grupo.cls]">{{ dinheiro(r.valor_previsto_centavos) }}</div>
          </li>
        </ul>
        <p v-else class="painel vazio">Nenhum fixo cadastrado.</p>
      </section>
    </div>

    <RecorrenciaForm v-if="form.aberto" :recorrencia="form.rec" :modelo="form.modelo" @fechar="form.aberto = false" />
  </div>
</template>

<style scoped>
.sugestoes { display: flex; gap: 8px; flex-wrap: wrap; }
.dia { width: 32px; height: 32px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--line); display: grid; place-items: center; font-weight: 600; font-size: 0.8125rem; }
.inativa { opacity: 0.55; }
</style>

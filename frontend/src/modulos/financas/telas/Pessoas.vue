<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, type Pessoa } from '../../../core/api';
import { versao } from '../../../core/store';
import { dinheiro, pct, vezes } from '../../../core/format';
import PessoaForm from '../componentes/PessoaForm.vue';

const pessoas = ref<Pessoa[]>([]);
const form = ref<{ aberto: boolean; pessoa: Pessoa | null }>({ aberto: false, pessoa: null });
watch(versao, async () => { pessoas.value = await api.get<Pessoa[]>('/pessoas'); }, { immediate: true });

const rendaCasa = computed(() => pessoas.value.reduce((s, p) => s + (p.salario_centavos ?? 0), 0));
</script>

<template>
  <div class="pagina">
    <header class="cabecalho">
      <div>
        <h1>Pessoas</h1>
        <p v-if="pessoas.length">Renda líquida da casa: {{ dinheiro(rendaCasa) }} por mês.</p>
      </div>
      <button class="btn primario" @click="form = { aberto: true, pessoa: null }">Adicionar pessoa</button>
    </header>

    <div v-if="!pessoas.length" class="painel vazio">
      <h2>Crie um perfil para cada pessoa da casa</h2>
      <p>Com o salário de cada um, e cada conta e cartão ligado ao seu titular, os números de cada pessoa aparecem aqui.</p>
      <button class="btn primario" @click="form = { aberto: true, pessoa: null }">Adicionar pessoa</button>
    </div>

    <div class="perfis">
      <article v-for="p in pessoas" :key="p.id" class="perfil painel">
        <header :style="{ '--c': p.cor }">
          <div>
            <h2>{{ p.nome }}</h2>
            <p class="suave">{{ p.cargo || 'Cargo não informado' }}</p>
          </div>
          <div class="acoes">
            <RouterLink class="btn" :to="`/financas/pessoas/${p.id}`">Salário e férias</RouterLink>
            <button class="btn" @click="form = { aberto: true, pessoa: p }">Editar</button>
          </div>
        </header>

        <div class="salario">
          <span class="suave miudo">Salário líquido</span>
          <b>{{ p.salario_centavos ? dinheiro(p.salario_centavos) : 'Não informado' }}</b>
          <span v-if="p.dia_salario" class="suave miudo">todo dia {{ p.dia_salario }}{{ p.conta_salario_nome ? `, na ${p.conta_salario_nome}` : '' }}</span>
        </div>

        <dl>
          <div><dt>Cartões de crédito</dt><dd>{{ p.qtd_cartoes_credito }}</dd></div>
          <div><dt>Cartões de débito</dt><dd>{{ p.qtd_cartoes_debito }}</dd></div>
          <div><dt>Maior limite liberado</dt><dd>{{ dinheiro(p.maior_limite_centavos) }}</dd></div>
          <div><dt>Soma de todos os limites</dt><dd>{{ dinheiro(p.soma_limites_centavos) }}</dd></div>
          <div v-if="p.soma_limites_centavos && p.salario_centavos">
            <dt>Limite total em salários</dt>
            <dd :class="{ sai: p.soma_limites_centavos > p.salario_centavos * 2 }">{{ vezes(p.soma_limites_centavos / p.salario_centavos) }}</dd>
          </div>
          <div><dt>Dívidas ativas</dt><dd>{{ p.dividas_qtd ? `${p.dividas_qtd}, ${dinheiro(p.dividas_saldo_centavos)}` : 'Nenhuma' }}</dd></div>
          <div v-if="p.desconto_folha_centavos"><dt>Descontado em folha</dt><dd>{{ dinheiro(p.desconto_folha_centavos) }}/mês</dd></div>
          <div v-if="p.parcelas_mensais_centavos">
            <dt>Parcelas pagas pelo caixa</dt>
            <dd>{{ dinheiro(p.parcelas_mensais_centavos) }}/mês<template v-if="p.comprometimento_pct !== null">, {{ pct(p.comprometimento_pct) }} do salário</template></dd>
          </div>
          <div><dt>Inadimplência</dt><dd :class="{ sai: p.inadimplencias_qtd }">{{ p.inadimplencias_qtd ? `${p.inadimplencias_qtd}, ${dinheiro(p.inadimplencias_em_aberto_centavos)}` : 'Nenhuma' }}</dd></div>
        </dl>

        <div v-if="p.cartoes_credito.length || p.contas.length" class="titular">
          <span v-for="c in p.cartoes_credito" :key="c.id" class="chip"><i :style="{ background: c.cor }" />{{ c.nome }}</span>
          <span v-for="c in p.contas" :key="c.id" class="chip conta"><i :style="{ background: c.cor }" />{{ c.nome }}{{ c.cartao_debito ? ' (débito)' : '' }}</span>
        </div>
        <p v-else class="miudo suave">Nenhuma conta ou cartão com {{ p.nome }} como titular. Defina o titular ao editar a conta ou o cartão.</p>
      </article>
    </div>

    <PessoaForm v-if="form.aberto" :pessoa="form.pessoa" @fechar="form.aberto = false" />
  </div>
</template>

<style scoped>
.perfis { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); align-items: start; }
.perfil { overflow: hidden; }
.perfil > header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 18px; border-top: 5px solid var(--c); }
.perfil h2 { font-size: 1.5rem; }
.salario { display: grid; padding: 0 18px 14px; }
.salario b { font: 700 1.9rem var(--display); letter-spacing: -0.02em; }
dl { margin: 0; border-top: 1px solid var(--line); }
dl div { display: flex; justify-content: space-between; gap: 12px; padding: 9px 18px; border-bottom: 1px solid var(--line); font-size: 0.9rem; }
dt { color: var(--ink-2); }
dd { margin: 0; font-weight: 600; text-align: right; }
.titular { display: flex; flex-wrap: wrap; gap: 6px; padding: 14px 18px; }
.perfil > p { padding: 14px 18px; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8125rem; font-weight: 500; padding: 4px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); }
.chip i { width: 8px; height: 8px; border-radius: 2px; }
.chip.conta i { border-radius: 50%; }
</style>

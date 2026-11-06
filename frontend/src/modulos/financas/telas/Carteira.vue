<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, type Conta } from '../../../core/api';
import { versao } from '../../../core/store';
import { dinheiro } from '../../../core/format';
import ContaForm from '../componentes/ContaForm.vue';

const contas = ref<Conta[]>([]);
const form = ref<{ aberto: boolean; conta: Conta | null }>({ aberto: false, conta: null });
watch(versao, async () => { contas.value = await api.get<Conta[]>('/contas'); }, { immediate: true });

const TIPOS: Record<string, string> = { corrente: 'Conta corrente', poupanca: 'Poupança', carteira: 'Dinheiro em espécie', investimento: 'Reserva / investimento' };
const ativas = computed(() => contas.value.filter((c) => c.ativa));
const total = computed(() => ativas.value.filter((c) => c.conta_no_disponivel !== false).reduce((s, c) => s + c.saldo_centavos, 0));
const reservas = computed(() => ativas.value.filter((c) => c.conta_no_disponivel === false).reduce((s, c) => s + c.saldo_centavos, 0));
const investido = computed(() => ativas.value.reduce((s, c) => s + (c.investido_centavos ?? 0), 0));
</script>

<template>
  <div class="pagina">
    <header class="cabecalho">
      <div>
        <h1>Carteira</h1>
        <p v-if="ativas.length">
          {{ dinheiro(total) }} disponível nas contas.
          <template v-if="investido || reservas">
            Fora disso, {{ dinheiro(investido + reservas) }} em <RouterLink to="/financas/investimentos">investimentos</RouterLink><template v-if="reservas"> e reservas</template>.
          </template>
        </p>
      </div>
      <button class="btn primario" @click="form = { aberto: true, conta: null }">Adicionar conta</button>
    </header>

    <div v-if="!contas.length" class="painel vazio">
      <h2>Cadastre onde seu dinheiro está</h2>
      <p>Conta do salário, poupança, dinheiro em espécie. Informe o saldo de hoje; a partir daí o Caixa calcula pelos lançamentos.</p>
      <button class="btn primario" @click="form = { aberto: true, conta: null }">Adicionar conta</button>
    </div>

    <ul v-else class="lista painel">
      <li v-for="c in contas" :key="c.id" class="clicavel" :class="{ inativa: !c.ativa }" @click="form = { aberto: true, conta: c }">
        <span class="pin" :style="{ background: c.cor }" />
        <div>
          <div class="titulo">{{ c.nome }}</div>
          <div class="meta">
            {{ TIPOS[c.tipo] }}{{ c.ativa ? '' : ', inativa' }}<template v-if="c.conta_no_disponivel === false">, fora do disponível</template>
          </div>
        </div>
        <div class="valor">
          <span :class="{ sai: c.saldo_centavos < 0 }">{{ dinheiro(c.saldo_centavos) }}</span>
          <div v-if="c.investido_centavos" class="meta">+ {{ dinheiro(c.investido_centavos) }} investido</div>
          <div v-if="c.guardado_metas_centavos" class="meta">{{ dinheiro(c.guardado_metas_centavos) }} separado em metas</div>
        </div>
      </li>
    </ul>

    <p class="miudo suave">
      Saldo = saldo inicial + entradas confirmadas − saídas confirmadas (débito, pix, boleto, dinheiro) − faturas pagas pela conta
      − o que foi aplicado em investimentos ou guardado em metas a partir dela (+ resgates). O valor investido aparece embaixo e não soma no saldo.
      Contas do tipo investimento/reserva ficam fora do disponível. Se o saldo não bater com o banco, falta lançar alguma coisa.
    </p>

    <ContaForm v-if="form.aberto" :conta="form.conta" @fechar="form.aberto = false" />
  </div>
</template>

<style scoped>
.inativa { opacity: 0.55; }
</style>

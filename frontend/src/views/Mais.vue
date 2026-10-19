<script setup lang="ts">
import { setToken } from '../api';
const links = [
  { to: '/carteira', t: 'Carteira', d: 'Contas e saldos' },
  { to: '/pessoas', t: 'Pessoas', d: 'Perfis, salários e limites de cada um' },
  { to: '/dividas', t: 'Dívidas', d: 'Consignado, empréstimos e financiamentos' },
  { to: '/dividas?aba=inadimplencia', t: 'Em atraso', d: 'Inadimplência e acordos' },
  { to: '/fixos', t: 'Fixos do mês', d: 'O que entra e sai todo mês' },
  { to: '/lancamentos', t: 'Todos os lançamentos', d: 'Extrato com filtros' },
];
function sair() {
  setToken(null);
  location.assign('/login');
}
</script>

<template>
  <div class="pagina">
    <h1>Mais</h1>
    <ul class="lista painel">
      <li v-for="l in links" :key="l.to" class="clicavel" @click="$router.push(l.to)">
        <span class="pin" />
        <div><div class="titulo">{{ l.t }}</div><div class="meta">{{ l.d }}</div></div>
        <span class="suave" aria-hidden="true">›</span>
      </li>
    </ul>
    <button class="btn perigo" @click="sair">Sair</button>
  </div>
</template>

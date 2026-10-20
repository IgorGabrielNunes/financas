<script setup lang="ts">
import { setToken } from '../core/api';
import { sessao } from '../core/store';
import { I, MODULOS } from '../modulos';

// No celular a barra inferior só tem Início, Finanças, + e Tarefas: o resto mora aqui.
const modulos = MODULOS.filter((m) => m.id !== 'tarefas');
function sair() {
  setToken(null);
  sessao.eu = null;
  location.assign('/login');
}
</script>

<template>
  <div class="pagina modulo estreita">
    <header class="cabecalho"><div><h1>Mais</h1><p>{{ sessao.eu?.casa?.nome }}</p></div></header>

    <ul class="lista painel">
      <li v-for="m in modulos" :key="m.id" class="clicavel" @click="$router.push(m.base)">
        <span class="ico" style="--c: var(--marca)"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="m.icone" /></svg></span>
        <div><div class="titulo">{{ m.nome }}</div><div class="meta">{{ m.descricao }}</div></div>
        <span class="suave" aria-hidden="true">›</span>
      </li>
    </ul>

    <section v-if="MODULOS[0].itens" class="secao">
      <header><h2>Atalhos de Finanças</h2></header>
      <div class="atalhos">
        <RouterLink v-for="s in MODULOS[0].itens" :key="s.to" :to="s.to" class="btn">{{ s.r }}</RouterLink>
      </div>
    </section>

    <ul class="lista painel">
      <li class="clicavel" @click="$router.push('/conta')">
        <span class="ico" style="--c: var(--ink-3)"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="I.conta" /></svg></span>
        <div><div class="titulo">Minha conta</div><div class="meta">{{ sessao.eu?.email }}</div></div>
        <span class="suave" aria-hidden="true">›</span>
      </li>
      <li class="clicavel" @click="$router.push('/conta/avisos')">
        <span class="ico" style="--c: var(--ink-3)">🔔</span>
        <div><div class="titulo">Avisos</div><div class="meta">WhatsApp, Telegram e grupo da casa</div></div>
        <span class="suave" aria-hidden="true">›</span>
      </li>
      <li v-if="sessao.eu?.papel === 'admin'" class="clicavel" @click="$router.push('/conta/usuarios')">
        <span class="ico" style="--c: var(--ink-3)"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="I.pessoas" /></svg></span>
        <div><div class="titulo">Usuários da casa</div><div class="meta">Adicionar e gerenciar quem usa o Vida</div></div>
        <span class="suave" aria-hidden="true">›</span>
      </li>
    </ul>
    <button class="btn perigo" @click="sair">Sair</button>
  </div>
</template>

<style scoped>
.ico svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.secao > header h2 { font-size: 1rem; margin: 0; }
.atalhos { display: flex; flex-wrap: wrap; gap: 8px; }
</style>

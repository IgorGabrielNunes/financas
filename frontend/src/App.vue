<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { token, setToken } from './api';
import { abrirLancamento, cadastros, carregarCadastros, lancamentoModal, toast } from './store';
import LancamentoForm from './components/LancamentoForm.vue';

const route = useRoute();
const logado = computed(() => !!token.value && route.path !== '/login');

watch(logado, (v) => { if (v && !cadastros.carregado) carregarCadastros().catch(() => {}); }, { immediate: true });

const nav = [
  { to: '/', rotulo: 'Início', icone: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z' },
  { to: '/mes', rotulo: 'Mês', icone: 'M5 5h14v15H5zM5 9h14M9 3v4M15 3v4' },
  { to: '/cartoes', rotulo: 'Cartões', icone: 'M3 6h18v12H3zM3 10h18M7 15h4' },
  { to: '/carteira', rotulo: 'Carteira', icone: 'M4 7h15v12H4zM4 7l11-3v3M15 13h2', soDesktop: true },
  { to: '/pessoas', rotulo: 'Pessoas', icone: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M21 20c0-2.6-1.7-4.9-4-5.7', soDesktop: true },
  { to: '/dividas', rotulo: 'Dívidas', icone: 'M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2zM9 9h6M9 13h6', soDesktop: true },
  { to: '/mais', rotulo: 'Mais', icone: 'M5 12h.01M12 12h.01M19 12h.01', soCelular: true },
];
const ativo = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to));

function sair() {
  setToken(null);
  location.assign('/login');
}
</script>

<template>
  <div :class="['casca', { logado }]">
    <nav v-if="logado" class="nav" aria-label="Principal">
      <RouterLink to="/" class="marca">Caixa</RouterLink>
      <RouterLink v-for="n in nav.slice(0, 2)" :key="n.to" :to="n.to" :class="['item', { ativo: ativo(n.to) }]">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="n.icone" /></svg>{{ n.rotulo }}
      </RouterLink>
      <button class="lancar" @click="abrirLancamento()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        <span>Lançar</span>
      </button>
      <RouterLink v-for="n in nav.slice(2)" :key="n.to" :to="n.to" :class="['item', { ativo: ativo(n.to), 'so-desktop': n.soDesktop, 'so-celular': n.soCelular }]">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="n.icone" /></svg>{{ n.rotulo }}
      </RouterLink>
      <div class="extra">
        <RouterLink to="/lancamentos" :class="['item', { ativo: ativo('/lancamentos') }]">Todos os lançamentos</RouterLink>
        <RouterLink to="/fixos" :class="['item', { ativo: ativo('/fixos') }]">Fixos do mês</RouterLink>
        <button class="item sair" @click="sair">Sair</button>
      </div>
    </nav>

    <main><RouterView /></main>

    <LancamentoForm v-if="lancamentoModal.aberto" />

    <div v-if="toast.msg" :class="['toast', toast.tipo]" role="status">{{ toast.msg }}</div>
  </div>
</template>

<style scoped>
.casca.logado { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
.nav {
  position: sticky; top: 0; height: 100vh; background: var(--ink); color: var(--bg);
  display: flex; flex-direction: column; gap: 2px; padding: 22px 14px;
}
@media (prefers-color-scheme: dark) { .nav { background: #0b1312; color: var(--ink); } }
.marca { font: 700 1.6rem var(--display); text-decoration: none; padding: 0 10px 18px; letter-spacing: -0.02em; }
.item {
  display: flex; gap: 10px; align-items: center; padding: 10px; border-radius: var(--raio-s);
  text-decoration: none; font-weight: 500; color: inherit; opacity: 0.72; background: none; border: 0; font-size: 0.95rem; cursor: pointer; text-align: left;
}
.item:hover, .item.ativo { opacity: 1; background: rgba(255, 255, 255, 0.08); }
.item svg, .lancar svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
.lancar {
  order: -1; margin: 0 0 14px; display: flex; gap: 8px; align-items: center; justify-content: center;
  font: 600 0.95rem var(--texto); padding: 11px; border-radius: var(--raio-s); border: 0; cursor: pointer;
  background: var(--bg); color: var(--ink);
}
.nav .marca { order: -2; }
.extra { margin-top: auto; display: grid; gap: 2px; border-top: 1px solid rgba(255, 255, 255, 0.12); padding-top: 12px; }
.extra .item { font-size: 0.875rem; }
.so-celular { display: none; }

/* ---------- celular: navegação inferior, "Lançar" no centro, ao alcance do polegar ---------- */
@media (max-width: 760px) {
  .casca.logado { display: block; }
  .nav {
    position: fixed; top: auto; bottom: 0; left: 0; right: 0; height: auto; z-index: 20;
    flex-direction: row; justify-content: space-around; align-items: center;
    padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
  }
  .marca, .extra, .so-desktop { display: none; }
  .so-celular { display: flex; }
  .item { flex-direction: column; gap: 2px; font-size: 0.7rem; padding: 6px 4px; flex: 1; justify-content: center; text-align: center; }
  .item:hover, .item.ativo { background: none; }
  .lancar { order: 0; margin: -22px 4px 0; width: 58px; height: 58px; border-radius: 50%; padding: 0; flex: none; box-shadow: 0 6px 16px rgba(0,0,0,.25); }
  .lancar span { display: none; }
  .lancar svg { width: 26px; height: 26px; }
}

.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 60;
  background: var(--ink); color: var(--bg); padding: 12px 18px; border-radius: var(--raio-s); font-weight: 500; max-width: calc(100vw - 32px);
}
.toast.erro { background: var(--sai); color: #fff; }
@media (max-width: 760px) { .toast { bottom: 96px; } }
</style>

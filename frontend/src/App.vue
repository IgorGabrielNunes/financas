<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { token, setToken } from './api';
import { abrirLancamento, cadastros, carregarCadastros, lancamentoModal, toast } from './store';
import LancamentoForm from './components/LancamentoForm.vue';

const route = useRoute();
const logado = computed(() => !!token.value && route.path !== '/login');

watch(logado, (v) => { if (v && !cadastros.carregado) carregarCadastros().catch(() => {}); }, { immediate: true });

const I = {
  inicio: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
  mes: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8.5 3v4M15.5 3v4',
  lanc: 'M5 6h14M5 12h14M5 18h9',
  cartoes: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5zM3 10.5h18M7 15h3',
  carteira: 'M4 8a2 2 0 0 1 2-2h12v3M4 8v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-1zM16 14.5h1.5',
  fixos: 'M4 12a8 8 0 0 1 14-5.3M20 5v4h-4M20 12a8 8 0 0 1-14 5.3M4 19v-4h4',
  pessoas: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.2a3.5 3.5 0 0 1 0 6.6M18.5 14.8c1.7.8 2.8 2.6 3 5.2',
  dividas: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9.5 8h5M9.5 12h5',
  mais: 'M5 12h.01M12 12h.01M19 12h.01',
};

const grupos = [
  { titulo: null, itens: [
    { to: '/', rotulo: 'Início', icone: I.inicio },
    { to: '/mes', rotulo: 'Mês', icone: I.mes },
    { to: '/lancamentos', rotulo: 'Lançamentos', icone: I.lanc },
  ] },
  { titulo: 'Dinheiro', itens: [
    { to: '/cartoes', rotulo: 'Cartões', icone: I.cartoes },
    { to: '/carteira', rotulo: 'Carteira', icone: I.carteira },
    { to: '/fixos', rotulo: 'Fixos do mês', icone: I.fixos },
  ] },
  { titulo: 'Casa', itens: [
    { to: '/pessoas', rotulo: 'Pessoas', icone: I.pessoas },
    { to: '/dividas', rotulo: 'Dívidas', icone: I.dividas },
  ] },
];
const navCelular = [
  { to: '/', rotulo: 'Início', icone: I.inicio },
  { to: '/mes', rotulo: 'Mês', icone: I.mes },
  null, // botão Lançar
  { to: '/cartoes', rotulo: 'Cartões', icone: I.cartoes },
  { to: '/mais', rotulo: 'Mais', icone: I.mais },
];
const ativo = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to));
const maisAtivo = computed(() => ['/mais', '/carteira', '/fixos', '/pessoas', '/dividas', '/lancamentos'].some((p) => route.path.startsWith(p)));

function sair() {
  setToken(null);
  location.assign('/login');
}
</script>

<template>
  <div :class="['casca', { logado }]">
    <!-- ------------------------------------------------ menu lateral (computador) -->
    <aside v-if="logado" class="lateral" aria-label="Principal">
      <RouterLink to="/" class="marca">
        <span class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M6 15.5c1.6 1.6 3.6 2.5 6 2.5 4.4 0 8-3.6 8-8M4 10a8 8 0 0 1 13.7-5.6" /><path d="M12 7v6l3 2" /></svg>
        </span>
        Caixa
      </RouterLink>

      <button class="lancar" @click="abrirLancamento()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Lançar gasto ou entrada
      </button>

      <nav class="grupos">
        <div v-for="(g, gi) in grupos" :key="gi" class="grupo">
          <p v-if="g.titulo" class="rotulo-grupo">{{ g.titulo }}</p>
          <RouterLink v-for="n in g.itens" :key="n.to" :to="n.to" :class="['item', { ativo: ativo(n.to) }]">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="n.icone" /></svg>{{ n.rotulo }}
          </RouterLink>
        </div>
      </nav>

      <button class="item sair" @click="sair">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4" /></svg>Sair
      </button>
    </aside>

    <main><RouterView /></main>

    <!-- ------------------------------------------- barra inferior (celular) -->
    <nav v-if="logado" class="inferior" aria-label="Principal">
      <template v-for="(n, i) in navCelular" :key="i">
        <button v-if="!n" class="lancar-cel" aria-label="Lançar gasto ou entrada" @click="abrirLancamento()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <RouterLink v-else :to="n.to" :class="['aba', { ativo: n.to === '/mais' ? maisAtivo : ativo(n.to) }]">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="n.icone" /></svg>{{ n.rotulo }}
        </RouterLink>
      </template>
    </nav>

    <LancamentoForm v-if="lancamentoModal.aberto" />

    <Transition name="toast">
      <div v-if="toast.msg" :class="['toast', toast.tipo]" role="status">{{ toast.msg }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.casca.logado {
  display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh;
  /* a faixa do menu acompanha a página inteira, não só a altura da tela */
  background: linear-gradient(90deg, var(--surface) 0 247px, var(--line) 247px 248px, transparent 248px);
}

svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

/* --------------------------------------------------------------- lateral */
.lateral {
  position: sticky; top: 0; height: 100vh; overflow-y: auto;
  display: flex; flex-direction: column; gap: 18px; padding: 22px 14px 16px;
  background: var(--surface); border-right: 1px solid var(--line);
  align-self: start;
}
.marca { display: flex; align-items: center; gap: 10px; padding: 0 8px; text-decoration: none; font-size: 1.25rem; font-weight: 750; letter-spacing: -0.03em; }
.logo { width: 34px; height: 34px; border-radius: 10px; background: var(--marca); color: var(--marca-ink); display: grid; place-items: center; }
.logo svg { width: 20px; height: 20px; stroke-width: 2.2; }

.lancar {
  display: flex; gap: 8px; align-items: center; justify-content: center; min-height: 44px;
  font: 600 0.9rem var(--fonte); border: 0; border-radius: var(--raio-s); cursor: pointer;
  background: var(--marca); color: var(--marca-ink);
}
.lancar:hover { background: color-mix(in srgb, var(--marca) 88%, #000); }
.lancar svg { width: 18px; height: 18px; stroke-width: 2.2; }

.grupos { display: grid; gap: 16px; }
.grupo { display: grid; gap: 2px; }
.rotulo-grupo { font-size: 0.75rem; font-weight: 600; color: var(--ink-3); padding: 0 10px 4px; }
.item {
  display: flex; gap: 11px; align-items: center; padding: 9px 10px; border-radius: var(--raio-s);
  text-decoration: none; font: 500 0.925rem var(--fonte); color: var(--ink-2); background: none; border: 0; cursor: pointer; text-align: left;
}
.item svg { width: 20px; height: 20px; flex: none; }
.item:hover { background: var(--surface-2); color: var(--ink); }
.item.ativo { background: var(--marca-tint); color: var(--marca-tint-ink); font-weight: 600; }
.sair { margin-top: auto; }

/* --------------------------------------------------------------- inferior */
.inferior { display: none; }

@media (max-width: 860px) {
  .casca.logado { display: block; background: none; }
  .lateral { display: none; }
  .inferior {
    display: grid; grid-template-columns: repeat(5, 1fr); align-items: end;
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
    padding: 6px 6px calc(8px + env(safe-area-inset-bottom));
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--line);
  }
  .aba {
    display: grid; justify-items: center; gap: 3px; padding: 6px 2px; text-decoration: none;
    font-size: 0.7rem; font-weight: 600; color: var(--ink-3);
  }
  .aba svg { width: 23px; height: 23px; }
  .aba.ativo { color: var(--marca-tint-ink); }
  .lancar-cel {
    justify-self: center; width: 56px; height: 56px; margin-top: -24px; border: 0; border-radius: 18px; cursor: pointer;
    background: var(--marca); color: var(--marca-ink); display: grid; place-items: center; box-shadow: var(--sombra-flutuante);
  }
  .lancar-cel svg { width: 26px; height: 26px; stroke-width: 2.2; }
}

/* ------------------------------------------------------------------ toast */
.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 60;
  background: var(--ink); color: var(--bg); padding: 12px 18px; border-radius: var(--raio-s); font-weight: 600;
  max-width: calc(100vw - 32px); box-shadow: var(--sombra-flutuante);
}
.toast.erro { background: var(--sai); color: #fff; }
.toast-enter-active, .toast-leave-active { transition: opacity 0.18s, transform 0.18s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 8px); }
@media (max-width: 860px) { .toast { bottom: 100px; } }
</style>

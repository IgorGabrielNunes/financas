<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { token, setToken } from './core/api';
import { acaoRapida, cadastros, carregarCadastros, carregarEu, lancamentoModal, sessao, toast } from './core/store';
import { I, MODULOS } from './modulos';
import { router } from './router';
import LancamentoForm from './modulos/financas/componentes/LancamentoForm.vue';
import AcaoRapida from './ui/AcaoRapida.vue';

const route = useRoute();
const logado = computed(() => !!token.value && route.path !== '/login');

watch(logado, async (v) => {
  if (!v) return;
  if (!cadastros.carregado) carregarCadastros().catch(() => {});
  if (!sessao.eu) {
    const eu = await carregarEu().catch(() => null);
    if (eu?.trocar_senha && route.path !== '/conta') router.replace({ path: '/conta', query: { trocar: '1' } });
  }
}, { immediate: true });

const ativo = (to: string) => (to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(to + '/'));
const moduloAtivo = (base: string) => route.path === base || route.path.startsWith(base + '/');
// submenu de Finanças aberto quando está nele (ou quando o usuário abre)
const abertos = ref<Record<string, boolean>>({});
const expandido = (id: string, base: string) => abertos.value[id] ?? moduloAtivo(base);

const navCelular = [
  { to: '/', r: 'Início', icone: I.inicio },
  { to: '/financas', r: 'Finanças', icone: I.financas },
  null,
  { to: '/tarefas', r: 'Tarefas', icone: I.tarefas },
  { to: '/mais', r: 'Mais', icone: I.mais },
];
const abaAtiva = (to: string) => {
  if (to === '/mais') return ['/mais', '/notas', '/estudos', '/saude', '/projetos', '/profissional', '/conta'].some((p) => route.path.startsWith(p));
  return to === '/' ? route.path === '/' : moduloAtivo(to);
};

function sair() {
  setToken(null);
  sessao.eu = null;
  location.assign('/login');
}
</script>

<template>
  <div :class="['casca', { logado }]">
    <!-- ------------------------------------------------ menu lateral (computador) -->
    <aside v-if="logado" class="lateral" aria-label="Principal">
      <RouterLink to="/" class="marca">
        <span class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 12.5c2.2 0 3-4.5 5-4.5s2.5 8 5 8 2.5-4 4-4" /></svg>
        </span>
        Vida
      </RouterLink>

      <button class="adicionar" @click="acaoRapida.aberta = true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Adicionar
      </button>

      <nav class="grupos">
        <RouterLink to="/" :class="['item', { ativo: ativo('/') }]">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="I.inicio" /></svg>Início
        </RouterLink>
        <template v-for="m in MODULOS" :key="m.id">
          <template v-if="m.itens">
            <button :class="['item', { 'modulo-ativo': moduloAtivo(m.base) }]" :aria-expanded="expandido(m.id, m.base)"
              @click="abertos[m.id] = !expandido(m.id, m.base)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="m.icone" /></svg>{{ m.nome }}
              <svg class="seta" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
            <div v-show="expandido(m.id, m.base)" class="sub">
              <RouterLink v-for="s in m.itens" :key="s.to" :to="s.to" :class="['item', { ativo: ativo(s.to) }]">{{ s.r }}</RouterLink>
            </div>
          </template>
          <RouterLink v-else :to="m.base" :class="['item', { ativo: moduloAtivo(m.base) }]">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="m.icone" /></svg>{{ m.nome }}
          </RouterLink>
        </template>
      </nav>

      <div class="rodape">
        <RouterLink to="/conta" :class="['item', { ativo: route.path === '/conta' }]">
          <span class="avatar" aria-hidden="true">{{ sessao.eu?.nome?.slice(0, 1) ?? '?' }}</span>
          <span class="quem">{{ sessao.eu?.nome?.split(' ')[0] ?? 'Minha conta' }}<small>{{ sessao.eu?.casa?.nome }}</small></span>
        </RouterLink>
        <RouterLink to="/conta/avisos" :class="['item', 'pequeno', { ativo: ativo('/conta/avisos') }]">Avisos no WhatsApp</RouterLink>
        <RouterLink v-if="sessao.eu?.papel === 'admin'" to="/conta/usuarios" :class="['item', 'pequeno', { ativo: ativo('/conta/usuarios') }]">Usuários da casa</RouterLink>
        <button class="item pequeno" @click="sair">Sair</button>
      </div>
    </aside>

    <main><RouterView /></main>

    <!-- ------------------------------------------- barra inferior (celular) -->
    <nav v-if="logado" class="inferior" aria-label="Principal">
      <template v-for="(n, i) in navCelular" :key="i">
        <button v-if="!n" class="mais-cel" aria-label="Adicionar" @click="acaoRapida.aberta = true">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <RouterLink v-else :to="n.to" :class="['aba', { ativo: abaAtiva(n.to) }]">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="n.icone" /></svg>{{ n.r }}
        </RouterLink>
      </template>
    </nav>

    <AcaoRapida v-if="acaoRapida.aberta" />
    <LancamentoForm v-if="lancamentoModal.aberto" />

    <Transition name="toast">
      <div v-if="toast.msg" :class="['toast', toast.tipo]" role="status">{{ toast.msg }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.casca.logado {
  display: grid; grid-template-columns: 252px minmax(0, 1fr); min-height: 100vh;
  background: linear-gradient(90deg, var(--surface) 0 251px, var(--line) 251px 252px, transparent 252px);
}
svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

.lateral {
  position: sticky; top: 0; height: 100vh; overflow-y: auto; align-self: start;
  display: flex; flex-direction: column; gap: 16px; padding: 20px 14px 14px;
}
.marca { display: flex; align-items: center; gap: 10px; padding: 0 8px; text-decoration: none; font-size: 1.3rem; font-weight: 750; letter-spacing: -0.03em; }
.logo { width: 34px; height: 34px; border-radius: 10px; background: var(--marca); color: var(--marca-ink); display: grid; place-items: center; }
.logo svg { width: 22px; height: 22px; stroke-width: 2.2; }

.adicionar {
  display: flex; gap: 8px; align-items: center; justify-content: center; min-height: 44px;
  font: 600 0.9rem var(--fonte); border: 0; border-radius: var(--raio-s); cursor: pointer; background: var(--marca); color: var(--marca-ink);
}
.adicionar:hover { background: color-mix(in srgb, var(--marca) 88%, #000); }
.adicionar svg { width: 18px; height: 18px; stroke-width: 2.2; }

.grupos { display: grid; gap: 2px; }
.item {
  display: flex; gap: 11px; align-items: center; padding: 8px 10px; border-radius: var(--raio-s); width: 100%;
  text-decoration: none; font: 500 0.925rem var(--fonte); color: var(--ink-2); background: none; border: 0; cursor: pointer; text-align: left;
}
.item svg { width: 20px; height: 20px; flex: none; }
.item:hover { background: var(--surface-2); color: var(--ink); }
.item.ativo { background: var(--marca-tint); color: var(--marca-tint-ink); font-weight: 600; }
.item.modulo-ativo { color: var(--ink); font-weight: 600; }
.seta { margin-left: auto; width: 16px !important; height: 16px !important; transition: transform 0.15s; }
[aria-expanded='true'] .seta { transform: rotate(90deg); }
.sub { display: grid; gap: 1px; margin: 2px 0 6px 20px; padding-left: 12px; border-left: 1px solid var(--line); }
.sub .item { padding: 7px 10px; font-size: 0.875rem; }

.rodape { margin-top: auto; display: grid; gap: 2px; border-top: 1px solid var(--line); padding-top: 10px; }
.avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--marca-tint); color: var(--marca-tint-ink); display: grid; place-items: center; font-weight: 700; flex: none; }
.quem { display: grid; line-height: 1.2; min-width: 0; }
.quem small { color: var(--ink-3); font-size: 0.75rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item.pequeno { font-size: 0.85rem; padding: 7px 10px; }

.inferior { display: none; }
@media (max-width: 860px) {
  .casca.logado { display: block; background: none; }
  .lateral { display: none; }
  .inferior {
    display: grid; grid-template-columns: repeat(5, 1fr); align-items: end;
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
    padding: 6px 6px calc(8px + env(safe-area-inset-bottom));
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-top: 1px solid var(--line);
  }
  .aba { display: grid; justify-items: center; gap: 3px; padding: 6px 2px; text-decoration: none; font-size: 0.7rem; font-weight: 600; color: var(--ink-3); }
  .aba svg { width: 23px; height: 23px; }
  .aba.ativo { color: var(--marca-tint-ink); }
  .mais-cel {
    justify-self: center; width: 56px; height: 56px; margin-top: -24px; border: 0; border-radius: 18px; cursor: pointer;
    background: var(--marca); color: var(--marca-ink); display: grid; place-items: center; box-shadow: var(--sombra-flutuante);
  }
  .mais-cel svg { width: 26px; height: 26px; stroke-width: 2.2; }
}

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

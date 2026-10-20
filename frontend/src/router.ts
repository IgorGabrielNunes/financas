import { createRouter, createWebHistory } from 'vue-router';
import { token } from './core/api';
import { sessao } from './core/store';
import { MODULOS } from './modulos';

// rotas antigas (antes dos módulos) continuam funcionando: favoritos e links salvos não quebram
const LEGADO = ['mes', 'lancamentos', 'cartoes', 'faturas', 'carteira', 'fixos', 'pessoas', 'dividas'];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./modulos/conta/Login.vue'), meta: { publica: true } },
    { path: '/', component: () => import('./inicio/Inicio.vue') },
    { path: '/mais', component: () => import('./inicio/Mais.vue') },
    { path: '/conta', component: () => import('./modulos/conta/MinhaConta.vue') },
    { path: '/conta/usuarios', component: () => import('./modulos/conta/Usuarios.vue') },
    ...MODULOS.flatMap((m) => m.rotas),
    ...LEGADO.map((r) => ({ path: `/${r}/:resto(.*)*`, redirect: (to: any) => `/financas${to.fullPath}` })),
    { path: '/:p(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  if (!to.meta.publica && !token.value) return '/login';
  if (to.path === '/login' && token.value) return '/';
  // senha temporária: obriga a trocar antes de usar o sistema
  if (sessao.eu?.trocar_senha && to.path !== '/conta') return { path: '/conta', query: { trocar: '1' } };
});

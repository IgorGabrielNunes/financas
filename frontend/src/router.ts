import { createRouter, createWebHistory } from 'vue-router';
import { token } from './api';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/Login.vue'), meta: { publica: true } },
    { path: '/', component: () => import('./views/Inicio.vue') },
    { path: '/mes/:ano?/:mes?', component: () => import('./views/Mes.vue') },
    { path: '/lancamentos', component: () => import('./views/Lancamentos.vue') },
    { path: '/cartoes', component: () => import('./views/Cartoes.vue') },
    { path: '/cartoes/:id', component: () => import('./views/CartaoDetalhe.vue') },
    { path: '/faturas/:id', component: () => import('./views/FaturaDetalhe.vue') },
    { path: '/carteira', component: () => import('./views/Carteira.vue') },
    { path: '/fixos', component: () => import('./views/Recorrencias.vue') },
    { path: '/pessoas', component: () => import('./views/Pessoas.vue') },
    { path: '/pessoas/:id', component: () => import('./views/PessoaDetalhe.vue') },
    { path: '/dividas', component: () => import('./views/Dividas.vue') },
    { path: '/mais', component: () => import('./views/Mais.vue') },
    { path: '/:p(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  if (!to.meta.publica && !token.value) return '/login';
  if (to.path === '/login' && token.value) return '/';
});

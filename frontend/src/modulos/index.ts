// Registro dos módulos no front: menu lateral, menu "Mais" e rotas saem daqui.
// Módulo novo = uma pasta em modulos/ + uma entrada nesta lista.
import type { RouteRecordRaw } from 'vue-router';

export type ItemMenu = { to: string; r: string; icone: string };
export type Modulo = { id: string; nome: string; icone: string; base: string; itens?: ItemMenu[]; rotas: RouteRecordRaw[]; descricao: string };

export const I = {
  inicio: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
  financas: 'M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5zM4 10h16M14 14.5h3',
  mes: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8.5 3v4M15.5 3v4',
  lanc: 'M5 6h14M5 12h14M5 18h9',
  cartoes: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5zM3 10.5h18M7 15h3',
  carteira: 'M4 8a2 2 0 0 1 2-2h12v3M4 8v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-1zM16 14.5h1.5',
  fixos: 'M4 12a8 8 0 0 1 14-5.3M20 5v4h-4M20 12a8 8 0 0 1-14 5.3M4 19v-4h4',
  pessoas: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.2a3.5 3.5 0 0 1 0 6.6M18.5 14.8c1.7.8 2.8 2.6 3 5.2',
  dividas: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9.5 8h5M9.5 12h5',
  tarefas: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  notas: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5',
  estudos: 'M3 8.5 12 4l9 4.5-9 4.5zM7 10.5V15c1.5 1.4 3.2 2 5 2s3.5-.6 5-2v-4.5M21 8.5V14',
  saude: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10zM8.5 11h2l1-2 1.5 4 1-2h1.5',
  projetos: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z',
  profissional: 'M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4 12.5h16',
  conta: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 21c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5',
  mais: 'M5 12h.01M12 12h.01M19 12h.01',
};

const F = (n: string) => () => import(`./financas/telas/${n}.vue`);

export const MODULOS: Modulo[] = [
  {
    id: 'financas', nome: 'Finanças', icone: I.financas, base: '/financas', descricao: 'Contas, cartões, fixos, salários e dívidas',
    itens: [
      { to: '/financas/painel', r: 'Visão geral', icone: I.inicio },
      { to: '/financas/mes', r: 'Visão do mês', icone: I.mes },
      { to: '/financas/lancamentos', r: 'Lançamentos', icone: I.lanc },
      { to: '/financas/cartoes', r: 'Cartões', icone: I.cartoes },
      { to: '/financas/carteira', r: 'Carteira', icone: I.carteira },
      { to: '/financas/fixos', r: 'Fixos do mês', icone: I.fixos },
      { to: '/financas/pessoas', r: 'Pessoas e salários', icone: I.pessoas },
      { to: '/financas/dividas', r: 'Dívidas', icone: I.dividas },
    ],
    rotas: [
      { path: '/financas', redirect: '/financas/painel' },
      { path: '/financas/painel', component: F('Painel') },
      { path: '/financas/mes/:ano?/:mes?', component: F('Mes') },
      { path: '/financas/lancamentos', component: F('Lancamentos') },
      { path: '/financas/cartoes', component: F('Cartoes') },
      { path: '/financas/cartoes/:id', component: F('CartaoDetalhe') },
      { path: '/financas/faturas/:id', component: F('FaturaDetalhe') },
      { path: '/financas/carteira', component: F('Carteira') },
      { path: '/financas/fixos', component: F('Recorrencias') },
      { path: '/financas/pessoas', component: F('Pessoas') },
      { path: '/financas/pessoas/:id', component: F('PessoaDetalhe') },
      { path: '/financas/dividas', component: F('Dividas') },
    ],
  },
  { id: 'tarefas', nome: 'Tarefas', icone: I.tarefas, base: '/tarefas', descricao: 'O que fazer hoje e o que já foi feito',
    rotas: [{ path: '/tarefas', component: () => import('./tarefas/Tarefas.vue') }] },
  { id: 'notas', nome: 'Anotações', icone: I.notas, base: '/notas', descricao: 'Ideias, listas e lembretes',
    rotas: [{ path: '/notas', component: () => import('./notas/Notas.vue') }] },
  { id: 'estudos', nome: 'Estudos', icone: I.estudos, base: '/estudos', descricao: 'Faculdade, cursos, horas e livros',
    rotas: [{ path: '/estudos', component: () => import('./estudos/Estudos.vue') }] },
  { id: 'saude', nome: 'Saúde', icone: I.saude, base: '/saude', descricao: 'Consultas, remédios, peso e treinos',
    rotas: [{ path: '/saude', component: () => import('./saude/Saude.vue') }] },
  { id: 'projetos', nome: 'Projetos', icone: I.projetos, base: '/projetos', descricao: 'Projetos pessoais, software e produtos',
    rotas: [
      { path: '/projetos', component: () => import('./projetos/Projetos.vue') },
      { path: '/projetos/:id', component: () => import('./projetos/ProjetoDetalhe.vue') },
    ] },
  { id: 'profissional', nome: 'Profissional', icone: I.profissional, base: '/profissional', descricao: 'Currículo, metas, vagas e entrevistas',
    rotas: [{ path: '/profissional', component: () => import('./profissional/Profissional.vue') }] },
];

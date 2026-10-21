import type { FastifyInstance } from 'fastify';
import { cadastrosRoutes } from './rotas/cadastros.js';
import { movimentoRoutes } from './rotas/movimento.js';
import { pessoasRoutes } from './rotas/pessoas.js';
import { trabalhoRoutes } from './rotas/trabalho.js';
import { importacaoRoutes } from './rotas/importacao.js';

/** Finanças: dados da CASA (todos os membros veem e editam). */
export async function financas(app: FastifyInstance) {
  await app.register(cadastrosRoutes);
  await app.register(movimentoRoutes);
  await app.register(pessoasRoutes);
  await app.register(trabalhoRoutes);
  await app.register(importacaoRoutes);
}

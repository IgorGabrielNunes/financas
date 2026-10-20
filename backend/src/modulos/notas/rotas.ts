import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../core/db.js';
import { uid } from '../../core/auth.js';
import { crud } from '../../core/crud.js';

const etiqueta = z.string().trim().toLowerCase().min(1).max(30);

export async function notas(app: FastifyInstance) {
  crud(app, {
    rota: '/notas', tabela: 'notas',
    schema: z.object({
      titulo: z.string().trim().max(200).default(''),
      conteudo: z.string().max(100_000).default(''),
      etiquetas: z.array(etiqueta).max(20).default([]),
      fixada: z.boolean().default(false),
      cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
      arquivada: z.boolean().default(false),
    }),
    filtros: { arquivada: 'arquivada' },
    filtrosArray: { etiqueta: 'etiquetas' },
    busca: ['titulo', 'conteudo'],
    ordem: 't.fixada desc, t.updated_at desc',
    antesDeGravar: (d) => ({ ...d, ...(d.etiquetas ? { etiquetas: [...new Set(d.etiquetas as string[])] } : {}), updated_at: new Date() }),
  });

  app.get('/notas-etiquetas', async (req) =>
    (await pool.query(
      `select e as etiqueta, count(*)::int as qtd from notas, unnest(etiquetas) e
        where user_id = $1 and not arquivada group by e order by qtd desc, e`, [uid(req)])).rows);
}

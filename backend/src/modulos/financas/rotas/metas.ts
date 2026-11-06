import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../../../core/db.js';
import { cid } from '../../../core/auth.js';
import { conflict, notFound } from '../../../core/errors.js';
import { hojeSP } from '../../../core/datas.js';
import { centavos, cor, data, dataOpt, idOpt, paramId, parse, textoOpt } from '../../../core/validacao.js';
import { daCasa, listarMetas } from '../servicos/investimentos.js';

const metaBody = z.object({
  nome: z.string().trim().min(1).max(60),
  tipo: z.enum(['viagem', 'investimento', 'cofrinho', 'reserva', 'compra', 'outro']),
  icone: z.string().trim().max(8).nullable().optional(),
  cor: cor.default('#0f4b3a'),
  valor_alvo_centavos: centavos.positive().max(100_000_000_00),
  data_alvo: dataOpt,
  usuario_id: idOpt,
  arquivada: z.boolean().default(false),
  observacao: textoOpt(500),
});
const COLS = ['nome', 'tipo', 'icone', 'cor', 'valor_alvo_centavos', 'data_alvo', 'usuario_id', 'arquivada', 'observacao'] as const;

export async function metasRoutes(app: FastifyInstance) {
  /** Membros da casa (só id e nome), para escolher o dono de uma meta/investimento. */
  app.get('/membros', async (req) =>
    (await pool.query('select id, nome from usuarios where casa_id = $1 and ativo order by created_at', [cid(req)])).rows);

  app.get('/metas', async (req) => tx((c) => listarMetas(c, cid(req))));

  app.get('/metas/:id', async (req) => tx(async (c) => {
    const id = paramId(req);
    const meta = (await listarMetas(c, cid(req))).find((m) => m.id === id);
    if (!meta) throw notFound('Meta');
    const movimentos = (await c.query(
      `select mm.*, ct.nome as conta_nome from metas_movimentos mm left join contas ct on ct.id = mm.conta_id
        where mm.meta_id = $1 order by mm.data desc, mm.created_at desc`, [id])).rows;
    return { ...meta, movimentos };
  }));

  app.post('/metas', async (req, reply) => {
    const b = parse(metaBody.extend({
      // já tenho guardado: entra como primeiro depósito (sem mexer em conta, a não ser que diga de onde sai)
      guardado_inicial_centavos: centavos.min(0).default(0),
      conta_origem_id: idOpt,
    }), req.body);
    const casa = cid(req);
    const r = await tx(async (c) => {
      await daCasa(c, 'usuarios', b.usuario_id, casa, 'Usuário');
      await daCasa(c, 'contas', b.conta_origem_id, casa, 'Conta');
      const meta = (await c.query(
        `insert into metas (casa_id, ${COLS.join(', ')}) values ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}) returning *`,
        [casa, ...COLS.map((k) => (b as any)[k] ?? null)])).rows[0];
      if (b.guardado_inicial_centavos > 0) {
        await c.query(
          `insert into metas_movimentos (casa_id, meta_id, data, valor_centavos, conta_id, descricao) values ($1,$2,$3,$4,$5,$6)`,
          [casa, meta.id, hojeSP(), b.guardado_inicial_centavos, b.conta_origem_id ?? null, 'Valor que já estava guardado']);
      }
      return meta;
    });
    return reply.code(201).send(r);
  });

  app.put('/metas/:id', async (req) => {
    const b = parse(metaBody, req.body);
    const casa = cid(req);
    return tx(async (c) => {
      await daCasa(c, 'usuarios', b.usuario_id, casa, 'Usuário');
      const r = await c.query(
        `update metas set ${COLS.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and casa_id = $2 returning *`,
        [paramId(req), casa, ...COLS.map((k) => (b as any)[k] ?? null)]);
      if (!r.rowCount) throw notFound('Meta');
      return r.rows[0];
    });
  });

  // Excluir apaga os depósitos (o dinheiro volta para as contas de origem) e desvincula os investimentos.
  app.delete('/metas/:id', async (req, reply) => {
    const r = await pool.query('delete from metas where id = $1 and casa_id = $2', [paramId(req), cid(req)]);
    if (!r.rowCount) throw notFound('Meta');
    return reply.code(204).send();
  });

  /** Guardar (+) ou retirar (−). Com conta, o valor sai da conta (guardar) ou volta para ela (retirar). */
  app.post('/metas/:id/movimentos', async (req, reply) => {
    const b = parse(z.object({
      tipo: z.enum(['guardar', 'retirar']),
      valor_centavos: centavos.positive().max(100_000_000_00),
      data: data.default(hojeSP()),
      conta_id: idOpt,
      descricao: textoOpt(120),
    }), req.body);
    const id = paramId(req), casa = cid(req);
    const r = await tx(async (c) => {
      const m = await c.query('select id from metas where id = $1 and casa_id = $2 for update', [id, casa]);
      if (!m.rowCount) throw notFound('Meta');
      await daCasa(c, 'contas', b.conta_id, casa, 'Conta');
      if (b.tipo === 'retirar') {
        const g = Number((await c.query('select coalesce(sum(valor_centavos),0)::bigint t from metas_movimentos where meta_id = $1', [id])).rows[0].t);
        if (b.valor_centavos > g) {
          throw conflict(`Só há ${(g / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} guardados direto nesta meta. Dinheiro em investimento vinculado sai pelo resgate do investimento.`);
        }
      }
      return (await c.query(
        `insert into metas_movimentos (casa_id, meta_id, data, valor_centavos, conta_id, descricao) values ($1,$2,$3,$4,$5,$6) returning *`,
        [casa, id, b.data, b.tipo === 'guardar' ? b.valor_centavos : -b.valor_centavos, b.conta_id ?? null, b.descricao ?? null])).rows[0];
    });
    return reply.code(201).send(r);
  });

  app.delete('/metas/:id/movimentos/:mid', async (req, reply) => {
    const r = await pool.query('delete from metas_movimentos where id = $1 and meta_id = $2 and casa_id = $3',
      [paramId(req, 'mid'), paramId(req), cid(req)]);
    if (!r.rowCount) throw notFound('Movimento');
    return reply.code(204).send();
  });
}

import type { FastifyInstance } from 'fastify';
import { pool, tx } from '../../../core/db.js';
import { cid } from '../../../core/auth.js';
import { conflict, notFound } from '../../../core/errors.js';
import { planejarCompra } from '../dominio/fatura.js';
import { hojeSP } from '../../../core/datas.js';
import { contasComSaldo, cartoesResumo, listarFaturas } from '../servicos/consultas.js';
import { cartaoBody, categoriaBody, contaBody, data, id, parse } from './schemas.js';
import { z } from 'zod';

async function garantirContaDoUsuario(contaId: string | null | undefined, userId: string) {
  if (!contaId) return;
  const r = await pool.query('select 1 from contas where id = $1 and casa_id = $2', [contaId, userId]);
  if (!r.rowCount) throw notFound('Conta');
}
async function garantirPessoa(pessoaId: string | null | undefined, userId: string) {
  if (!pessoaId) return;
  const r = await pool.query('select 1 from pessoas where id = $1 and casa_id = $2', [pessoaId, userId]);
  if (!r.rowCount) throw notFound('Pessoa');
}

export async function cadastrosRoutes(app: FastifyInstance) {
  // ------------------------------ categorias ------------------------------
  app.get('/categorias', async (req) =>
    (await pool.query('select * from categorias where casa_id = $1 order by tipo, nome', [cid(req)])).rows);

  app.post('/categorias', async (req, reply) => {
    const b = parse(categoriaBody, req.body);
    const r = await pool.query(
      `insert into categorias (casa_id, nome, tipo, cor) values ($1,$2,$3,coalesce($4,'#64748b'))
       on conflict (casa_id, nome, tipo) do nothing returning *`,
      [cid(req), b.nome, b.tipo, b.cor ?? null],
    );
    if (!r.rowCount) throw conflict('Categoria já existe');
    return reply.code(201).send(r.rows[0]);
  });

  app.delete('/categorias/:id', async (req, reply) => {
    const r = await pool.query('delete from categorias where id = $1 and casa_id = $2', [parse(id, (req.params as any).id), cid(req)]);
    if (!r.rowCount) throw notFound('Categoria');
    return reply.code(204).send();
  });

  // -------------------------------- contas --------------------------------
  app.get('/contas', async (req) => tx((c) => contasComSaldo(c, cid(req))));

  app.post('/contas', async (req, reply) => {
    const b = parse(contaBody, req.body);
    await garantirPessoa(b.pessoa_id, cid(req));
    const r = await pool.query(
      `insert into contas (casa_id, nome, tipo, saldo_inicial_centavos, cor, pessoa_id, cartao_debito)
       values ($1,$2,$3,$4,coalesce($5,'#2f6b4f'),$6,$7) returning *`,
      [cid(req), b.nome, b.tipo, b.saldo_inicial_centavos, b.cor ?? null, b.pessoa_id ?? null, b.cartao_debito],
    );
    return reply.code(201).send(r.rows[0]);
  });

  app.put('/contas/:id', async (req) => {
    const b = parse(contaBody, req.body);
    await garantirPessoa(b.pessoa_id, cid(req));
    const r = await pool.query(
      `update contas set nome=$3, tipo=$4, saldo_inicial_centavos=$5, cor=coalesce($6,cor), ativa=coalesce($7,ativa),
              pessoa_id=$8, cartao_debito=$9
        where id=$1 and casa_id=$2 returning *`,
      [parse(id, (req.params as any).id), cid(req), b.nome, b.tipo, b.saldo_inicial_centavos, b.cor ?? null, b.ativa ?? null,
        b.pessoa_id ?? null, b.cartao_debito],
    );
    if (!r.rowCount) throw notFound('Conta');
    return r.rows[0];
  });

  app.delete('/contas/:id', async (req, reply) => {
    const contaId = parse(id, (req.params as any).id);
    // apagar uma conta com histórico "sumiria" com o dinheiro dos relatórios: só inativar
    const uso = await pool.query(
      `select 1 from lancamentos where conta_id = $1 union all select 1 from faturas where conta_pagamento_id = $1 limit 1`,
      [contaId],
    );
    if (uso.rowCount) throw conflict('Conta com movimentação não pode ser excluída — inative-a.');
    const r = await pool.query('delete from contas where id = $1 and casa_id = $2', [contaId, cid(req)]);
    if (!r.rowCount) throw notFound('Conta');
    return reply.code(204).send();
  });

  // ------------------------------- cartões --------------------------------
  app.get('/cartoes', async (req) => tx((c) => cartoesResumo(c, cid(req))));

  app.post('/cartoes', async (req, reply) => {
    const b = parse(cartaoBody, req.body);
    await garantirContaDoUsuario(b.conta_pagamento_id, cid(req));
    await garantirPessoa(b.pessoa_id, cid(req));
    const r = await pool.query(
      `insert into cartoes (casa_id, nome, bandeira, final, limite_centavos, dia_fechamento, dia_vencimento, conta_pagamento_id, cor, pessoa_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,'#1f2937'),$10) returning *`,
      [cid(req), b.nome, b.bandeira ?? null, b.final ?? null, b.limite_centavos, b.dia_fechamento, b.dia_vencimento, b.conta_pagamento_id ?? null, b.cor ?? null, b.pessoa_id ?? null],
    );
    return reply.code(201).send(r.rows[0]);
  });

  // Obs.: mudar dia de fechamento/vencimento vale para compras NOVAS. Faturas já geradas mantêm suas datas
  // (é o que acontece no banco também quando você troca a data de vencimento).
  app.put('/cartoes/:id', async (req) => {
    const b = parse(cartaoBody, req.body);
    await garantirContaDoUsuario(b.conta_pagamento_id, cid(req));
    await garantirPessoa(b.pessoa_id, cid(req));
    const r = await pool.query(
      `update cartoes set nome=$3, bandeira=$4, final=$5, limite_centavos=$6, dia_fechamento=$7, dia_vencimento=$8,
              conta_pagamento_id=$9, cor=coalesce($10,cor), ativo=coalesce($11,ativo), pessoa_id=$12
        where id=$1 and casa_id=$2 returning *`,
      [parse(id, (req.params as any).id), cid(req), b.nome, b.bandeira ?? null, b.final ?? null, b.limite_centavos,
        b.dia_fechamento, b.dia_vencimento, b.conta_pagamento_id ?? null, b.cor ?? null, b.ativo ?? null, b.pessoa_id ?? null],
    );
    if (!r.rowCount) throw notFound('Cartão');
    return r.rows[0];
  });

  app.delete('/cartoes/:id', async (req, reply) => {
    const cartaoId = parse(id, (req.params as any).id);
    const uso = await pool.query('select 1 from lancamentos where cartao_id = $1 limit 1', [cartaoId]);
    if (uso.rowCount) throw conflict('Cartão com compras não pode ser excluído — inative-o (ativo = false).');
    const r = await pool.query('delete from cartoes where id = $1 and casa_id = $2', [cartaoId, cid(req)]);
    if (!r.rowCount) throw notFound('Cartão');
    return reply.code(204).send();
  });

  app.get('/cartoes/:id/faturas', async (req) =>
    tx((c) => listarFaturas(c, cid(req), 'and f.cartao_id = $2', [parse(id, (req.params as any).id)])));

  /** Prévia antes de lançar: em quais faturas cada parcela vai cair. */
  app.get('/cartoes/:id/simular', async (req) => {
    const q = parse(
      z.object({ data: data.default(hojeSP()), valor: z.coerce.number().int().positive(), parcelas: z.coerce.number().int().min(1).max(48).default(1) }),
      req.query,
    );
    const r = await pool.query('select dia_fechamento, dia_vencimento from cartoes where id = $1 and casa_id = $2', [
      parse(id, (req.params as any).id), cid(req),
    ]);
    if (!r.rowCount) throw notFound('Cartão');
    const { dia_fechamento, dia_vencimento } = r.rows[0];
    return planejarCompra({ diaFechamento: dia_fechamento, diaVencimento: dia_vencimento }, q.data, q.valor, q.parcelas);
  });
}

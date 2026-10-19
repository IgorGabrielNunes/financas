import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { uid } from '../auth.js';
import { notFound, badRequest, conflict } from '../errors.js';
import { atualizarLancamento, criarLancamento, excluirLancamento } from '../services/lancamentos.js';
import { descartarPrevistasFuturas } from '../services/recorrencias.js';
import { dashboard, listarFaturas, visaoMes } from '../services/consultas.js';
import { competencia, mesDe } from '../domain/datas.js';
import { data, id, lancamentoBody, lancamentoPatch, meio, pagamentoBody, parse, recorrenciaBody } from './schemas.js';

const SELECT_LANC = `
  select l.*, cat.nome as categoria_nome, cat.cor as categoria_cor, ct.nome as conta_nome, ca.nome as cartao_nome,
         (select count(*)::int from comprovantes cp where cp.lancamento_id = l.id) as qtd_comprovantes
    from lancamentos l
    left join categorias cat on cat.id = l.categoria_id
    left join contas ct on ct.id = l.conta_id
    left join cartoes ca on ca.id = l.cartao_id`;

export async function movimentoRoutes(app: FastifyInstance) {
  // ------------------------------ dashboard / mês ------------------------------
  app.get('/dashboard', async (req) => tx((c) => dashboard(c, uid(req))));

  app.get('/mes/:ano/:mes', async (req) => {
    const p = parse(z.object({ ano: z.coerce.number().int().min(2000).max(2100), mes: z.coerce.number().int().min(1).max(12) }), req.params);
    return tx((c) => visaoMes(c, uid(req), p));
  });

  // -------------------------------- lançamentos --------------------------------
  app.get('/lancamentos', async (req) => {
    const q = parse(
      z.object({
        de: data.optional(), ate: data.optional(), meio: meio.optional(), tipo: z.enum(['receita', 'despesa']).optional(),
        cartao_id: id.optional(), conta_id: id.optional(), categoria_id: id.optional(), q: z.string().max(60).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
      req.query,
    );
    const where = ['l.user_id = $1'];
    const params: unknown[] = [uid(req)];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (q.de) add('l.data >= ?', q.de);
    if (q.ate) add('l.data <= ?', q.ate);
    if (q.meio) add('l.meio = ?', q.meio);
    if (q.tipo) add('l.tipo = ?', q.tipo);
    if (q.cartao_id) add('l.cartao_id = ?', q.cartao_id);
    if (q.conta_id) add('l.conta_id = ?', q.conta_id);
    if (q.categoria_id) add('l.categoria_id = ?', q.categoria_id);
    if (q.q) add('l.descricao ilike ?', `%${q.q}%`);
    params.push(q.limit);
    const r = await pool.query(`${SELECT_LANC} where ${where.join(' and ')} order by l.data desc, l.created_at desc limit $${params.length}`, params);
    return r.rows;
  });

  app.get('/lancamentos/:id', async (req) => {
    const lancId = parse(id, (req.params as any).id);
    const r = await pool.query(`${SELECT_LANC} where l.id = $1 and l.user_id = $2`, [lancId, uid(req)]);
    if (!r.rowCount) throw notFound('Lançamento');
    const parcelas = await pool.query(
      `select p.numero, p.valor_centavos, f.id as fatura_id, f.competencia, f.data_vencimento
         from parcelas p join faturas f on f.id = p.fatura_id where p.lancamento_id = $1 order by p.numero`,
      [lancId],
    );
    return { ...r.rows[0], parcelas: parcelas.rows };
  });

  app.post('/lancamentos', async (req, reply) => {
    const b = parse(lancamentoBody, req.body);
    const novoId = await tx((c) => criarLancamento(c, uid(req), b));
    return reply.code(201).send({ id: novoId });
  });

  app.patch('/lancamentos/:id', async (req) => {
    const b = parse(lancamentoPatch, req.body);
    await tx((c) => atualizarLancamento(c, uid(req), parse(id, (req.params as any).id), b));
    return { ok: true };
  });

  app.delete('/lancamentos/:id', async (req, reply) => {
    await excluirLancamento(uid(req), parse(id, (req.params as any).id));
    return reply.code(204).send();
  });

  // --------------------------------- faturas ----------------------------------
  app.get('/faturas', async (req) => {
    const q = parse(z.object({ de: data.optional(), ate: data.optional() }), req.query);
    const cond: string[] = [];
    const params: unknown[] = [];
    if (q.de) { params.push(q.de); cond.push(`f.data_vencimento >= $${params.length + 1}`); }
    if (q.ate) { params.push(q.ate); cond.push(`f.data_vencimento <= $${params.length + 1}`); }
    return tx((c) => listarFaturas(c, uid(req), cond.length ? 'and ' + cond.join(' and ') : '', params));
  });

  app.get('/faturas/:id', async (req) => {
    const fatId = parse(id, (req.params as any).id);
    return tx(async (c) => {
      const [f] = await listarFaturas(c, uid(req), 'and f.id = $2', [fatId]);
      if (!f) throw notFound('Fatura');
      const itens = await c.query(
        `select p.numero, p.valor_centavos, l.id as lancamento_id, l.descricao, l.data, l.parcelas_total, l.status,
                cat.nome as categoria_nome, cat.cor as categoria_cor,
                (select count(*)::int from comprovantes cp where cp.lancamento_id = l.id) as qtd_comprovantes
           from parcelas p
           join lancamentos l on l.id = p.lancamento_id
           left join categorias cat on cat.id = l.categoria_id
          where p.fatura_id = $1
          order by l.data, l.created_at`,
        [fatId],
      );
      return { ...f, itens: itens.rows };
    });
  });

  /** Registra (ou corrige) o pagamento da fatura. O débito sai da conta informada. */
  app.put('/faturas/:id/pagamento', async (req) => {
    const b = parse(pagamentoBody, req.body);
    // conta nula = pago fora do Caixa (ex.: fatura quitada antes de começar a usar o app): não mexe em saldo
    if (b.valor_pago_centavos > 0 && !b.pago_em) throw badRequest('Informe a data do pagamento');
    if (b.conta_pagamento_id) {
      const ok = await pool.query('select 1 from contas where id = $1 and user_id = $2', [b.conta_pagamento_id, uid(req)]);
      if (!ok.rowCount) throw notFound('Conta');
    }
    const r = await pool.query(
      `update faturas set valor_pago_centavos = $3, pago_em = $4, conta_pagamento_id = $5
        where id = $1 and user_id = $2 returning id`,
      [parse(id, (req.params as any).id), uid(req), b.valor_pago_centavos,
        b.valor_pago_centavos > 0 ? b.pago_em : null, b.valor_pago_centavos > 0 ? b.conta_pagamento_id : null],
    );
    if (!r.rowCount) throw notFound('Fatura');
    return { ok: true };
  });

  // ------------------------------- recorrências -------------------------------
  app.get('/recorrencias', async (req) =>
    (await pool.query(
      `select r.*, cat.nome as categoria_nome, ct.nome as conta_nome, ca.nome as cartao_nome, pe.nome as pessoa_nome
         from recorrencias r
         left join categorias cat on cat.id = r.categoria_id
         left join contas ct on ct.id = r.conta_id
         left join cartoes ca on ca.id = r.cartao_id
         left join pessoas pe on pe.id = r.pessoa_id
        where r.user_id = $1 order by r.ativa desc, r.tipo desc, r.dia_mes`,
      [uid(req)],
    )).rows);

  const normalizarRec = (b: z.infer<typeof recorrenciaBody>) => {
    if ((b.meio === 'credito') !== !!b.cartao_id) throw badRequest('Recorrência no crédito exige cartão (e só no crédito)');
    return { ...b, inicio: competencia(mesDe(b.inicio)), fim: b.fim ? competencia(mesDe(b.fim)) : null };
  };

  app.post('/recorrencias', async (req, reply) => {
    const b = normalizarRec(parse(recorrenciaBody, req.body));
    const r = await pool.query(
      `insert into recorrencias (user_id, descricao, tipo, valor_previsto_centavos, dia_mes, meio, categoria_id, conta_id, cartao_id, inicio, fim)
       select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
        where ($7::uuid is null or exists (select 1 from categorias where id=$7 and user_id=$1))
          and ($8::uuid is null or exists (select 1 from contas where id=$8 and user_id=$1))
          and ($9::uuid is null or exists (select 1 from cartoes where id=$9 and user_id=$1))
       returning *`,
      [uid(req), b.descricao, b.tipo, b.valor_previsto_centavos, b.dia_mes, b.meio, b.categoria_id ?? null,
        b.meio === 'credito' ? null : b.conta_id ?? null, b.cartao_id ?? null, b.inicio, b.fim],
    );
    if (!r.rowCount) throw notFound('Conta/cartão/categoria');
    return reply.code(201).send(r.rows[0]);
  });

  // recorrências geradas por salário/dívida/acordo são editadas na origem, nunca aqui
  const bloquearVinculada = async (c: { query: typeof pool.query }, recId: string, userId: string) => {
    const r = await c.query<{ origem: string }>('select origem from recorrencias where id = $1 and user_id = $2', [recId, userId]);
    const o = r.rows[0]?.origem;
    if (o && o !== 'manual') {
      throw conflict(['salario', 'decimo1', 'decimo2'].includes(o) ? 'Este fixo vem do perfil da pessoa. Altere em Pessoas.' : 'Este fixo vem de Dívidas. Altere lá.');
    }
  };

  app.put('/recorrencias/:id', async (req) => {
    const b = normalizarRec(parse(recorrenciaBody, req.body));
    const recId = parse(id, (req.params as any).id);
    await bloquearVinculada(pool, recId, uid(req));
    return tx(async (c) => {
      const r = await c.query(
        `update recorrencias set descricao=$3, tipo=$4, valor_previsto_centavos=$5, dia_mes=$6, meio=$7, categoria_id=$8,
                conta_id=$9, cartao_id=$10, inicio=$11, fim=$12, ativa=coalesce($13, ativa)
          where id=$1 and user_id=$2 returning *`,
        [recId, uid(req), b.descricao, b.tipo, b.valor_previsto_centavos, b.dia_mes, b.meio, b.categoria_id ?? null,
          b.meio === 'credito' ? null : b.conta_id ?? null, b.cartao_id ?? null, b.inicio, b.fim, b.ativa ?? null],
      );
      if (!r.rowCount) throw notFound('Recorrência');
      await descartarPrevistasFuturas(c, uid(req), recId); // serão regeneradas com os novos valores
      return r.rows[0];
    });
  });

  app.delete('/recorrencias/:id', async (req, reply) => {
    const recId = parse(id, (req.params as any).id);
    await bloquearVinculada(pool, recId, uid(req));
    await tx(async (c) => {
      await descartarPrevistasFuturas(c, uid(req), recId);
      // instâncias realizadas ficam no histórico (recorrencia_id vira null via FK)
      const r = await c.query('delete from recorrencias where id = $1 and user_id = $2', [recId, uid(req)]);
      if (!r.rowCount) throw notFound('Recorrência');
    });
    return reply.code(204).send();
  });
}

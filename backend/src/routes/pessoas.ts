import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { uid } from '../auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { hojeSP, mesDe, competencia, somarMeses } from '../domain/datas.js';
import { cronograma, limiteNegativacao, valorPresente } from '../domain/cronograma.js';
import { sincronizarRecorrencia } from '../services/vinculos.js';
import { syncSalario } from '../services/trabalho.js';
import { centavos, cor, data, id, idOpt, parse } from './schemas.js';

// ------------------------------------------------------------------ schemas
const pessoaBody = z.object({
  nome: z.string().trim().min(1).max(40),
  cargo: z.string().trim().max(80).nullable().optional(),
  salario_centavos: centavos.positive().nullable().optional(),
  dia_salario: z.number().int().min(1).max(31).nullable().optional(),
  conta_salario_id: idOpt,
  cor: cor.optional(),
});

const TIPOS_DIVIDA = ['consignado', 'emprestimo', 'financiamento_veiculo', 'financiamento_imovel', 'cheque_especial', 'outro'] as const;
const dividaBody = z.object({
  pessoa_id: idOpt,
  tipo: z.enum(TIPOS_DIVIDA),
  credor: z.string().trim().min(1).max(80),
  descricao: z.string().trim().max(120).nullable().optional(),
  valor_contratado_centavos: centavos.positive().nullable().optional(),
  taxa_mensal_pct: z.number().min(0).max(30).nullable().optional(),
  parcelas_total: z.number().int().min(1).max(600),
  valor_parcela_centavos: centavos.positive(),
  primeira_parcela: data,
  forma_pagamento: z.enum(['folha', 'debito', 'boleto', 'pix']),
  conta_id: idOpt,
  quitada_em: data.nullable().optional(),
  observacao: z.string().max(500).nullable().optional(),
});

const inadBody = z.object({
  pessoa_id: idOpt,
  credor: z.string().trim().min(1).max(80),
  origem: z.enum(['faculdade', 'cartao', 'emprestimo', 'financiamento', 'conta_consumo', 'aluguel', 'outro']),
  motivo: z.string().trim().max(1000).nullable().optional(),
  valor_original_centavos: centavos.positive(),
  valor_atual_centavos: centavos.positive().nullable().optional(),
  desde: data,
  negativado: z.boolean().default(false),
  status: z.enum(['em_aberto', 'negociando', 'acordo', 'quitada']),
  acordo_parcelas: z.number().int().min(1).max(120).nullable().optional(),
  acordo_valor_parcela_centavos: centavos.positive().nullable().optional(),
  acordo_primeira_parcela: data.nullable().optional(),
  acordo_forma_pagamento: z.enum(['boleto', 'pix', 'debito']).nullable().optional(),
  acordo_conta_id: idOpt,
  quitada_em: data.nullable().optional(),
  observacao: z.string().max(500).nullable().optional(),
});

const ROTULO_DIVIDA: Record<string, string> = {
  consignado: 'Consignado', emprestimo: 'Empréstimo', financiamento_veiculo: 'Financiamento do veículo',
  financiamento_imovel: 'Financiamento do imóvel', cheque_especial: 'Cheque especial', outro: 'Dívida',
};

// ------------------------------------------------------------------ helpers
async function garantir(c: PoolClient | typeof pool, tabela: 'contas' | 'pessoas', idv: string | null | undefined, userId: string) {
  if (!idv) return;
  const r = await c.query(`select 1 from ${tabela} where id = $1 and user_id = $2`, [idv, userId]);
  if (!r.rowCount) throw notFound(tabela === 'contas' ? 'Conta' : 'Pessoa');
}

const nomePessoa = async (c: PoolClient, pessoaId: string | null | undefined) =>
  pessoaId ? (await c.query<{ nome: string }>('select nome from pessoas where id = $1', [pessoaId])).rows[0]?.nome ?? null : null;

const comPessoa = (base: string, nome: string | null) => (nome ? `${base} (${nome})` : base);

async function syncDivida(c: PoolClient, userId: string, d: any) {
  // folha: o desconto já sai antes do salário líquido cair — gerar saída de caixa contaria em dobro
  const gera = !d.quitada_em && d.forma_pagamento !== 'folha';
  const cr = cronograma(d.primeira_parcela, d.parcelas_total, hojeSP());
  await sincronizarRecorrencia(c, userId, 'divida', d.id,
    gera && cr.restantes > 0
      ? {
          descricao: comPessoa(`${ROTULO_DIVIDA[d.tipo]} ${d.credor}`, await nomePessoa(c, d.pessoa_id)),
          tipo: 'despesa', valor_previsto_centavos: d.valor_parcela_centavos, dia_mes: +d.primeira_parcela.slice(8, 10),
          meio: d.forma_pagamento, conta_id: d.conta_id, categoria: 'Dívidas', pessoa_id: d.pessoa_id,
          inicio: cr.proxima ? competencia(mesDe(cr.proxima)) : cr.competenciaInicio, fim: cr.competenciaFim,
        }
      : null);
}

async function syncAcordo(c: PoolClient, userId: string, i: any) {
  const ativo = i.status === 'acordo' && !i.quitada_em;
  const cr = ativo ? cronograma(i.acordo_primeira_parcela, i.acordo_parcelas, hojeSP()) : null;
  await sincronizarRecorrencia(c, userId, 'acordo', i.id,
    cr && cr.restantes > 0
      ? {
          descricao: comPessoa(`Acordo ${i.credor}`, await nomePessoa(c, i.pessoa_id)),
          tipo: 'despesa', valor_previsto_centavos: i.acordo_valor_parcela_centavos, dia_mes: +i.acordo_primeira_parcela.slice(8, 10),
          meio: i.acordo_forma_pagamento ?? 'boleto', conta_id: i.acordo_conta_id, categoria: 'Dívidas', pessoa_id: i.pessoa_id,
          inicio: cr.proxima ? competencia(mesDe(cr.proxima)) : cr.competenciaInicio, fim: cr.competenciaFim,
        }
      : null);
}

export function enriquecerDivida(d: any, hoje = hojeSP()) {
  const cr = cronograma(d.primeira_parcela, d.parcelas_total, hoje);
  const restantes = d.quitada_em ? 0 : cr.restantes;
  const taxa = d.taxa_mensal_pct === null ? null : Number(d.taxa_mensal_pct);
  return {
    ...d,
    taxa_mensal_pct: taxa,
    parcelas_pagas: d.quitada_em ? d.parcelas_total : cr.pagas,
    parcelas_restantes: restantes,
    proxima_parcela: d.quitada_em ? null : cr.proxima,
    ultima_parcela: cr.ultima,
    saldo_nominal_centavos: restantes * d.valor_parcela_centavos,
    valor_quitacao_estimado_centavos: valorPresente(d.valor_parcela_centavos, restantes, taxa),
    total_pago_no_fim_centavos: d.parcelas_total * d.valor_parcela_centavos,
    ativa: !d.quitada_em && restantes > 0,
  };
}

export function enriquecerInad(i: any, hoje = hojeSP()) {
  const cr = i.status === 'acordo' && i.acordo_primeira_parcela ? cronograma(i.acordo_primeira_parcela, i.acordo_parcelas, hoje) : null;
  const devido = i.valor_atual_centavos ?? i.valor_original_centavos;
  const acordoTotal = cr ? i.acordo_parcelas * i.acordo_valor_parcela_centavos : null;
  const meses = (+hoje.slice(0, 4) - +i.desde.slice(0, 4)) * 12 + (+hoje.slice(5, 7) - +i.desde.slice(5, 7));
  return {
    ...i,
    meses_em_atraso: i.status === 'quitada' ? null : Math.max(0, meses),
    limite_negativacao: i.negativado ? limiteNegativacao(i.desde) : null,
    devido_centavos: devido,
    acordo_total_centavos: acordoTotal,
    acordo_desconto_centavos: acordoTotal !== null ? devido - acordoTotal : null,
    acordo_parcelas_pagas: cr?.pagas ?? null,
    acordo_restante_centavos: cr ? cr.restantes * i.acordo_valor_parcela_centavos : null,
    acordo_proxima: cr?.proxima ?? null,
    acordo_ultima: cr?.ultima ?? null,
    em_aberto_centavos: i.status === 'quitada' ? 0 : cr ? cr.restantes * i.acordo_valor_parcela_centavos : devido,
  };
}

export async function listarDividas(c: PoolClient | typeof pool, userId: string) {
  const r = await c.query(
    `select d.*, p.nome as pessoa_nome, p.cor as pessoa_cor, ct.nome as conta_nome
       from dividas d left join pessoas p on p.id = d.pessoa_id left join contas ct on ct.id = d.conta_id
      where d.user_id = $1 order by d.quitada_em nulls first, d.primeira_parcela`,
    [userId],
  );
  return r.rows.map((d) => enriquecerDivida(d));
}

export async function listarInadimplencias(c: PoolClient | typeof pool, userId: string) {
  const r = await c.query(
    `select i.*, p.nome as pessoa_nome, p.cor as pessoa_cor
       from inadimplencias i left join pessoas p on p.id = i.pessoa_id
      where i.user_id = $1 order by (i.status = 'quitada'), i.desde`,
    [userId],
  );
  return r.rows.map((i) => enriquecerInad(i));
}

// ------------------------------------------------------------------ rotas
export async function pessoasRoutes(app: FastifyInstance) {
  // ------------------------------- pessoas -------------------------------
  app.get('/pessoas', async (req) => {
    const userId = uid(req);
    const pessoas = (await pool.query(
      `select p.*, ct.nome as conta_salario_nome from pessoas p left join contas ct on ct.id = p.conta_salario_id
        where p.user_id = $1 order by p.created_at`, [userId])).rows;
    const cartoes = (await pool.query('select id, nome, cor, limite_centavos, pessoa_id, ativo from cartoes where user_id = $1 order by nome', [userId])).rows;
    const contas = (await pool.query('select id, nome, cor, cartao_debito, pessoa_id, ativa from contas where user_id = $1 order by nome', [userId])).rows;
    const dividas = await listarDividas(pool, userId);
    const inads = await listarInadimplencias(pool, userId);
    return pessoas.map((p) => {
      const cc = cartoes.filter((x) => x.pessoa_id === p.id && x.ativo);
      const dv = dividas.filter((d) => d.pessoa_id === p.id && d.ativa);
      const ia = inads.filter((i) => i.pessoa_id === p.id && i.status !== 'quitada');
      const parcelasCaixa = dv.filter((d) => d.forma_pagamento !== 'folha').reduce((s, d) => s + d.valor_parcela_centavos, 0)
        + ia.filter((i) => i.status === 'acordo' && i.acordo_proxima).reduce((s, i) => s + i.acordo_valor_parcela_centavos, 0);
      return {
        ...p,
        cartoes_credito: cc,
        contas: contas.filter((x) => x.pessoa_id === p.id && x.ativa),
        qtd_cartoes_credito: cc.length,
        qtd_cartoes_debito: contas.filter((x) => x.pessoa_id === p.id && x.ativa && x.cartao_debito).length,
        maior_limite_centavos: cc.length ? Math.max(...cc.map((x) => x.limite_centavos)) : 0,
        soma_limites_centavos: cc.reduce((s, x) => s + x.limite_centavos, 0),
        dividas_saldo_centavos: dv.reduce((s, d) => s + d.saldo_nominal_centavos, 0),
        dividas_qtd: dv.length,
        desconto_folha_centavos: dv.filter((d) => d.forma_pagamento === 'folha').reduce((s, d) => s + d.valor_parcela_centavos, 0),
        parcelas_mensais_centavos: parcelasCaixa,
        // % do salário líquido que já sai em parcelas de dívida/acordo pagas pelo caixa
        comprometimento_pct: p.salario_centavos ? Math.round((parcelasCaixa / p.salario_centavos) * 1000) / 10 : null,
        inadimplencias_qtd: ia.length,
        inadimplencias_em_aberto_centavos: ia.reduce((s, i) => s + i.em_aberto_centavos, 0),
      };
    });
  });

  app.post('/pessoas', async (req, reply) => {
    const b = parse(pessoaBody, req.body);
    await garantir(pool, 'contas', b.conta_salario_id, uid(req));
    const p = await tx(async (c) => {
      const r = await c.query(
        `insert into pessoas (user_id, nome, cargo, salario_centavos, dia_salario, conta_salario_id, cor)
         values ($1,$2,$3,$4,$5,$6,coalesce($7,'#2f6b4f')) returning *`,
        [uid(req), b.nome, b.cargo ?? null, b.salario_centavos ?? null, b.dia_salario ?? null, b.conta_salario_id ?? null, b.cor ?? null],
      ).catch((e) => { if (e.code === '23505') throw conflict('Já existe uma pessoa com esse nome'); throw e; });
      await syncSalario(c, uid(req), r.rows[0].id);
      return r.rows[0];
    });
    return reply.code(201).send(p);
  });

  app.put('/pessoas/:id', async (req) => {
    const b = parse(pessoaBody, req.body);
    await garantir(pool, 'contas', b.conta_salario_id, uid(req));
    return tx(async (c) => {
      const r = await c.query(
        `update pessoas set nome=$3, cargo=$4, salario_centavos=$5, dia_salario=$6, conta_salario_id=$7, cor=coalesce($8,cor)
          where id=$1 and user_id=$2 returning *`,
        [parse(id, (req.params as any).id), uid(req), b.nome, b.cargo ?? null, b.salario_centavos ?? null, b.dia_salario ?? null, b.conta_salario_id ?? null, b.cor ?? null],
      );
      if (!r.rowCount) throw notFound('Pessoa');
      await syncSalario(c, uid(req), r.rows[0].id);
      return r.rows[0];
    });
  });

  app.delete('/pessoas/:id', async (req, reply) => {
    const pid = parse(id, (req.params as any).id);
    await tx(async (c) => {
      for (const o of ['salario', 'decimo1', 'decimo2'] as const) await sincronizarRecorrencia(c, uid(req), o, pid, null);
      const r = await c.query('delete from pessoas where id = $1 and user_id = $2', [pid, uid(req)]);
      if (!r.rowCount) throw notFound('Pessoa');
    });
    return reply.code(204).send();
  });

  // ------------------------------- dívidas -------------------------------
  app.get('/dividas', async (req) => listarDividas(pool, uid(req)));

  const salvarDivida = async (userId: string, b: z.infer<typeof dividaBody>, dividaId?: string) => {
    if (b.forma_pagamento !== 'folha' && b.forma_pagamento !== 'boleto' && !b.conta_id) {
      throw badRequest('Informe a conta de onde sai a parcela');
    }
    await garantir(pool, 'contas', b.conta_id, userId);
    await garantir(pool, 'pessoas', b.pessoa_id, userId);
    return tx(async (c) => {
      const campos = [b.pessoa_id ?? null, b.tipo, b.credor, b.descricao ?? null, b.valor_contratado_centavos ?? null, b.taxa_mensal_pct ?? null,
        b.parcelas_total, b.valor_parcela_centavos, b.primeira_parcela, b.forma_pagamento, b.conta_id ?? null, b.quitada_em ?? null, b.observacao ?? null];
      const r = dividaId
        ? await c.query(
            `update dividas set pessoa_id=$3, tipo=$4, credor=$5, descricao=$6, valor_contratado_centavos=$7, taxa_mensal_pct=$8,
                    parcelas_total=$9, valor_parcela_centavos=$10, primeira_parcela=$11, forma_pagamento=$12, conta_id=$13,
                    quitada_em=$14, observacao=$15 where id=$1 and user_id=$2 returning *`,
            [dividaId, userId, ...campos])
        : await c.query(
            `insert into dividas (user_id, pessoa_id, tipo, credor, descricao, valor_contratado_centavos, taxa_mensal_pct, parcelas_total,
                                  valor_parcela_centavos, primeira_parcela, forma_pagamento, conta_id, quitada_em, observacao)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
            [userId, ...campos]);
      if (!r.rowCount) throw notFound('Dívida');
      await syncDivida(c, userId, r.rows[0]);
      // consignado em folha muda o líquido do salário
      if (r.rows[0].pessoa_id) await syncSalario(c, userId, r.rows[0].pessoa_id);
      return enriquecerDivida(r.rows[0]);
    });
  };

  app.post('/dividas', async (req, reply) => reply.code(201).send(await salvarDivida(uid(req), parse(dividaBody, req.body))));
  app.put('/dividas/:id', async (req) => salvarDivida(uid(req), parse(dividaBody, req.body), parse(id, (req.params as any).id)));
  app.delete('/dividas/:id', async (req, reply) => {
    const did = parse(id, (req.params as any).id);
    await tx(async (c) => {
      await sincronizarRecorrencia(c, uid(req), 'divida', did, null);
      const r = await c.query('delete from dividas where id = $1 and user_id = $2 returning pessoa_id', [did, uid(req)]);
      if (!r.rowCount) throw notFound('Dívida');
      if (r.rows[0].pessoa_id) await syncSalario(c, uid(req), r.rows[0].pessoa_id);
    });
    return reply.code(204).send();
  });

  // ---------------------------- inadimplência ----------------------------
  app.get('/inadimplencias', async (req) => listarInadimplencias(pool, uid(req)));

  const salvarInad = async (userId: string, b: z.infer<typeof inadBody>, inadId?: string) => {
    if (b.status === 'acordo' && !(b.acordo_parcelas && b.acordo_valor_parcela_centavos && b.acordo_primeira_parcela)) {
      throw badRequest('Acordo exige número de parcelas, valor da parcela e data da primeira');
    }
    if (b.status === 'acordo' && b.acordo_forma_pagamento === 'debito' && !b.acordo_conta_id) throw badRequest('Informe a conta do débito');
    await garantir(pool, 'contas', b.acordo_conta_id, userId);
    await garantir(pool, 'pessoas', b.pessoa_id, userId);
    const quitadaEm = b.status === 'quitada' ? b.quitada_em ?? hojeSP() : null;
    return tx(async (c) => {
      const campos = [b.pessoa_id ?? null, b.credor, b.origem, b.motivo ?? null, b.valor_original_centavos, b.valor_atual_centavos ?? null,
        b.desde, b.negativado, b.status, b.acordo_parcelas ?? null, b.acordo_valor_parcela_centavos ?? null, b.acordo_primeira_parcela ?? null,
        b.acordo_forma_pagamento ?? null, b.acordo_conta_id ?? null, quitadaEm, b.observacao ?? null];
      const r = inadId
        ? await c.query(
            `update inadimplencias set pessoa_id=$3, credor=$4, origem=$5, motivo=$6, valor_original_centavos=$7, valor_atual_centavos=$8,
                    desde=$9, negativado=$10, status=$11, acordo_parcelas=$12, acordo_valor_parcela_centavos=$13, acordo_primeira_parcela=$14,
                    acordo_forma_pagamento=$15, acordo_conta_id=$16, quitada_em=$17, observacao=$18
              where id=$1 and user_id=$2 returning *`,
            [inadId, userId, ...campos])
        : await c.query(
            `insert into inadimplencias (user_id, pessoa_id, credor, origem, motivo, valor_original_centavos, valor_atual_centavos, desde,
                    negativado, status, acordo_parcelas, acordo_valor_parcela_centavos, acordo_primeira_parcela, acordo_forma_pagamento,
                    acordo_conta_id, quitada_em, observacao)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
            [userId, ...campos]);
      if (!r.rowCount) throw notFound('Inadimplência');
      await syncAcordo(c, userId, r.rows[0]);
      return enriquecerInad(r.rows[0]);
    });
  };

  app.post('/inadimplencias', async (req, reply) => reply.code(201).send(await salvarInad(uid(req), parse(inadBody, req.body))));
  app.put('/inadimplencias/:id', async (req) => salvarInad(uid(req), parse(inadBody, req.body), parse(id, (req.params as any).id)));
  app.delete('/inadimplencias/:id', async (req, reply) => {
    const iid = parse(id, (req.params as any).id);
    await tx(async (c) => {
      await sincronizarRecorrencia(c, uid(req), 'acordo', iid, null);
      const r = await c.query('delete from inadimplencias where id = $1 and user_id = $2', [iid, uid(req)]);
      if (!r.rowCount) throw notFound('Inadimplência');
    });
    return reply.code(204).send();
  });
}

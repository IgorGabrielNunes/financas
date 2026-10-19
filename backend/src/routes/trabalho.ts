import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { uid } from '../auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { hojeSP, parse } from '../domain/datas.js';
import { calcularFerias, calcularRescisao, estimarFgts, salarioLiquido } from '../domain/clt.js';
import { brutoEm, carregarVinculo, resumoTrabalho, salarioVigente } from '../services/salario.js';
import { syncSalario } from '../services/trabalho.js';
import { centavos, data, id, parse as validar } from './schemas.js';

const configBody = z.object({
  data_admissao: data.nullable(),
  dependentes_ir: z.number().int().min(0).max(20),
  outros_descontos_centavos: centavos.min(0),
  paga_mes_seguinte: z.boolean(),
  ferias_quitadas_ate: data.nullable(),
  saque_aniversario: z.boolean(),
  saldo_fgts_centavos: centavos.min(0).nullable(),
  saldo_fgts_em: data.nullable(),
  gerar_decimo: z.boolean(),
});

const salarioBody = z.object({
  vigencia: data,
  bruto_centavos: centavos.positive(),
  liquido_centavos: centavos.positive().nullable().optional(),
  cargo: z.string().trim().max(80).nullable().optional(),
  observacao: z.string().trim().max(200).nullable().optional(),
});

const feriasBody = z.object({
  inicio: data,
  dias: z.number().int().min(5).max(30),
  abono_dias: z.number().int().min(0).max(10).default(0),
});

async function pessoaDoUsuario(c: PoolClient | typeof pool, pessoaId: string, userId: string) {
  const r = await c.query('select id from pessoas where id = $1 and user_id = $2', [pessoaId, userId]);
  if (!r.rowCount) throw notFound('Pessoa');
}

/** Cargo atual do perfil acompanha a última linha do histórico que informou cargo. */
async function atualizarCargo(c: PoolClient, pessoaId: string) {
  const r = await c.query<{ cargo: string }>(
    `select cargo from salarios where pessoa_id = $1 and cargo is not null and vigencia <= $2 order by vigencia desc limit 1`,
    [pessoaId, hojeSP()],
  );
  if (r.rows[0]) await c.query('update pessoas set cargo = $2 where id = $1', [pessoaId, r.rows[0].cargo]);
}

export async function trabalhoRoutes(app: FastifyInstance) {
  app.get('/pessoas/:id/trabalho', async (req) => {
    const pid = validar(id, (req.params as any).id);
    return tx(async (c) => {
      await pessoaDoUsuario(c, pid, uid(req));
      const v = (await carregarVinculo(c, pid))!;
      // líquido estimado de cada linha do histórico, para a tabela da tela
      const salarios = v.salarios.map((s) => ({
        ...s,
        liquido_estimado: salarioLiquido(s.bruto_centavos, v.pessoa.dependentes_ir, Number(v.pessoa.outros_descontos_centavos), parse(s.vigencia).ano).liquido,
      }));
      return { pessoa: v.pessoa, salarios: salarios.reverse(), ferias: [...v.ferias].reverse(), resumo: resumoTrabalho(v) };
    });
  });

  app.put('/pessoas/:id/trabalho', async (req) => {
    const pid = validar(id, (req.params as any).id);
    const b = validar(configBody, req.body);
    if (b.saldo_fgts_centavos !== null && !b.saldo_fgts_em) throw badRequest('Informe a data do saldo do FGTS');
    return tx(async (c) => {
      await pessoaDoUsuario(c, pid, uid(req));
      await c.query(
        `update pessoas set data_admissao=$2, dependentes_ir=$3, outros_descontos_centavos=$4, paga_mes_seguinte=$5,
                ferias_quitadas_ate=$6, saque_aniversario=$7, saldo_fgts_centavos=$8, saldo_fgts_em=$9, gerar_decimo=$10
          where id=$1`,
        [pid, b.data_admissao, b.dependentes_ir, b.outros_descontos_centavos, b.paga_mes_seguinte, b.ferias_quitadas_ate,
          b.saque_aniversario, b.saldo_fgts_centavos, b.saldo_fgts_centavos === null ? null : b.saldo_fgts_em, b.gerar_decimo],
      );
      await syncSalario(c, uid(req), pid);
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ histórico de salários
  const salvarSalario = async (userId: string, pid: string, b: z.infer<typeof salarioBody>, sid?: string) =>
    tx(async (c) => {
      await pessoaDoUsuario(c, pid, userId);
      const campos = [b.vigencia, b.bruto_centavos, b.liquido_centavos ?? null, b.cargo ?? null, b.observacao ?? null];
      const r = sid
        ? await c.query(
            `update salarios set vigencia=$3, bruto_centavos=$4, liquido_centavos=$5, cargo=$6, observacao=$7
              where id=$1 and pessoa_id=$2 returning *`, [sid, pid, ...campos])
        : await c.query(
            `insert into salarios (user_id, pessoa_id, vigencia, bruto_centavos, liquido_centavos, cargo, observacao)
             values ($1,$2,$3,$4,$5,$6,$7) returning *`, [userId, pid, ...campos]);
      if (!r.rowCount) throw notFound('Salário');
      await atualizarCargo(c, pid);
      await syncSalario(c, userId, pid);
      return r.rows[0];
    }).catch((e) => {
      if (e.code === '23505') throw conflict('Já existe um salário com essa data de vigência');
      throw e;
    });

  app.post('/pessoas/:id/salarios', async (req, reply) =>
    reply.code(201).send(await salvarSalario(uid(req), validar(id, (req.params as any).id), validar(salarioBody, req.body))));

  app.put('/pessoas/:id/salarios/:sid', async (req) => {
    const p = req.params as any;
    return salvarSalario(uid(req), validar(id, p.id), validar(salarioBody, req.body), validar(id, p.sid));
  });

  app.delete('/pessoas/:id/salarios/:sid', async (req, reply) => {
    const p = req.params as any;
    const pid = validar(id, p.id);
    await tx(async (c) => {
      await pessoaDoUsuario(c, pid, uid(req));
      const r = await c.query('delete from salarios where id = $1 and pessoa_id = $2', [validar(id, p.sid), pid]);
      if (!r.rowCount) throw notFound('Salário');
      await atualizarCargo(c, pid);
      await syncSalario(c, uid(req), pid);
    });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ férias gozadas
  app.post('/pessoas/:id/ferias', async (req, reply) => {
    const pid = validar(id, (req.params as any).id);
    const b = validar(feriasBody, req.body);
    if (b.dias + b.abono_dias > 30) throw badRequest('Dias de férias + dias vendidos não podem passar de 30');
    const r = await tx(async (c) => {
      await pessoaDoUsuario(c, pid, uid(req));
      return (await c.query(
        'insert into ferias_gozadas (user_id, pessoa_id, inicio, dias, abono_dias) values ($1,$2,$3,$4,$5) returning *',
        [uid(req), pid, b.inicio, b.dias, b.abono_dias])).rows[0];
    });
    return reply.code(201).send(r);
  });

  app.delete('/pessoas/:id/ferias/:fid', async (req, reply) => {
    const p = req.params as any;
    const pid = validar(id, p.id);
    await pessoaDoUsuario(pool, pid, uid(req));
    const r = await pool.query('delete from ferias_gozadas where id = $1 and pessoa_id = $2', [validar(id, p.fid), pid]);
    if (!r.rowCount) throw notFound('Férias');
    return reply.code(204).send();
  });

  // --------------------------------------------------------------------- simulações
  app.get('/pessoas/:id/simular-ferias', async (req) => {
    const pid = validar(id, (req.params as any).id);
    const q = validar(z.object({
      dias: z.coerce.number().int().min(5).max(30).default(30),
      abono: z.coerce.number().int().min(0).max(10).default(0),
      inicio: data.optional(),
    }), req.query);
    if (q.dias + q.abono > 30) throw badRequest('Dias + venda não podem passar de 30');
    return tx(async (c) => {
      await pessoaDoUsuario(c, pid, uid(req));
      const v = (await carregarVinculo(c, pid))!;
      const ref = q.inicio ?? hojeSP();
      const s = salarioVigente(v, ref) ?? v.salarios[0];
      if (!s) throw badRequest('Cadastre o salário bruto no histórico para simular férias');
      return calcularFerias(s.bruto_centavos, q.dias, q.abono, v.pessoa.dependentes_ir, parse(ref).ano);
    });
  });

  app.get('/pessoas/:id/rescisao', async (req) => {
    const pid = validar(id, (req.params as any).id);
    const q = validar(z.object({
      tipo: z.enum(['sem_justa_causa', 'pedido_demissao', 'justa_causa']),
      data: data.default(hojeSP()),
    }), req.query);
    return tx(async (c) => {
      await pessoaDoUsuario(c, pid, uid(req));
      const v = (await carregarVinculo(c, pid))!;
      const p = v.pessoa;
      if (!p.data_admissao) throw badRequest('Informe a data de admissão');
      if (!v.salarios.length) throw badRequest('Cadastre o salário bruto no histórico');
      if (q.data < p.data_admissao) throw badRequest('A data é anterior à admissão');
      const salEm = brutoEm(v);
      const fgts = estimarFgts(p.data_admissao, q.data, salEm,
        p.saldo_fgts_centavos === null ? null : Number(p.saldo_fgts_centavos), p.saldo_fgts_em);
      return calcularRescisao({
        tipo: q.tipo, dataReferencia: q.data, admissao: p.data_admissao, salarioEm: salEm, dependentes: p.dependentes_ir,
        feriasQuitadasAte: p.ferias_quitadas_ate, gozos: v.ferias, saldoFgts: fgts, saqueAniversario: p.saque_aniversario,
      });
    });
  });
}


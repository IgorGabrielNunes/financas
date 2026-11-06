import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../../../core/db.js';
import { cid } from '../../../core/auth.js';
import { notFound } from '../../../core/errors.js';
import { hojeSP } from '../../../core/datas.js';
import { centavos, data, dataOpt, idOpt, paramId, parse, textoOpt } from '../../../core/validacao.js';
import { OPCOES_PADRAO, simular, type Movimento, type SaldoInformado } from '../dominio/investimentos.js';
import {
  atualizarTaxasSeVelhas, carregarInvestimentos, daCasa, evolucao, lerTaxas, modeloDe, totaisInvestimentos,
} from '../servicos/investimentos.js';

const TIPOS = ['cdb', 'lci_lca', 'tesouro_selic', 'tesouro_ipca', 'tesouro_prefixado', 'poupanca', 'fundo_di', 'caixinha', 'acoes', 'fii', 'cripto', 'outro'] as const;
const INDEXADORES = ['cdi', 'selic', 'ipca', 'prefixado', 'poupanca', 'nenhum'] as const;
const pctTaxa = z.number().min(0).max(500);

const modelo = z.object({
  indexador: z.enum(INDEXADORES),
  taxa: pctTaxa.default(100),
  isento_ir: z.boolean().default(false),
  taxa_adm_aa: z.number().min(0).max(10).default(0),
});

const investimentoBody = modelo.extend({
  nome: z.string().trim().min(1).max(80),
  tipo: z.enum(TIPOS),
  liquidez: z.enum(['diaria', 'vencimento']).default('diaria'),
  vencimento: dataOpt,
  conta_id: z.uuid({ message: 'Escolha a conta/banco onde o dinheiro está' }),
  meta_id: idOpt,
  usuario_id: idOpt,
  ativo: z.boolean().default(true),
  observacao: textoOpt(500),
});

const movimentoBody = z.object({
  tipo: z.enum(['aporte', 'resgate']),
  data,
  valor_centavos: centavos.positive().max(100_000_000_00),
  conta_id: idOpt,   // null = não mexe em conta
  observacao: textoOpt(200),
});

const COLS = ['nome', 'tipo', 'indexador', 'taxa', 'taxa_adm_aa', 'isento_ir', 'liquidez', 'vencimento', 'conta_id', 'meta_id', 'usuario_id', 'ativo', 'observacao'] as const;

async function conferirVinculos(c: any, casaId: string, b: { conta_id?: string | null; meta_id?: string | null; usuario_id?: string | null }) {
  await daCasa(c, 'contas', b.conta_id, casaId, 'Conta');
  await daCasa(c, 'metas', b.meta_id, casaId, 'Meta');
  await daCasa(c, 'usuarios', b.usuario_id, casaId, 'Usuário');
}

async function investimentoDaCasa(c: any, id: string, casaId: string) {
  const r = await c.query('select * from investimentos where id = $1 and casa_id = $2', [id, casaId]);
  if (!r.rowCount) throw notFound('Investimento');
  return r.rows[0];
}

export async function investimentosRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------ taxas
  app.get('/investimentos/taxas', async (req) => (await atualizarTaxasSeVelhas(cid(req))).taxas);

  app.post('/investimentos/taxas/atualizar', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const r = await atualizarTaxasSeVelhas(cid(req), true);
    return { ...r.taxas, atualizou: r.atualizou };
  });

  app.put('/investimentos/taxas', async (req) => {
    const b = parse(z.object({ selic_aa: pctTaxa, cdi_aa: pctTaxa, ipca_aa: z.number().min(-20).max(100), tr_am: z.number().min(0).max(5) }), req.body);
    await lerTaxas(pool, cid(req));
    await pool.query(
      `update taxas_referencia set selic_aa=$2, cdi_aa=$3, ipca_aa=$4, tr_am=$5, fonte='manual', atualizado_em=now() where casa_id=$1`,
      [cid(req), b.selic_aa, b.cdi_aa, b.ipca_aa, b.tr_am]);
    return lerTaxas(pool, cid(req));
  });

  // ------------------------------------------------------------ simulador
  app.get('/investimentos/opcoes', async () => OPCOES_PADRAO);

  app.post('/investimentos/simular', async (req) => {
    const b = parse(z.object({
      inicial_centavos: centavos.min(0).max(100_000_000_00),
      mensal_centavos: centavos.min(0).max(10_000_000_00),
      meses: z.number().int().min(1).max(600),
      opcoes: z.array(z.object({ chave: z.string().max(40), nome: z.string().max(80), modelo })).max(15).optional(),
      atual_id: idOpt,
    }), req.body);
    const { taxas } = await atualizarTaxasSeVelhas(cid(req));
    const inicio = hojeSP();
    const s = { inicial_centavos: b.inicial_centavos, mensal_centavos: b.mensal_centavos, meses: b.meses, inicio };
    const opcoes = b.opcoes ?? OPCOES_PADRAO.map((o) => ({ chave: o.chave, nome: o.nome, modelo: o.modelo }));
    let atual = null;
    if (b.atual_id) {
      const inv = await investimentoDaCasa(pool, b.atual_id, cid(req));
      atual = { chave: 'atual', nome: inv.nome, modelo: modeloDe(inv), ...simular(s, modeloDe(inv), taxas) };
    }
    if (b.inicial_centavos === 0 && b.mensal_centavos === 0) return { taxas, inicio, atual, resultados: [] };
    const resultados = opcoes.map((o) => ({ ...o, ...simular(s, o.modelo, taxas) }))
      .sort((x, y) => y.liquido_centavos - x.liquido_centavos);
    return { taxas, inicio, atual, resultados };
  });

  // ------------------------------------------------------------ investimentos
  app.get('/investimentos', async (req) => {
    const { taxas } = await atualizarTaxasSeVelhas(cid(req));
    return tx(async (c) => {
      const itens = await carregarInvestimentos(c, cid(req), taxas);
      // por conta: onde o dinheiro está
      const porConta = new Map<string, { conta_id: string | null; conta_nome: string; conta_cor: string | null; saldo_centavos: number }>();
      for (const i of itens.filter((x) => x.ativo)) {
        const k = i.conta_id ?? '-';
        const g = porConta.get(k) ?? { conta_id: i.conta_id, conta_nome: i.conta_nome ?? 'Sem conta', conta_cor: i.conta_cor, saldo_centavos: 0 };
        g.saldo_centavos += i.posicao.saldo_bruto_centavos;
        porConta.set(k, g);
      }
      return { taxas, totais: totaisInvestimentos(itens), por_conta: [...porConta.values()], itens };
    });
  });

  app.get('/investimentos/:id', async (req) => {
    const { taxas } = await atualizarTaxasSeVelhas(cid(req));
    return tx(async (c) => {
      const id = paramId(req);
      const inv = (await carregarInvestimentos(c, cid(req), taxas)).find((i) => i.id === id);
      if (!inv) throw notFound('Investimento');
      const movimentos = (await c.query(
        `select m.*, ct.nome as conta_nome from investimentos_movimentos m left join contas ct on ct.id = m.conta_id
          where m.investimento_id = $1 order by m.data desc, m.created_at desc`, [id])).rows;
      const saldos = (await c.query('select * from investimentos_saldos where investimento_id = $1 order by data desc', [id])).rows;
      const ev = evolucao(movimentos.map((m) => ({ ...m, criado: m.created_at })) as Movimento[],
        saldos.map((x) => ({ ...x, criado: x.created_at })) as SaldoInformado[], inv.modelo, taxas, hojeSP());
      return { ...inv, movimentos, saldos, evolucao: ev };
    });
  });

  app.post('/investimentos', async (req, reply) => {
    const b = parse(investimentoBody.extend({
      // como começar: o que já está aplicado (não mexe em conta) ou um aporte que sai de uma conta agora
      inicial: z.object({
        valor_centavos: centavos.positive(),
        data,
        conta_origem_id: idOpt,
        saldo_atual_centavos: centavos.min(0).nullable().optional(),  // o que o app do banco mostra hoje
      }).nullable().optional(),
    }), req.body);
    const casa = cid(req);
    const r = await tx(async (c) => {
      await conferirVinculos(c, casa, b);
      await daCasa(c, 'contas', b.inicial?.conta_origem_id, casa, 'Conta de origem');
      const inv = (await c.query(
        `insert into investimentos (casa_id, ${COLS.join(', ')}) values ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}) returning *`,
        [casa, ...COLS.map((k) => (b as any)[k] ?? null)])).rows[0];
      if (b.inicial) {
        await c.query(
          `insert into investimentos_movimentos (casa_id, investimento_id, tipo, data, valor_centavos, conta_id, observacao)
           values ($1,$2,'aporte',$3,$4,$5,$6)`,
          [casa, inv.id, b.inicial.data, b.inicial.valor_centavos, b.inicial.conta_origem_id ?? null,
            b.inicial.conta_origem_id ? null : 'Valor que já estava aplicado']);
        if (b.inicial.saldo_atual_centavos) {
          await c.query('insert into investimentos_saldos (casa_id, investimento_id, data, valor_centavos) values ($1,$2,$3,$4)',
            [casa, inv.id, hojeSP() < b.inicial.data ? b.inicial.data : hojeSP(), b.inicial.saldo_atual_centavos]);
        }
      }
      return inv;
    });
    return reply.code(201).send(r);
  });

  app.put('/investimentos/:id', async (req) => {
    const b = parse(investimentoBody, req.body);
    const id = paramId(req), casa = cid(req);
    return tx(async (c) => {
      await investimentoDaCasa(c, id, casa);
      await conferirVinculos(c, casa, b);
      return (await c.query(
        `update investimentos set ${COLS.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and casa_id = $2 returning *`,
        [id, casa, ...COLS.map((k) => (b as any)[k] ?? null)])).rows[0];
    });
  });

  // Excluir apaga também aportes/resgates: o dinheiro "volta" para as contas de origem. Para encerrar
  // mantendo o histórico, registre o resgate e marque como inativo.
  app.delete('/investimentos/:id', async (req, reply) => {
    const r = await pool.query('delete from investimentos where id = $1 and casa_id = $2', [paramId(req), cid(req)]);
    if (!r.rowCount) throw notFound('Investimento');
    return reply.code(204).send();
  });

  // ------------------------------------------------------------ aportes, resgates, saldo informado
  app.post('/investimentos/:id/movimentos', async (req, reply) => {
    const b = parse(movimentoBody, req.body);
    const id = paramId(req), casa = cid(req);
    const r = await tx(async (c) => {
      await investimentoDaCasa(c, id, casa);
      await daCasa(c, 'contas', b.conta_id, casa, 'Conta');
      return (await c.query(
        `insert into investimentos_movimentos (casa_id, investimento_id, tipo, data, valor_centavos, conta_id, observacao)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [casa, id, b.tipo, b.data, b.valor_centavos, b.conta_id ?? null, b.observacao ?? null])).rows[0];
    });
    return reply.code(201).send(r);
  });

  app.delete('/investimentos/:id/movimentos/:mid', async (req, reply) => {
    const r = await pool.query('delete from investimentos_movimentos where id = $1 and investimento_id = $2 and casa_id = $3',
      [paramId(req, 'mid'), paramId(req), cid(req)]);
    if (!r.rowCount) throw notFound('Movimento');
    return reply.code(204).send();
  });

  app.post('/investimentos/:id/saldos', async (req, reply) => {
    const b = parse(z.object({ data: data.default(hojeSP()), valor_centavos: centavos.min(0) }), req.body);
    const id = paramId(req), casa = cid(req);
    const r = await tx(async (c) => {
      await investimentoDaCasa(c, id, casa);
      return (await c.query(
        `insert into investimentos_saldos (casa_id, investimento_id, data, valor_centavos) values ($1,$2,$3,$4)
         on conflict (investimento_id, data) do update set valor_centavos = excluded.valor_centavos, created_at = now() returning *`,
        [casa, id, b.data, b.valor_centavos])).rows[0];
    });
    return reply.code(201).send(r);
  });

  app.delete('/investimentos/:id/saldos/:sid', async (req, reply) => {
    const r = await pool.query('delete from investimentos_saldos where id = $1 and investimento_id = $2 and casa_id = $3',
      [paramId(req, 'sid'), paramId(req), cid(req)]);
    if (!r.rowCount) throw notFound('Saldo');
    return reply.code(204).send();
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../../core/db.js';
import { uid } from '../../core/auth.js';
import { crud, doDono } from '../../core/crud.js';
import { hojeSP } from '../../core/datas.js';
import { badRequest } from '../../core/errors.js';
import { cor, data, paramId, parse } from '../../core/validacao.js';
import { diaSemana } from '../tarefas/dominio.js';
import { fichasDoDia, planoDoDia, somarMacros } from './dominio.js';

const hora = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Hora no formato HH:MM');
const GRUPOS = ['peito', 'costas', 'pernas', 'gluteos', 'ombros', 'biceps', 'triceps', 'abdomen', 'cardio', 'mobilidade', 'outro'] as const;
const peso = z.number().min(0).max(2000);
const macro = z.number().min(0).max(2000).nullable().optional();

/** Fim da lista (ordem = maior + 1) para itens novos sem ordem explícita. */
async function proximaOrdem(tabela: string, coluna: string, pai: unknown, userId: string) {
  const r = await pool.query(`select coalesce(max(ordem), -1) + 1 as o from ${tabela} where ${coluna} = $1 and user_id = $2`, [pai, userId]);
  return Number(r.rows[0].o);
}

/** Fichas com exercícios e a última carga registrada de cada exercício. */
async function fichasCompletas(userId: string, ids?: string[]) {
  const fichas = (await pool.query(
    `select f.*, (select max(t.data) from saude_treinos t where t.ficha_id = f.id) as ultimo_treino
       from academia_fichas f where f.user_id = $1 ${ids ? 'and f.id = any($2)' : ''} order by f.ordem, f.nome`,
    ids ? [userId, ids] : [userId])).rows;
  if (!fichas.length) return [];
  const exs = (await pool.query(
    `select e.*,
            (select json_build_object('data', t.data, 'carga_kg', r.carga_kg, 'repeticoes', r.repeticoes, 'series_feitas', r.series_feitas)
               from academia_registros r join saude_treinos t on t.id = r.treino_id
              where r.exercicio_id = e.id order by t.data desc, t.created_at desc limit 1) as ultimo
       from academia_exercicios e where e.ficha_id = any($1) order by e.ordem, e.created_at`,
    [fichas.map((f) => f.id)])).rows;
  return fichas.map((f) => ({ ...f, exercicios: exs.filter((e) => e.ficha_id === f.id) }));
}

/** Última ficha de rodízio feita (para sugerir a próxima). */
async function ultimaRodizio(userId: string, antesDe: string) {
  // só treinos ANTES do dia: quem já treinou hoje continua vendo a ficha de hoje (marcada como feita)
  const r = await pool.query(
    `select t.ficha_id from saude_treinos t join academia_fichas f on f.id = t.ficha_id
      where t.user_id = $1 and cardinality(f.dias_semana) = 0 and t.data < $2 order by t.data desc, t.created_at desc limit 1`, [userId, antesDe]);
  return (r.rows[0]?.ficha_id as string | undefined) ?? null;
}

/** Treino de hoje: fichas do dia + o que já foi feito hoje. Usado pela tela e pelo dia de dieta. */
export async function treinoDoDia(userId: string, dia: string) {
  const resumo = (await pool.query('select id, nome, dias_semana, ordem, ativa from academia_fichas where user_id = $1', [userId])).rows
    .map((f) => ({ ...f, dias_semana: (f.dias_semana ?? []).map(Number) }));
  const { fixas, rodizio } = fichasDoDia(resumo, diaSemana(dia), await ultimaRodizio(userId, dia));
  const feitos = (await pool.query(
    `select t.id, t.ficha_id, t.duracao_min, f.nome from saude_treinos t left join academia_fichas f on f.id = t.ficha_id
      where t.user_id = $1 and t.data = $2 and t.ficha_id is not null`, [userId, dia])).rows;
  const ids = [...fixas.map((f) => f.id), ...(rodizio ? [rodizio.id] : [])];
  const completas = ids.length ? await fichasCompletas(userId, ids) : [];
  const por = (id: string) => completas.find((c) => c.id === id)!;
  return {
    data: dia,
    dia_semana: diaSemana(dia),
    fixas: fixas.map((f) => por(f.id)),
    rodizio: rodizio ? por(rodizio.id) : null,
    feitos,
    // dia de treino: tem ficha fixa hoje ou já treinou com ficha hoje
    dia_de_treino: fixas.length > 0 || feitos.length > 0,
  };
}

export async function academia(app: FastifyInstance) {
  // ------------------------------------------------------------------ fichas
  crud(app, {
    rota: '/academia/fichas', tabela: 'academia_fichas', semListagem: true,
    schema: z.object({
      nome: z.string().trim().min(1).max(60), foco: z.string().trim().max(120).nullable().optional(),
      dias_semana: z.array(z.number().int().min(0).max(6)).max(7).default([]),
      horario: hora.nullable().optional(), ordem: z.number().int().min(0).max(999).optional(),
      ativa: z.boolean().default(true), cor: cor.default('#13805a'), observacoes: z.string().max(4000).nullable().optional(),
    }),
    antesDeGravar: async (d, req, id) => {
      if (d.dias_semana) d.dias_semana = [...new Set(d.dias_semana as number[])].sort();
      if (!id && d.ordem === undefined) {
        const r = await pool.query('select coalesce(max(ordem), -1) + 1 as o from academia_fichas where user_id = $1', [uid(req)]);
        d.ordem = Number(r.rows[0].o);
      }
      return d;
    },
  });
  app.get('/academia/fichas', async (req) => fichasCompletas(uid(req)));

  // -------------------------------------------------------------- exercícios
  crud(app, {
    rota: '/academia/exercicios', tabela: 'academia_exercicios', filtros: { ficha_id: 'ficha_id' },
    refs: [{ campo: 'ficha_id', tabela: 'academia_fichas' }], ordem: 't.ordem, t.created_at',
    schema: z.object({
      ficha_id: z.uuid(), nome: z.string().trim().min(1).max(120), grupo: z.enum(GRUPOS).default('outro'),
      series: z.number().int().min(1).max(20).nullable().optional(), repeticoes: z.string().trim().max(30).nullable().optional(),
      carga_kg: peso.nullable().optional(), descanso_seg: z.number().int().min(0).max(900).nullable().optional(),
      video_url: z.string().trim().max(500).nullable().optional(), observacoes: z.string().max(2000).nullable().optional(),
      ordem: z.number().int().min(0).max(999).optional(),
    }),
    antesDeGravar: async (d, req, id) => {
      if (!id && d.ordem === undefined && d.ficha_id) d.ordem = await proximaOrdem('academia_exercicios', 'ficha_id', d.ficha_id, uid(req));
      return d;
    },
  });

  /** Reordenar exercícios da ficha (lista de ids na nova ordem). */
  app.put('/academia/fichas/:id/ordem', async (req) => {
    const ficha = await doDono('academia_fichas', paramId(req), uid(req));
    const b = parse(z.object({ ids: z.array(z.uuid()).max(100) }), req.body);
    await tx(async (c) => {
      for (const [i, eid] of b.ids.entries()) {
        await c.query('update academia_exercicios set ordem = $3 where id = $1 and ficha_id = $2', [eid, ficha.id, i]);
      }
    });
    return { ok: true };
  });

  // -------------------------------------------------------------- treino do dia
  app.get('/academia/hoje', async (req) => {
    const q = parse(z.object({ data: data.default(() => hojeSP()) }), req.query);
    return treinoDoDia(uid(req), q.data);
  });

  /**
   * Concluir treino: grava em saude_treinos (entra no histórico e nos resumos) + a carga de cada
   * exercício no dia. `atualizar_cargas` leva a carga feita para a ficha (progressão).
   */
  app.post('/academia/fichas/:id/concluir', async (req, reply) => {
    const u = uid(req);
    const ficha = await doDono('academia_fichas', paramId(req), u);
    const b = parse(z.object({
      data: data.default(() => hojeSP()),
      duracao_min: z.number().int().min(1).max(600),
      intensidade: z.number().int().min(1).max(5).nullable().optional(),
      observacoes: z.string().max(2000).nullable().optional(),
      atualizar_cargas: z.boolean().default(true),
      registros: z.array(z.object({
        exercicio_id: z.uuid(), concluido: z.boolean().default(true),
        series_feitas: z.number().int().min(0).max(50).nullable().optional(),
        repeticoes: z.string().trim().max(30).nullable().optional(),
        carga_kg: peso.nullable().optional(),
      })).max(60).default([]),
    }), req.body);
    const exs = (await pool.query('select id, nome from academia_exercicios where ficha_id = $1', [ficha.id])).rows;
    const nome = new Map(exs.map((e) => [e.id, e.nome as string]));
    for (const r of b.registros) if (!nome.has(r.exercicio_id)) throw badRequest('Exercício não pertence a esta ficha');

    const treino = await tx(async (c) => {
      const t = (await c.query(
        `insert into saude_treinos (user_id, data, tipo, duracao_min, intensidade, observacoes, ficha_id)
         values ($1,$2,'musculacao',$3,$4,$5,$6) returning *`,
        [u, b.data, b.duracao_min, b.intensidade ?? null, b.observacoes ?? `${ficha.nome}${ficha.foco ? ` · ${ficha.foco}` : ''}`, ficha.id])).rows[0];
      for (const r of b.registros) {
        await c.query(
          `insert into academia_registros (user_id, treino_id, exercicio_id, exercicio, series_feitas, repeticoes, carga_kg, concluido)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [u, t.id, r.exercicio_id, nome.get(r.exercicio_id), r.series_feitas ?? null, r.repeticoes ?? null, r.carga_kg ?? null, r.concluido]);
        if (b.atualizar_cargas && r.concluido && r.carga_kg !== null && r.carga_kg !== undefined) {
          await c.query('update academia_exercicios set carga_kg = $2 where id = $1', [r.exercicio_id, r.carga_kg]);
        }
      }
      return t;
    });
    return reply.code(201).send(treino);
  });

  /** Registros de um treino feito (para ver/editar o histórico). */
  app.get('/academia/treinos/:id/registros', async (req) => {
    const t = await doDono('saude_treinos', paramId(req), uid(req));
    return (await pool.query('select * from academia_registros where treino_id = $1 order by exercicio', [t.id])).rows;
  });

  /** Evolução de carga de um exercício. */
  app.get('/academia/exercicios/:id/evolucao', async (req) => {
    const e = await doDono('academia_exercicios', paramId(req), uid(req));
    return (await pool.query(
      `select t.data, r.carga_kg, r.repeticoes, r.series_feitas from academia_registros r join saude_treinos t on t.id = r.treino_id
        where r.exercicio_id = $1 and r.concluido order by t.data, t.created_at`, [e.id])).rows;
  });

  // ------------------------------------------------------------------- dieta
  crud(app, {
    rota: '/dieta/planos', tabela: 'dieta_planos', ordem: "t.ativo desc, case t.aplica_em when 'todos' then 0 when 'treino' then 1 else 2 end, t.created_at",
    schema: z.object({
      nome: z.string().trim().min(1).max(80), aplica_em: z.enum(['todos', 'treino', 'descanso']).default('todos'),
      ativo: z.boolean().default(true),
      kcal_meta: z.number().int().min(500).max(10000).nullable().optional(),
      proteina_g: z.number().int().min(0).max(1000).nullable().optional(), carbo_g: z.number().int().min(0).max(2000).nullable().optional(),
      gordura_g: z.number().int().min(0).max(1000).nullable().optional(), agua_ml: z.number().int().min(0).max(10000).nullable().optional(),
      profissional: z.string().trim().max(120).nullable().optional(), observacoes: z.string().max(4000).nullable().optional(),
    }),
  });
  crud(app, {
    rota: '/dieta/refeicoes', tabela: 'dieta_refeicoes', filtros: { plano_id: 'plano_id' }, semListagem: true,
    refs: [{ campo: 'plano_id', tabela: 'dieta_planos' }],
    schema: z.object({
      plano_id: z.uuid(), nome: z.string().trim().min(1).max(60), horario: hora.nullable().optional(),
      lembrar: z.boolean().default(false), observacoes: z.string().max(2000).nullable().optional(),
      ordem: z.number().int().min(0).max(99).optional(),
    }),
    antesDeGravar: async (d, req, id) => {
      if (!id && d.ordem === undefined && d.plano_id) d.ordem = await proximaOrdem('dieta_refeicoes', 'plano_id', d.plano_id, uid(req));
      return d;
    },
  });
  crud(app, {
    rota: '/dieta/itens', tabela: 'dieta_itens', semListagem: true,
    refs: [{ campo: 'refeicao_id', tabela: 'dieta_refeicoes' }],
    schema: z.object({
      refeicao_id: z.uuid(), alimento: z.string().trim().min(1).max(120), quantidade: z.string().trim().max(60).nullable().optional(),
      kcal: z.number().int().min(0).max(5000).nullable().optional(), proteina_g: macro, carbo_g: macro, gordura_g: macro,
      substituicoes: z.string().trim().max(300).nullable().optional(), ordem: z.number().int().min(0).max(99).optional(),
    }),
    antesDeGravar: async (d, req, id) => {
      if (!id && d.ordem === undefined && d.refeicao_id) d.ordem = await proximaOrdem('dieta_itens', 'refeicao_id', d.refeicao_id, uid(req));
      return d;
    },
  });

  /** Plano completo: refeições com alimentos e totais (por refeição e do dia). */
  async function planoCompleto(planoId: string, userId: string, dia?: string) {
    const plano = await doDono('dieta_planos', planoId, userId);
    const refs = (await pool.query('select * from dieta_refeicoes where plano_id = $1 order by ordem, horario nulls last', [plano.id])).rows;
    const itens = refs.length
      ? (await pool.query('select * from dieta_itens where refeicao_id = any($1) order by ordem', [refs.map((r) => r.id)])).rows : [];
    const feitas = dia && refs.length
      ? new Set((await pool.query('select refeicao_id from dieta_registros where refeicao_id = any($1) and data = $2', [refs.map((r) => r.id), dia])).rows.map((r) => r.refeicao_id))
      : new Set();
    const refeicoes = refs.map((r) => {
      const its = itens.filter((i) => i.refeicao_id === r.id);
      return { ...r, itens: its, totais: somarMacros(its), feita: feitas.has(r.id) };
    });
    return { ...plano, refeicoes, totais: somarMacros(itens) };
  }
  app.get('/dieta/planos/:id/completo', async (req) => planoCompleto(paramId(req), uid(req)));

  /** Dieta de hoje: escolhe o plano pelo tipo de dia (treino/descanso), com override por ?tipo=. */
  app.get('/dieta/hoje', async (req) => {
    const u = uid(req);
    const q = parse(z.object({ data: data.default(() => hojeSP()), tipo: z.enum(['treino', 'descanso']).optional() }), req.query);
    const planos = (await pool.query('select id, aplica_em, ativo from dieta_planos where user_id = $1', [u])).rows;
    const auto = (await treinoDoDia(u, q.data)).dia_de_treino;
    const diaDeTreino = q.tipo ? q.tipo === 'treino' : auto;
    const p = planoDoDia(planos, diaDeTreino);
    return {
      data: q.data,
      dia_de_treino: diaDeTreino,
      automatico: !q.tipo,
      tem_planos_por_tipo: planos.some((x) => x.ativo && x.aplica_em !== 'todos'),
      plano: p ? await planoCompleto(p.id, u, q.data) : null,
    };
  });

  app.post('/dieta/refeicoes/:id/feita', async (req) => {
    const r = await doDono('dieta_refeicoes', paramId(req), uid(req));
    const b = parse(z.object({ data: data.default(() => hojeSP()) }), req.body ?? {});
    await pool.query('insert into dieta_registros (user_id, refeicao_id, data) values ($1,$2,$3) on conflict do nothing', [uid(req), r.id, b.data]);
    return { ok: true };
  });
  app.delete('/dieta/refeicoes/:id/feita', async (req) => {
    const r = await doDono('dieta_refeicoes', paramId(req), uid(req));
    const q = parse(z.object({ data: data.default(() => hojeSP()) }), req.query);
    await pool.query('delete from dieta_registros where refeicao_id = $1 and data = $2', [r.id, q.data]);
    return { ok: true };
  });

}

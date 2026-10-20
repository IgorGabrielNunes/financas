import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from '../../core/db.js';
import { cid, uid } from '../../core/auth.js';
import { crud } from '../../core/crud.js';
import { hojeSP, somarDias } from '../../core/datas.js';
import { badRequest, notFound } from '../../core/errors.js';
import { cor, data, dataOpt, idOpt, paramId, parse } from '../../core/validacao.js';
import { descreverRepeticao, ocorrencias, ocorreEm, proximaOcorrencia, sequencia, type RegraTarefa } from './dominio.js';

const AREAS_PADRAO: [string, string][] = [
  ['Casa', '#b45309'], ['Limpeza', '#0891b2'], ['Estudar', '#4f46e5'], ['Programar', '#0f4b3a'],
  ['Saúde', '#dc2626'], ['Trabalho', '#475569'], ['Pessoal', '#db2777'],
];

const tarefaBody = z.object({
  titulo: z.string().trim().min(1).max(200),
  notas: z.string().max(4000).nullable().optional(),
  area_id: idOpt,
  responsavel_id: idOpt,
  compartilhada: z.boolean().default(false),
  prioridade: z.number().int().min(1).max(3).default(2),
  data: dataOpt,
  repeticao: z.enum(['nenhuma', 'diaria', 'semanal', 'mensal']).default('nenhuma'),
  dias_semana: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  fim: dataOpt,
  arquivada: z.boolean().optional(),
});

// O que o usuário enxerga: as próprias tarefas + as compartilhadas da casa.
const VISIVEL = `(t.user_id = $1 or (t.compartilhada and t.casa_id = $2))`;
const SELECT = `
  select t.*, a.nome as area_nome, a.cor as area_cor, r.nome as responsavel_nome, cr.nome as criador_nome
    from tarefas t
    left join tarefa_areas a on a.id = t.area_id
    left join usuarios r on r.id = t.responsavel_id
    left join usuarios cr on cr.id = t.user_id`;

async function garantirAreas(userId: string) {
  const r = await pool.query('select 1 from tarefa_areas where user_id = $1 limit 1', [userId]);
  if (r.rowCount) return;
  for (const [i, [nome, c]] of AREAS_PADRAO.entries()) {
    await pool.query('insert into tarefa_areas (user_id, nome, cor, ordem) values ($1,$2,$3,$4) on conflict do nothing', [userId, nome, c, i]);
  }
}

async function tarefaVisivel(req: FastifyRequest, id: string) {
  const r = await pool.query(`${SELECT} where t.id = $3 and ${VISIVEL}`, [uid(req), cid(req), id]);
  if (!r.rowCount) throw notFound('Tarefa');
  return r.rows[0];
}

function normalizar(b: z.infer<typeof tarefaBody>) {
  if (b.repeticao !== 'nenhuma' && !b.data) b.data = hojeSP(); // série começa hoje se não informar
  if (b.repeticao === 'semanal' && !b.dias_semana?.length) throw badRequest('Escolha os dias da semana');
  if (b.repeticao !== 'semanal') b.dias_semana = null;
  if (b.repeticao === 'nenhuma') b.fim = null;
  if (b.dias_semana) b.dias_semana = [...new Set(b.dias_semana)].sort();
  return b;
}

async function conferirVinculos(req: FastifyRequest, b: { area_id?: string | null; responsavel_id?: string | null }) {
  if (b.area_id) {
    const r = await pool.query('select 1 from tarefa_areas where id = $1 and user_id = $2', [b.area_id, uid(req)]);
    if (!r.rowCount) throw notFound('Área');
  }
  if (b.responsavel_id) {
    const r = await pool.query('select 1 from usuarios where id = $1 and casa_id = $2', [b.responsavel_id, cid(req)]);
    if (!r.rowCount) throw notFound('Responsável');
  }
}

const regra = (t: any): RegraTarefa => ({ data: t.data, repeticao: t.repeticao, dias_semana: t.dias_semana, fim: t.fim });

export async function tarefas(app: FastifyInstance) {
  // ------------------------------------------------------------------ áreas
  app.get('/tarefas/areas', async (req) => {
    await garantirAreas(uid(req));
    return (await pool.query(
      `select a.*, (select count(*)::int from tarefas t where t.area_id = a.id and not t.arquivada) as qtd
         from tarefa_areas a where a.user_id = $1 order by a.ordem, a.nome`, [uid(req)])).rows;
  });
  crud(app, {
    rota: '/tarefas/areas', tabela: 'tarefa_areas', semListagem: true,
    schema: z.object({ nome: z.string().trim().min(1).max(40), cor: cor.default('#64748b'), ordem: z.number().int().min(0).max(999).default(0) }),
  });

  // ---------------------------------------------------------------- agenda
  /** Itens do período: avulsas na data (+ atrasadas e sem data, se pedido) e ocorrências das repetidas. */
  app.get('/tarefas/agenda', async (req) => {
    const hoje = hojeSP();
    const q = parse(z.object({
      de: data.default(hoje), ate: data.default(hoje),
      atrasadas: z.enum(['0', '1']).default('1'), sem_data: z.enum(['0', '1']).default('0'),
      area_id: z.uuid().optional(),
    }), req.query);
    const params: unknown[] = [uid(req), cid(req)];
    let filtroArea = '';
    if (q.area_id) { params.push(q.area_id); filtroArea = ` and t.area_id = $${params.length}`; }
    const ts = (await pool.query(`${SELECT} where ${VISIVEL} and not t.arquivada${filtroArea}`, params)).rows;

    const repetidas = ts.filter((t) => t.repeticao !== 'nenhuma');
    const concl = repetidas.length
      ? (await pool.query(
          `select c.tarefa_id, c.data, u.nome as feita_por_nome from tarefa_conclusoes c left join usuarios u on u.id = c.feita_por
            where c.tarefa_id = any($1) and c.data between $2 and $3`,
          [repetidas.map((t) => t.id), q.de, q.ate])).rows
      : [];
    const feitas = new Map(concl.map((c) => [`${c.tarefa_id}|${c.data}`, c.feita_por_nome]));

    const itens: any[] = [];
    for (const t of ts) {
      const base = { ...t, descricao_repeticao: descreverRepeticao(regra(t)) };
      if (t.repeticao === 'nenhuma') {
        const feitaEm: string | null = t.concluida_em ? new Date(t.concluida_em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : null;
        if (t.data && t.data >= q.de && t.data <= q.ate) {
          itens.push({ ...base, ocorrencia: t.data, feita: !!t.concluida_em, atrasada: false });
        } else if (t.data && t.data < q.de && q.atrasadas === '1' && q.de <= hoje && (!t.concluida_em || (feitaEm! >= q.de && feitaEm! <= q.ate))) {
          // atrasada: aparece até ser feita (e no dia em que foi feita, já riscada)
          itens.push({ ...base, ocorrencia: t.data, feita: !!t.concluida_em, atrasada: !t.concluida_em });
        } else if (!t.data && q.sem_data === '1' && (!t.concluida_em || (feitaEm! >= q.de && feitaEm! <= q.ate))) {
          itens.push({ ...base, ocorrencia: null, feita: !!t.concluida_em, atrasada: false });
        }
      } else {
        for (const d of ocorrencias(regra(t), q.de, q.ate)) {
          const k = `${t.id}|${d}`;
          itens.push({ ...base, ocorrencia: d, feita: feitas.has(k), feita_por_nome: feitas.get(k) ?? null, atrasada: false });
        }
      }
    }
    // ordem: atrasadas, depois por data, pendentes antes de feitas, prioridade alta primeiro
    itens.sort((a, b) =>
      Number(b.atrasada) - Number(a.atrasada) || (a.ocorrencia ?? '9999').localeCompare(b.ocorrencia ?? '9999')
      || Number(a.feita) - Number(b.feita) || a.prioridade - b.prioridade || a.titulo.localeCompare(b.titulo));
    return itens;
  });

  /** Todas as tarefas (gestão), com próxima ocorrência e sequência das repetidas. */
  app.get('/tarefas', async (req) => {
    const hoje = hojeSP();
    const q = req.query as { arquivadas?: string };
    const ts = (await pool.query(`${SELECT} where ${VISIVEL} and t.arquivada = $3 order by t.created_at desc`,
      [uid(req), cid(req), q.arquivadas === '1'])).rows;
    const ids = ts.filter((t) => t.repeticao !== 'nenhuma').map((t) => t.id);
    const concl = ids.length
      ? (await pool.query(`select tarefa_id, data from tarefa_conclusoes where tarefa_id = any($1) and data > $2`, [ids, somarDias(hoje, -400)])).rows
      : [];
    return ts.map((t) => {
      if (t.repeticao === 'nenhuma') return { ...t, descricao_repeticao: '', proxima: t.concluida_em ? null : t.data, sequencia: 0 };
      const feitas = new Set(concl.filter((c) => c.tarefa_id === t.id).map((c) => c.data as string));
      const r = regra(t);
      return { ...t, descricao_repeticao: descreverRepeticao(r), proxima: proximaOcorrencia(r, hoje), sequencia: sequencia(r, feitas, hoje) };
    });
  });

  app.get('/tarefas/:id', async (req) => tarefaVisivel(req, paramId(req)));

  app.post('/tarefas', async (req, reply) => {
    const b = normalizar(parse(tarefaBody, req.body));
    await conferirVinculos(req, b);
    const r = await pool.query(
      `insert into tarefas (user_id, casa_id, titulo, notas, area_id, responsavel_id, compartilhada, prioridade, data, repeticao, dias_semana, fim)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [uid(req), cid(req), b.titulo, b.notas ?? null, b.area_id ?? null, b.responsavel_id ?? null, b.compartilhada, b.prioridade,
        b.data ?? null, b.repeticao, b.dias_semana ?? null, b.fim ?? null]);
    return reply.code(201).send(await tarefaVisivel(req, r.rows[0].id));
  });

  app.put('/tarefas/:id', async (req) => {
    const id = paramId(req);
    const atual = await tarefaVisivel(req, id);
    const b = normalizar(parse(tarefaBody, req.body));
    await conferirVinculos(req, b);
    // só quem criou decide se a tarefa é compartilhada (senão um membro "esconderia" a tarefa do dono)
    const compartilhada = atual.user_id === uid(req) ? b.compartilhada : atual.compartilhada;
    // virou repetida → limpa conclusão de avulsa; mudou a regra → conclusões antigas continuam válidas por data
    await pool.query(
      `update tarefas set titulo=$2, notas=$3, area_id=$4, responsavel_id=$5, compartilhada=$6, prioridade=$7, data=$8,
              repeticao=$9, dias_semana=$10, fim=$11, arquivada=coalesce($12, arquivada),
              concluida_em = case when $9 = 'nenhuma' then concluida_em else null end
        where id=$1`,
      [id, b.titulo, b.notas ?? null, b.area_id ?? null, b.responsavel_id ?? null, compartilhada, b.prioridade,
        b.data ?? null, b.repeticao, b.dias_semana ?? null, b.fim ?? null, b.arquivada ?? null]);
    return tarefaVisivel(req, id);
  });

  app.delete('/tarefas/:id', async (req, reply) => {
    const t = await tarefaVisivel(req, paramId(req));
    if (t.user_id !== uid(req) && req.user.papel !== 'admin') throw badRequest('Só quem criou a tarefa pode excluí-la. Você pode arquivar.');
    await pool.query('delete from tarefas where id = $1', [t.id]);
    return reply.code(204).send();
  });

  // -------------------------------------------------------------- concluir
  app.post('/tarefas/:id/concluir', async (req) => {
    const t = await tarefaVisivel(req, paramId(req));
    const b = parse(z.object({ data: dataOpt }), req.body ?? {});
    if (t.repeticao === 'nenhuma') {
      await pool.query('update tarefas set concluida_em = now(), concluida_por = $2 where id = $1', [t.id, uid(req)]);
    } else {
      const d = b.data ?? hojeSP();
      if (!ocorreEm(regra(t), d)) throw badRequest('Essa tarefa não cai nessa data');
      await pool.query(
        `insert into tarefa_conclusoes (tarefa_id, data, feita_por) values ($1,$2,$3) on conflict (tarefa_id, data) do nothing`,
        [t.id, d, uid(req)]);
    }
    return { ok: true };
  });

  app.delete('/tarefas/:id/concluir', async (req) => {
    const t = await tarefaVisivel(req, paramId(req));
    const q = parse(z.object({ data: data.optional() }), req.query);
    if (t.repeticao === 'nenhuma') await pool.query('update tarefas set concluida_em = null, concluida_por = null where id = $1', [t.id]);
    else await pool.query('delete from tarefa_conclusoes where tarefa_id = $1 and data = $2', [t.id, q.data ?? hojeSP()]);
    return { ok: true };
  });

  // ------------------------------------------------------------- histórico
  app.get('/tarefas/historico', async (req) => {
    const hoje = hojeSP();
    const q = parse(z.object({ de: data.default(somarDias(hoje, -29)), ate: data.default(hoje) }), req.query);
    const r = await pool.query(
      `select * from (
         select t.id, t.titulo, t.area_id, a.nome as area_nome, a.cor as area_cor,
                (t.concluida_em at time zone 'America/Sao_Paulo')::date as data, t.concluida_em as feita_em, u.nome as feita_por_nome
           from tarefas t left join tarefa_areas a on a.id = t.area_id left join usuarios u on u.id = t.concluida_por
          where ${VISIVEL} and t.repeticao = 'nenhuma' and t.concluida_em is not null
         union all
         select t.id, t.titulo, t.area_id, a.nome, a.cor, c.data, c.feita_em, u.nome
           from tarefa_conclusoes c join tarefas t on t.id = c.tarefa_id
           left join tarefa_areas a on a.id = t.area_id left join usuarios u on u.id = c.feita_por
          where ${VISIVEL}
       ) x where x.data between $3 and $4 order by x.data desc, x.feita_em desc`,
      [uid(req), cid(req), q.de, q.ate]);
    const porArea = new Map<string, { area: string; cor: string; qtd: number }>();
    for (const i of r.rows) {
      const k = i.area_nome ?? 'Sem área';
      const e = porArea.get(k) ?? { area: k, cor: i.area_cor ?? '#94a3b8', qtd: 0 };
      e.qtd++;
      porArea.set(k, e);
    }
    return { de: q.de, ate: q.ate, total: r.rowCount, por_area: [...porArea.values()].sort((a, b) => b.qtd - a.qtd), itens: r.rows };
  });
}

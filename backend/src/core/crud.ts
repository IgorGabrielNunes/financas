import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { cid, uid } from './auth.js';
import { notFound } from './errors.js';
import { paramId, parse } from './validacao.js';

/**
 * CRUD declarativo para entidades simples dos módulos.
 *
 * Segurança: nomes de coluna vêm SEMPRE das chaves do schema zod (código nosso), nunca do
 * request; valores vão como parâmetros. Toda leitura/escrita filtra pelo dono (usuário ou casa),
 * e toda chave estrangeira declarada em `refs` é conferida contra o mesmo dono — um id de outra
 * pessoa nunca é aceito, nem para ler nem para vincular.
 */
export type Ref = { campo: string; tabela: string };
export type CrudDef<S extends z.ZodObject<any>> = {
  rota: string;                          // '/estudos/livros'
  tabela: string;                        // 'livros'
  dono?: 'usuario' | 'casa';             // coluna user_id ou casa_id (padrão: usuario)
  schema: S;
  ordem?: string;                        // SQL de ordenação, ex.: 'data desc, created_at desc'
  filtros?: Record<string, string>;      // query param → coluna (igualdade)
  filtrosArray?: Record<string, string>; // query param → coluna array (valor contido)
  busca?: string[];                      // colunas para ?q= (ilike)
  refs?: Ref[];
  /** SQL extra no SELECT da listagem (subconsultas), ex.: 'select count(*) from ... where x.id = t.id' as qtd */
  extras?: string;
  /** antes de gravar (normalizações de regra de negócio) */
  antesDeGravar?: (dados: Record<string, unknown>, req: FastifyRequest, id: string | null) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** depois de gravar (ex.: sincronizar algo derivado) */
  depoisDeGravar?: (linha: any, req: FastifyRequest) => Promise<void> | void;
  /** a listagem é customizada pelo módulo (o crud registra só leitura por id e escrita) */
  semListagem?: boolean;
};

const coluna = (def: CrudDef<any>) => (def.dono === 'casa' ? 'casa_id' : 'user_id');
const dono = (def: CrudDef<any>, req: FastifyRequest) => (def.dono === 'casa' ? cid(req) : uid(req));

async function conferirRefs(def: CrudDef<any>, dados: Record<string, unknown>, donoId: string) {
  for (const r of def.refs ?? []) {
    const v = dados[r.campo];
    if (v === undefined || v === null) continue;
    const ok = await pool.query(`select 1 from ${r.tabela} where id = $1 and ${coluna(def)} = $2`, [v, donoId]);
    if (!ok.rowCount) throw notFound(`Registro vinculado (${r.campo})`);
  }
}

export function crud<S extends z.ZodObject<any>>(app: FastifyInstance, def: CrudDef<S>) {
  const col = coluna(def);
  const extras = def.extras ? `, ${def.extras}` : '';

  if (!def.semListagem) app.get(def.rota, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where = [`t.${col} = $1`];
    const params: unknown[] = [dono(def, req)];
    for (const [p, c] of Object.entries(def.filtros ?? {})) {
      if (q[p] !== undefined && q[p] !== '') { params.push(q[p]); where.push(`t.${c} = $${params.length}`); }
    }
    for (const [p, c] of Object.entries(def.filtrosArray ?? {})) {
      if (q[p]) { params.push(q[p]); where.push(`$${params.length} = any(t.${c})`); }
    }
    if (q.q && def.busca?.length) {
      params.push(`%${String(q.q).slice(0, 80)}%`);
      where.push(`(${def.busca.map((c) => `t.${c} ilike $${params.length}`).join(' or ')})`);
    }
    const r = await pool.query(
      `select t.*${extras} from ${def.tabela} t where ${where.join(' and ')} order by ${def.ordem ?? 't.created_at desc'} limit 1000`, params);
    return r.rows;
  });

  app.get(`${def.rota}/:id`, async (req) => {
    const r = await pool.query(`select t.*${extras} from ${def.tabela} t where t.id = $1 and t.${col} = $2`, [paramId(req), dono(def, req)]);
    if (!r.rowCount) throw notFound();
    return r.rows[0];
  });

  const gravar = async (req: FastifyRequest, id: string | null, parcial: boolean) => {
    const schema = parcial ? def.schema.partial() : def.schema;
    let dados = parse(schema, req.body) as Record<string, unknown>;
    // undefined = "não mexe" (só no PATCH); no POST/PUT o zod já aplicou defaults
    dados = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined));
    if (def.antesDeGravar) dados = await def.antesDeGravar(dados, req, id);
    const donoId = dono(def, req);
    await conferirRefs(def, dados, donoId);
    const cols = Object.keys(dados);
    const vals = cols.map((c) => dados[c]);
    let r;
    if (id === null) {
      r = await pool.query(
        `insert into ${def.tabela} (${[col, ...cols].join(', ')}) values (${[donoId, ...vals].map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
        [donoId, ...vals]);
    } else {
      if (!cols.length) {
        r = await pool.query(`select * from ${def.tabela} where id = $1 and ${col} = $2`, [id, donoId]);
      } else {
        r = await pool.query(
          `update ${def.tabela} set ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} where id = $1 and ${col} = $2 returning *`,
          [id, donoId, ...vals]);
      }
      if (!r.rowCount) throw notFound();
    }
    if (def.depoisDeGravar) await def.depoisDeGravar(r.rows[0], req);
    return r.rows[0];
  };

  app.post(def.rota, async (req, reply) => reply.code(201).send(await gravar(req, null, false)));
  app.put(`${def.rota}/:id`, async (req) => gravar(req, paramId(req), false));
  app.patch(`${def.rota}/:id`, async (req) => gravar(req, paramId(req), true));
  app.delete(`${def.rota}/:id`, async (req, reply) => {
    const r = await pool.query(`delete from ${def.tabela} where id = $1 and ${col} = $2`, [paramId(req), dono(def, req)]);
    if (!r.rowCount) throw notFound();
    return reply.code(204).send();
  });
}

/** Garante que um registro pertence ao usuário/casa (para rotas customizadas). */
export async function doDono(tabela: string, id: string, donoId: string, coluna: 'user_id' | 'casa_id' = 'user_id') {
  const r = await pool.query(`select * from ${tabela} where id = $1 and ${coluna} = $2`, [id, donoId]);
  if (!r.rowCount) throw notFound();
  return r.rows[0];
}

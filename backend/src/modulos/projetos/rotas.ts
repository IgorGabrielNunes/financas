import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../core/db.js';
import { uid } from '../../core/auth.js';
import { crud, doDono } from '../../core/crud.js';
import { badRequest } from '../../core/errors.js';
import { centavos, cor, dataOpt, idOpt, paramId, parse } from '../../core/validacao.js';

const STATUS_CARD = ['backlog', 'a_fazer', 'fazendo', 'revisao', 'feito'] as const;
/** Colunas do quadro por tipo: projeto pessoal é simples; software/produto/profissional têm backlog e revisão. */
export const colunasDo = (tipo: string) => (tipo === 'pessoal' ? ['a_fazer', 'fazendo', 'feito'] : [...STATUS_CARD]);

const urlOpt = z.string().trim().max(500).nullable().optional();

export async function projetos(app: FastifyInstance) {
  crud(app, {
    rota: '/projetos', tabela: 'projetos', filtros: { tipo: 'tipo', status: 'status' }, busca: ['nome', 'descricao'],
    ordem: "case t.status when 'andamento' then 0 when 'planejamento' then 1 when 'ideia' then 2 when 'lancado' then 3 when 'pausado' then 4 else 5 end, t.created_at desc",
    extras: `(select count(*)::int from projeto_cards c where c.projeto_id = t.id) as cards_total,
             (select count(*)::int from projeto_cards c where c.projeto_id = t.id and c.status = 'feito') as cards_feitos,
             (select count(*)::int from projeto_cards c where c.projeto_id = t.id and c.status = 'fazendo') as cards_fazendo,
             (select count(*)::int from projeto_cards c where c.projeto_id = t.id and c.tipo = 'bug' and c.status <> 'feito') as bugs_abertos,
             (select json_build_object('nome', m.nome, 'data_alvo', m.data_alvo) from projeto_marcos m
               where m.projeto_id = t.id and m.concluido_em is null order by m.data_alvo nulls last limit 1) as proximo_marco`,
    schema: z.object({
      nome: z.string().trim().min(1).max(120), descricao: z.string().max(10000).nullable().optional(),
      tipo: z.enum(['pessoal', 'software', 'produto', 'profissional']).default('pessoal'),
      status: z.enum(['ideia', 'planejamento', 'andamento', 'pausado', 'concluido', 'lancado', 'arquivado']).default('ideia'),
      cor: cor.default('#0f4b3a'), inicio: dataOpt, prazo: dataOpt,
      repo_url: urlOpt, producao_url: urlOpt, homologacao_url: urlOpt,
      stack: z.array(z.string().trim().min(1).max(40)).max(30).default([]), versao_atual: z.string().trim().max(30).nullable().optional(),
      publico_alvo: z.string().max(2000).nullable().optional(), proposta_valor: z.string().max(4000).nullable().optional(),
      modelo_cobranca: z.enum(['gratuito', 'unico', 'mensal', 'anual', 'freemium', 'sob_consulta']).nullable().optional(),
      preco_centavos: centavos.min(0).nullable().optional(),
    }),
  });
  crud(app, {
    rota: '/projetos-marcos', tabela: 'projeto_marcos', filtros: { projeto_id: 'projeto_id' }, refs: [{ campo: 'projeto_id', tabela: 'projetos' }],
    ordem: 't.concluido_em nulls first, t.data_alvo nulls last, t.created_at',
    schema: z.object({
      projeto_id: z.uuid(), nome: z.string().trim().min(1).max(80), descricao: z.string().max(4000).nullable().optional(),
      data_alvo: dataOpt, concluido_em: dataOpt,
    }),
  });
  crud(app, {
    rota: '/projetos-cards', tabela: 'projeto_cards', filtros: { projeto_id: 'projeto_id', status: 'status', tipo: 'tipo' },
    refs: [{ campo: 'projeto_id', tabela: 'projetos' }, { campo: 'marco_id', tabela: 'projeto_marcos' }],
    ordem: 't.ordem, t.created_at',
    schema: z.object({
      projeto_id: z.uuid(), marco_id: idOpt, titulo: z.string().trim().min(1).max(200), descricao: z.string().max(20000).nullable().optional(),
      status: z.enum(STATUS_CARD).default('a_fazer'),
      tipo: z.enum(['tarefa', 'funcionalidade', 'bug', 'melhoria', 'debito_tecnico', 'pesquisa', 'documentacao']).default('tarefa'),
      prioridade: z.number().int().min(1).max(3).default(2),
      estimativa_pontos: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13), z.literal(21)]).nullable().optional(),
      prazo: dataOpt, branch: z.string().trim().max(120).nullable().optional(), pr_url: urlOpt,
    }),
    antesDeGravar: async (d, req, id) => {
      // card novo (ou que mudou de coluna) vai para o fim da coluna; concluído registra a data uma vez só
      const atual = id ? (await pool.query('select status, projeto_id from projeto_cards where id = $1 and user_id = $2', [id, uid(req)])).rows[0] : null;
      const mudouColuna = d.status !== undefined && (!atual || atual.status !== d.status);
      if (mudouColuna) {
        const projeto = d.projeto_id ?? atual?.projeto_id;
        const r = await pool.query('select coalesce(max(ordem), 0) + 1 as o from projeto_cards where projeto_id = $1 and status = $2 and user_id = $3',
          [projeto, d.status, uid(req)]);
        d.ordem = Number(r.rows[0].o);
        d.concluido_em = d.status === 'feito' ? new Date() : null;
      }
      if (d.marco_id && d.projeto_id) {
        const m = await pool.query('select 1 from projeto_marcos where id = $1 and projeto_id = $2', [d.marco_id, d.projeto_id]);
        if (!m.rowCount) throw badRequest('O marco é de outro projeto');
      }
      return d;
    },
  });

  /** Quadro completo do projeto. */
  app.get('/projetos/:id/quadro', async (req) => {
    const p = await doDono('projetos', paramId(req), uid(req));
    const [cards, marcos] = await Promise.all([
      pool.query(`select c.*, m.nome as marco_nome from projeto_cards c left join projeto_marcos m on m.id = c.marco_id
                   where c.projeto_id = $1 order by c.ordem, c.created_at`, [p.id]),
      pool.query(`select m.*, (select count(*)::int from projeto_cards c where c.marco_id = m.id) as cards_total,
                         (select count(*)::int from projeto_cards c where c.marco_id = m.id and c.status = 'feito') as cards_feitos
                    from projeto_marcos m where m.projeto_id = $1 order by m.concluido_em nulls first, m.data_alvo nulls last`, [p.id]),
    ]);
    const colunas = colunasDo(p.tipo);
    // cards em coluna que o tipo não usa (ex.: projeto mudou de software para pessoal) caem na coluna mais próxima
    const ajusta = (s: string) => (colunas.includes(s) ? s : s === 'backlog' ? 'a_fazer' : s === 'revisao' ? 'fazendo' : s);
    return {
      projeto: p,
      colunas,
      marcos: marcos.rows,
      cards: cards.rows.map((c) => ({ ...c, status: ajusta(c.status) })),
      pontos: {
        total: cards.rows.reduce((s, c) => s + (c.estimativa_pontos ?? 0), 0),
        feitos: cards.rows.filter((c) => c.status === 'feito').reduce((s, c) => s + (c.estimativa_pontos ?? 0), 0),
      },
    };
  });

  /** Mover card (arrastar): nova coluna e posição entre dois vizinhos. */
  app.patch('/projetos-cards/:id/mover', async (req) => {
    const c = await doDono('projeto_cards', paramId(req), uid(req));
    const b = parse(z.object({ status: z.enum(STATUS_CARD), antes_de: idOpt }), req.body);
    let ordem: number;
    if (b.antes_de) {
      const alvo = await pool.query('select ordem from projeto_cards where id = $1 and projeto_id = $2', [b.antes_de, c.projeto_id]);
      if (!alvo.rowCount) throw badRequest('Card de referência inválido');
      const ant = await pool.query(
        `select coalesce(max(ordem), $3 - 2) as o from projeto_cards where projeto_id = $1 and status = $2 and ordem < $3 and id <> $4`,
        [c.projeto_id, b.status, alvo.rows[0].ordem, c.id]);
      ordem = (Number(ant.rows[0].o) + Number(alvo.rows[0].ordem)) / 2;
    } else {
      const fim = await pool.query('select coalesce(max(ordem), 0) + 1 as o from projeto_cards where projeto_id = $1 and status = $2 and id <> $3',
        [c.projeto_id, b.status, c.id]);
      ordem = Number(fim.rows[0].o);
    }
    const r = await pool.query(
      `update projeto_cards set status = $2, ordem = $3,
              concluido_em = case when $2 = 'feito' then coalesce(concluido_em, now()) else null end
        where id = $1 returning *`, [c.id, b.status, ordem]);
    return r.rows[0];
  });
}

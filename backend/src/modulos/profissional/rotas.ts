import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../core/db.js';
import { cid, uid } from '../../core/auth.js';
import { crud } from '../../core/crud.js';
import { hojeSP } from '../../core/datas.js';
import { badRequest } from '../../core/errors.js';
import { centavos, data, dataOpt } from '../../core/validacao.js';

const modalidade = z.enum(['presencial', 'hibrido', 'remoto']).nullable().optional();
const hora = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional();

export async function profissional(app: FastifyInstance) {
  crud(app, {
    rota: '/profissional/experiencias', tabela: 'prof_experiencias', ordem: 't.fim desc nulls first, t.inicio desc',
    schema: z.object({
      empresa: z.string().trim().min(1).max(120), cargo: z.string().trim().min(1).max(120),
      vinculo: z.enum(['clt', 'pj', 'estagio', 'freelance', 'temporario', 'voluntario']).default('clt'),
      modalidade, local: z.string().trim().max(120).nullable().optional(), inicio: data, fim: dataOpt,
      descricao: z.string().max(10000).nullable().optional(), conquistas: z.string().max(10000).nullable().optional(),
      tecnologias: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
    }),
    antesDeGravar: (d) => {
      if (d.fim && d.inicio && (d.fim as string) < (d.inicio as string)) throw badRequest('A data de saída é anterior à de entrada');
      return d;
    },
  });
  crud(app, {
    rota: '/profissional/habilidades', tabela: 'prof_habilidades', filtros: { categoria: 'categoria' }, ordem: 't.categoria, t.nivel desc, t.nome',
    schema: z.object({
      nome: z.string().trim().min(1).max(60),
      categoria: z.enum(['tecnica', 'ferramenta', 'dominio', 'idioma', 'comportamental']).default('tecnica'),
      nivel: z.number().int().min(1).max(5).default(3),
    }),
  });
  crud(app, {
    rota: '/profissional/metas', tabela: 'prof_metas', filtros: { status: 'status' },
    ordem: "case t.status when 'andamento' then 0 when 'aberta' then 1 when 'concluida' then 2 else 3 end, t.prazo nulls last",
    schema: z.object({
      titulo: z.string().trim().min(1).max(160), descricao: z.string().max(4000).nullable().optional(),
      categoria: z.enum(['carreira', 'salario', 'tecnica', 'certificacao', 'rede', 'outro']).default('carreira'),
      prazo: dataOpt, status: z.enum(['aberta', 'andamento', 'concluida', 'abandonada']).default('aberta'),
      progresso: z.number().int().min(0).max(100).default(0),
    }),
    antesDeGravar: (d) => (d.status === 'concluida' ? { ...d, progresso: 100 } : d),
  });
  crud(app, {
    rota: '/profissional/vagas', tabela: 'prof_vagas', filtros: { status: 'status' }, busca: ['empresa', 'cargo'],
    ordem: "case t.status when 'proposta' then 0 when 'em_processo' then 1 when 'aplicada' then 2 when 'interesse' then 3 else 4 end, t.created_at desc",
    extras: `(select json_build_object('data', e.data, 'hora', e.hora, 'etapa', e.etapa) from prof_entrevistas e
               where e.vaga_id = t.id and e.resultado = 'agendada' order by e.data, e.hora limit 1) as proxima_entrevista,
             (select count(*)::int from prof_entrevistas e where e.vaga_id = t.id) as qtd_entrevistas`,
    schema: z.object({
      empresa: z.string().trim().min(1).max(120), cargo: z.string().trim().min(1).max(120), url: z.string().trim().max(500).nullable().optional(),
      fonte: z.string().trim().max(60).nullable().optional(), modalidade, local: z.string().trim().max(120).nullable().optional(),
      vinculo: z.enum(['clt', 'pj', 'estagio', 'freelance', 'temporario']).nullable().optional(),
      salario_min_centavos: centavos.min(0).nullable().optional(), salario_max_centavos: centavos.min(0).nullable().optional(),
      status: z.enum(['interesse', 'aplicada', 'em_processo', 'proposta', 'aceita', 'recusada', 'reprovado', 'desisti']).default('interesse'),
      aplicada_em: dataOpt, contato: z.string().trim().max(200).nullable().optional(), observacoes: z.string().max(10000).nullable().optional(),
    }),
    antesDeGravar: (d) => {
      if (d.status === 'aplicada' && !d.aplicada_em) d.aplicada_em = hojeSP();
      return d;
    },
  });
  crud(app, {
    rota: '/profissional/entrevistas', tabela: 'prof_entrevistas', filtros: { vaga_id: 'vaga_id', resultado: 'resultado' },
    refs: [{ campo: 'vaga_id', tabela: 'prof_vagas' }], ordem: 't.data desc, t.hora desc nulls last',
    schema: z.object({
      vaga_id: z.uuid(), data, hora, etapa: z.enum(['triagem', 'rh', 'tecnica', 'case', 'gestor', 'cultura', 'proposta']).default('rh'),
      entrevistador: z.string().trim().max(120).nullable().optional(), link: z.string().trim().max(500).nullable().optional(),
      resultado: z.enum(['agendada', 'aprovado', 'reprovado', 'aguardando', 'cancelada']).default('agendada'),
      anotacoes: z.string().max(10000).nullable().optional(),
    }),
    // entrevista marcada coloca a vaga "em processo" automaticamente
    depoisDeGravar: async (e) => {
      await pool.query(`update prof_vagas set status = 'em_processo' where id = $1 and status in ('interesse','aplicada')`, [e.vaga_id]);
    },
  });

  /** Currículo montado: perfil (usuário + Pessoas), experiências, habilidades e formação (Estudos). */
  app.get('/profissional/curriculo', async (req) => {
    const u = uid(req);
    const [usuario, exps, habs, formacao] = await Promise.all([
      pool.query(`select u.nome, u.email, p.cargo from usuarios u left join pessoas p on p.id = u.pessoa_id where u.id = $1 and u.casa_id = $2`, [u, cid(req)]),
      pool.query('select * from prof_experiencias where user_id = $1 order by fim desc nulls first, inicio desc', [u]),
      pool.query('select * from prof_habilidades where user_id = $1 order by categoria, nivel desc, nome', [u]),
      pool.query(`select tipo, nome, instituicao, status, inicio, fim_previsto, concluido_em from estudo_cursos
                   where user_id = $1 and status in ('andamento','concluido') order by coalesce(concluido_em, fim_previsto) desc nulls first`, [u]),
    ]);
    return { perfil: usuario.rows[0], experiencias: exps.rows, habilidades: habs.rows, formacao: formacao.rows };
  });

  app.get('/profissional/resumo', async (req) => {
    const u = uid(req);
    const hoje = hojeSP();
    const [funil, entrevistas, metas] = await Promise.all([
      pool.query('select status, count(*)::int as qtd from prof_vagas where user_id = $1 group by status', [u]),
      pool.query(`select e.*, v.empresa, v.cargo from prof_entrevistas e join prof_vagas v on v.id = e.vaga_id
                   where e.user_id = $1 and e.resultado = 'agendada' and e.data >= $2 order by e.data, e.hora nulls last limit 6`, [u, hoje]),
      pool.query(`select * from prof_metas where user_id = $1 and status in ('aberta','andamento') order by prazo nulls last limit 6`, [u]),
    ]);
    return { funil: Object.fromEntries(funil.rows.map((r) => [r.status, r.qtd])), proximas_entrevistas: entrevistas.rows, metas: metas.rows };
  });
}

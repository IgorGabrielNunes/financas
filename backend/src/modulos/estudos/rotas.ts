import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../core/db.js';
import { uid } from '../../core/auth.js';
import { crud } from '../../core/crud.js';
import { hojeSP, somarDias } from '../../core/datas.js';
import { cor, data, dataOpt, idOpt } from '../../core/validacao.js';
import { badRequest } from '../../core/errors.js';

const nota = z.number().min(0).max(1000);

/**
 * Média ponderada pelas avaliações com nota, normalizada para 0–10.
 * situacao: 'aprovado'/'reprovado' só quando todas as avaliações têm nota; antes disso,
 * informa quanto falta em média nas restantes para atingir a média de aprovação.
 */
export function situacaoDisciplina(avs: { nota: number | null; nota_maxima: number; peso: number }[], mediaAprovacao: number) {
  const comNota = avs.filter((a) => a.nota !== null);
  const pesoTotal = avs.reduce((s, a) => s + a.peso, 0);
  const pesoFeito = comNota.reduce((s, a) => s + a.peso, 0);
  const pontos = comNota.reduce((s, a) => s + (a.nota! / a.nota_maxima) * 10 * a.peso, 0);
  const media = pesoFeito ? Math.round((pontos / pesoFeito) * 100) / 100 : null;
  if (!avs.length) return { media: null, situacao: 'sem_avaliacoes', precisa_nas_restantes: null };
  if (comNota.length === avs.length) {
    return { media, situacao: media! >= mediaAprovacao ? 'aprovado' : 'reprovado', precisa_nas_restantes: null };
  }
  // nota média (0–10) necessária nas avaliações restantes para fechar com a média de aprovação
  const precisa = (mediaAprovacao * pesoTotal - pontos) / (pesoTotal - pesoFeito);
  return {
    media, situacao: precisa > 10 ? 'em_risco' : 'cursando',
    precisa_nas_restantes: Math.max(0, Math.round(precisa * 100) / 100),
  };
}

export async function estudos(app: FastifyInstance) {
  crud(app, {
    rota: '/estudos/cursos', tabela: 'estudo_cursos', ordem: "case t.status when 'andamento' then 0 when 'planejado' then 1 else 2 end, t.inicio desc nulls last",
    filtros: { status: 'status', tipo: 'tipo' },
    schema: z.object({
      tipo: z.enum(['faculdade', 'pos', 'curso', 'certificacao', 'idioma']).default('curso'),
      nome: z.string().trim().min(1).max(120), instituicao: z.string().trim().max(120).nullable().optional(),
      status: z.enum(['planejado', 'andamento', 'pausado', 'concluido', 'trancado']).default('andamento'),
      inicio: dataOpt, fim_previsto: dataOpt, concluido_em: dataOpt,
      carga_horaria_h: z.number().int().positive().max(20000).nullable().optional(),
      media_aprovacao: z.number().min(0).max(10).default(7),
      url: z.string().trim().max(500).nullable().optional(), observacoes: z.string().max(4000).nullable().optional(),
    }),
  });
  crud(app, {
    rota: '/estudos/disciplinas', tabela: 'estudo_disciplinas', ordem: "case t.status when 'cursando' then 0 when 'a_cursar' then 1 else 2 end, t.inicio desc nulls last, t.nome",
    filtros: { curso_id: 'curso_id', status: 'status' }, refs: [{ campo: 'curso_id', tabela: 'estudo_cursos' }],
    schema: z.object({
      curso_id: idOpt, nome: z.string().trim().min(1).max(120), periodo: z.string().trim().max(40).nullable().optional(),
      status: z.enum(['a_cursar', 'cursando', 'aprovada', 'reprovada', 'dispensada']).default('cursando'),
      inicio: dataOpt, fim: dataOpt, professor: z.string().trim().max(80).nullable().optional(), cor: cor.default('#4f46e5'),
    }),
  });
  crud(app, {
    rota: '/estudos/avaliacoes', tabela: 'estudo_avaliacoes', ordem: 't.data nulls last, t.created_at',
    filtros: { disciplina_id: 'disciplina_id' }, refs: [{ campo: 'disciplina_id', tabela: 'estudo_disciplinas' }],
    schema: z.object({
      disciplina_id: z.uuid(), tipo: z.enum(['prova', 'apol', 'discursiva', 'atividade', 'trabalho', 'projeto', 'outro']).default('prova'),
      titulo: z.string().trim().min(1).max(120), data: dataOpt, peso: z.number().positive().max(100).default(1),
      nota: nota.nullable().optional(), nota_maxima: z.number().positive().max(1000).default(10),
      observacoes: z.string().max(2000).nullable().optional(),
    }),
    antesDeGravar: (d) => {
      if (typeof d.nota === 'number' && typeof d.nota_maxima === 'number' && d.nota > d.nota_maxima) throw badRequest('A nota não pode passar da nota máxima');
      return d;
    },
  });
  crud(app, {
    rota: '/estudos/livros', tabela: 'livros', filtros: { status: 'status' }, busca: ['titulo', 'autor'],
    ordem: "case t.status when 'lendo' then 0 when 'quero_ler' then 1 when 'lido' then 2 else 3 end, t.fim desc nulls last, t.created_at desc",
    schema: z.object({
      titulo: z.string().trim().min(1).max(200), autor: z.string().trim().max(120).nullable().optional(),
      status: z.enum(['quero_ler', 'lendo', 'lido', 'abandonado']).default('quero_ler'),
      paginas_total: z.number().int().positive().max(20000).nullable().optional(), pagina_atual: z.number().int().min(0).max(20000).default(0),
      inicio: dataOpt, fim: dataOpt, avaliacao: z.number().int().min(1).max(5).nullable().optional(), notas: z.string().max(10000).nullable().optional(),
    }),
  });
  crud(app, {
    rota: '/estudos/sessoes', tabela: 'estudo_sessoes', ordem: 't.data desc, t.created_at desc',
    filtros: { disciplina_id: 'disciplina_id', curso_id: 'curso_id', livro_id: 'livro_id' },
    refs: [{ campo: 'curso_id', tabela: 'estudo_cursos' }, { campo: 'disciplina_id', tabela: 'estudo_disciplinas' }, { campo: 'livro_id', tabela: 'livros' }],
    schema: z.object({
      data, minutos: z.number().int().min(1).max(1440), curso_id: idOpt, disciplina_id: idOpt, livro_id: idOpt,
      assunto: z.string().trim().max(200).nullable().optional(),
    }),
  });

  /** Painel: média e situação por disciplina, horas estudadas, próximas avaliações, leitura atual. */
  app.get('/estudos/resumo', async (req) => {
    const u = uid(req);
    const hoje = hojeSP();
    const [disc, avs, horas, prox, lendo] = await Promise.all([
      pool.query(`select d.*, c.nome as curso_nome, c.media_aprovacao from estudo_disciplinas d
                    left join estudo_cursos c on c.id = d.curso_id where d.user_id = $1 and d.status in ('cursando','a_cursar')
                    order by d.status, d.nome`, [u]),
      pool.query('select disciplina_id, nota, nota_maxima, peso from estudo_avaliacoes where user_id = $1', [u]),
      pool.query(`select
          coalesce(sum(minutos) filter (where data >= $2), 0)::int as semana,
          coalesce(sum(minutos) filter (where data >= $3), 0)::int as mes,
          coalesce(sum(minutos), 0)::int as total
        from estudo_sessoes where user_id = $1`, [u, somarDias(hoje, -6), hoje.slice(0, 8) + '01']),
      pool.query(`select a.*, d.nome as disciplina_nome, d.cor as disciplina_cor from estudo_avaliacoes a
                    join estudo_disciplinas d on d.id = a.disciplina_id
                   where a.user_id = $1 and a.nota is null and a.data >= $2 order by a.data limit 8`, [u, hoje]),
      pool.query(`select * from livros where user_id = $1 and status = 'lendo' order by inicio desc nulls last`, [u]),
    ]);
    const porDia = (await pool.query(
      `select data, sum(minutos)::int as minutos from estudo_sessoes where user_id = $1 and data >= $2 group by data order by data`,
      [u, somarDias(hoje, -27)])).rows;
    return {
      disciplinas: disc.rows.map((d) => ({
        ...d,
        ...situacaoDisciplina(
          avs.rows.filter((a) => a.disciplina_id === d.id).map((a) => ({ nota: a.nota === null ? null : Number(a.nota), nota_maxima: Number(a.nota_maxima), peso: Number(a.peso) })),
          Number(d.media_aprovacao ?? 7)),
      })),
      minutos: horas.rows[0],
      por_dia: porDia,
      proximas_avaliacoes: prox.rows,
      lendo: lendo.rows,
    };
  });
}

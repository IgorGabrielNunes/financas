import type { FastifyInstance } from 'fastify';
import { pool } from '../core/db.js';
import { uid } from '../core/auth.js';
import { hojeSP, somarDias } from '../core/datas.js';

/**
 * Agenda unificada dos próximos dias para a tela inicial: o que tem data em qualquer módulo.
 * (Tarefas do dia e finanças vêm dos endpoints próprios; aqui ficam os compromissos.)
 */
export async function hoje(app: FastifyInstance) {
  app.get('/hoje/agenda', async (req) => {
    const u = uid(req);
    const de = hojeSP();
    const ate = somarDias(de, 13);
    const r = await pool.query(
      `select * from (
         select 'consulta' as tipo, c.id, c.titulo, c.data, c.hora, coalesce(c.profissional, c.local) as detalhe, '/saude' as rota
           from saude_consultas c where c.user_id = $1 and c.status = 'agendada' and c.data between $2 and $3
         union all
         select 'avaliacao', a.id, a.titulo, a.data, null, d.nome, '/estudos'
           from estudo_avaliacoes a join estudo_disciplinas d on d.id = a.disciplina_id
          where a.user_id = $1 and a.nota is null and a.data between $2 and $3
         union all
         select 'entrevista', e.id, v.empresa || ': ' || v.cargo, e.data, e.hora, e.etapa, '/profissional'
           from prof_entrevistas e join prof_vagas v on v.id = e.vaga_id
          where e.user_id = $1 and e.resultado = 'agendada' and e.data between $2 and $3
         union all
         select 'card', c.id, c.titulo, c.prazo, null, p.nome, '/projetos/' || p.id
           from projeto_cards c join projetos p on p.id = c.projeto_id
          where c.user_id = $1 and c.status <> 'feito' and c.prazo between $2 and $3
         union all
         select 'marco', m.id, m.nome, m.data_alvo, null, p.nome, '/projetos/' || p.id
           from projeto_marcos m join projetos p on p.id = m.projeto_id
          where m.user_id = $1 and m.concluido_em is null and m.data_alvo between $2 and $3
       ) x order by x.data, x.hora nulls last limit 30`, [u, de, ate]);
    return r.rows;
  });
}

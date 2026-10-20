import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../core/db.js';
import { uid } from '../../core/auth.js';
import { crud, doDono } from '../../core/crud.js';
import { hojeSP, somarDias } from '../../core/datas.js';
import { badRequest } from '../../core/errors.js';
import { centavos, data, dataOpt, paramId, parse } from '../../core/validacao.js';

const hora = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Hora no formato HH:MM');

/** IMC e faixa da OMS (adultos). Só informativo: não substitui avaliação profissional. */
export function imc(pesoKg: number, alturaCm: number) {
  const v = Math.round((pesoKg / (alturaCm / 100) ** 2) * 10) / 10;
  const faixa = v < 18.5 ? 'abaixo do peso' : v < 25 ? 'peso normal' : v < 30 ? 'sobrepeso' : 'obesidade';
  return { valor: v, faixa };
}

export async function saude(app: FastifyInstance) {
  crud(app, {
    rota: '/saude/consultas', tabela: 'saude_consultas', filtros: { status: 'status', tipo: 'tipo' }, busca: ['titulo', 'profissional'],
    ordem: "case t.status when 'agendada' then 0 else 1 end, case when t.status = 'agendada' then t.data end asc, t.data desc",
    schema: z.object({
      tipo: z.enum(['consulta', 'exame', 'vacina', 'procedimento', 'terapia', 'odonto']).default('consulta'),
      titulo: z.string().trim().min(1).max(120), profissional: z.string().trim().max(120).nullable().optional(),
      local: z.string().trim().max(160).nullable().optional(), data, hora: hora.nullable().optional(),
      status: z.enum(['agendada', 'realizada', 'cancelada']).default('agendada'), retorno_em: dataOpt,
      valor_centavos: centavos.min(0).nullable().optional(), resultado: z.string().max(10000).nullable().optional(),
      observacoes: z.string().max(4000).nullable().optional(),
    }),
  });
  crud(app, {
    rota: '/saude/remedios', tabela: 'saude_remedios', filtros: { ativo: 'ativo' }, ordem: 't.ativo desc, t.nome',
    schema: z.object({
      nome: z.string().trim().min(1).max(120), dosagem: z.string().trim().max(80).nullable().optional(),
      horarios: z.array(hora).max(12).default([]), inicio: data.default(() => hojeSP()), fim: dataOpt,
      ativo: z.boolean().default(true), observacoes: z.string().max(2000).nullable().optional(),
    }),
    antesDeGravar: (d) => (d.horarios ? { ...d, horarios: [...new Set(d.horarios as string[])].sort() } : d),
  });
  crud(app, {
    rota: '/saude/medidas', tabela: 'saude_medidas', ordem: 't.data desc, t.created_at desc',
    schema: z.object({
      data, peso_kg: z.number().min(20).max(400).nullable().optional(), altura_cm: z.number().min(50).max(250).nullable().optional(),
      cintura_cm: z.number().min(30).max(250).nullable().optional(), gordura_pct: z.number().min(1).max(70).nullable().optional(),
      observacoes: z.string().max(2000).nullable().optional(),
    }),
  });
  crud(app, {
    rota: '/saude/treinos', tabela: 'saude_treinos', filtros: { tipo: 'tipo' }, ordem: 't.data desc, t.created_at desc',
    schema: z.object({
      data, tipo: z.enum(['musculacao', 'corrida', 'caminhada', 'bike', 'natacao', 'funcional', 'esporte', 'alongamento', 'outro']).default('musculacao'),
      duracao_min: z.number().int().min(1).max(1440), distancia_km: z.number().positive().max(1000).nullable().optional(),
      intensidade: z.number().int().min(1).max(5).nullable().optional(), observacoes: z.string().max(2000).nullable().optional(),
    }),
  });

  // doses: marcar/desmarcar remédio tomado num horário do dia
  app.post('/saude/remedios/:id/doses', async (req) => {
    const r = await doDono('saude_remedios', paramId(req), uid(req));
    const b = parse(z.object({ data: data.default(() => hojeSP()), horario: hora }), req.body);
    if (!r.horarios.includes(b.horario)) throw badRequest('Esse horário não está na receita do remédio');
    await pool.query(`insert into saude_doses (user_id, remedio_id, data, horario) values ($1,$2,$3,$4) on conflict do nothing`,
      [uid(req), r.id, b.data, b.horario]);
    return { ok: true };
  });
  app.delete('/saude/remedios/:id/doses', async (req) => {
    const r = await doDono('saude_remedios', paramId(req), uid(req));
    const q = parse(z.object({ data: data.default(() => hojeSP()), horario: hora }), req.query);
    await pool.query('delete from saude_doses where remedio_id = $1 and data = $2 and horario = $3', [r.id, q.data, q.horario]);
    return { ok: true };
  });

  /** Painel: doses de hoje, próximas consultas/retornos, peso e IMC, treinos da semana. */
  app.get('/saude/resumo', async (req) => {
    const u = uid(req);
    const hoje = hojeSP();
    const [rem, doses, consultas, medidas, altura, treinos] = await Promise.all([
      pool.query(`select * from saude_remedios where user_id = $1 and ativo and inicio <= $2 and (fim is null or fim >= $2) order by nome`, [u, hoje]),
      pool.query('select remedio_id, horario, tomado_em from saude_doses where user_id = $1 and data = $2', [u, hoje]),
      pool.query(`select * from saude_consultas where user_id = $1 and status = 'agendada' and data >= $2 order by data, hora nulls last limit 6`, [u, hoje]),
      pool.query(`select data, peso_kg from saude_medidas where user_id = $1 and peso_kg is not null order by data desc limit 60`, [u]),
      pool.query(`select altura_cm from saude_medidas where user_id = $1 and altura_cm is not null order by data desc limit 1`, [u]),
      pool.query(`select tipo, count(*)::int as qtd, sum(duracao_min)::int as minutos from saude_treinos
                   where user_id = $1 and data >= $2 group by tipo order by minutos desc`, [u, somarDias(hoje, -6)]),
    ]);
    const tomadas = new Set(doses.rows.map((d) => `${d.remedio_id}|${d.horario}`));
    const doseHoje = rem.rows.flatMap((r) => r.horarios.map((h: string) => ({
      remedio_id: r.id, nome: r.nome, dosagem: r.dosagem, horario: h, tomada: tomadas.has(`${r.id}|${h}`),
    }))).sort((a, b) => a.horario.localeCompare(b.horario));
    const pesos = medidas.rows.map((m) => ({ data: m.data, peso_kg: Number(m.peso_kg) })).reverse();
    const ultimo = pesos[pesos.length - 1] ?? null;
    const ha30 = pesos.filter((p) => p.data <= somarDias(hoje, -30)).pop() ?? pesos[0] ?? null;
    const alturaCm = altura.rows[0] ? Number(altura.rows[0].altura_cm) : null;
    // retornos pendentes: consulta realizada com retorno marcado e sem nova consulta agendada depois
    const retornos = (await pool.query(
      `select c.* from saude_consultas c where c.user_id = $1 and c.status = 'realizada' and c.retorno_em is not null
          and c.retorno_em >= $2
          and not exists (select 1 from saude_consultas n where n.user_id = c.user_id and n.titulo = c.titulo and n.data > c.data)
        order by c.retorno_em limit 5`, [u, somarDias(hoje, -60)])).rows;
    return {
      doses_hoje: doseHoje,
      proximas_consultas: consultas.rows,
      retornos,
      peso: ultimo ? {
        atual: ultimo.peso_kg, data: ultimo.data,
        variacao_30d: ha30 && ha30.data !== ultimo.data ? Math.round((ultimo.peso_kg - ha30.peso_kg) * 10) / 10 : null,
        imc: alturaCm ? imc(ultimo.peso_kg, alturaCm) : null,
        historico: pesos,
      } : null,
      treinos_semana: treinos.rows,
    };
  });
}

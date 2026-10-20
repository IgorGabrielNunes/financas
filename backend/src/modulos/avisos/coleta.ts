// Coleta dos dados do dia para os avisos. Recebe a função de consulta por parâmetro para rodar
// com `pg` (API, testes) ou com o driver HTTP do Neon (Worker da Cloudflare).
import { diaSemana, ocorreEm } from '../tarefas/dominio.js';
import { fichasDoDia } from '../academia/dominio.js';
import { diaNoMes, somarDias } from '../../core/datas.js';
import type { ConfigAvisos, DadosCasa, DadosDoDia } from './dominio.js';

export type Consultar = <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;

export const SELECT_CONFIG = `
  select c.*, u.nome, u.casa_id from notif_config c join usuarios u on u.id = c.user_id
   where c.ativo and u.ativo`;

export const SELECT_CASAS = `select * from notif_casa where ativo and telegram_chat_id is not null`;

export async function coletarDia(q: Consultar, cfg: Pick<ConfigAvisos, 'user_id'> & { casa_id: string }, dia: string): Promise<DadosDoDia> {
  const u = cfg.user_id;
  const [tarefas, conclusoes, remedios, doses, consultas, entrevistas, fichas, exercicios, feitos, ultimaRod, planos] = await Promise.all([
    q(`select id, titulo, data::text as data, repeticao, dias_semana, fim::text as fim, concluida_em from tarefas
        where not arquivada and (user_id = $1 or (compartilhada and casa_id = $2))
          and (responsavel_id is null or responsavel_id = $1)`, [u, cfg.casa_id]),
    q(`select c.tarefa_id from tarefa_conclusoes c join tarefas t on t.id = c.tarefa_id
        where c.data = $2 and (t.user_id = $1 or (t.compartilhada and t.casa_id = $3))`, [u, dia, cfg.casa_id]),
    q(`select id, nome, dosagem, horarios from saude_remedios
        where user_id = $1 and ativo and inicio <= $2 and (fim is null or fim >= $2)`, [u, dia]),
    q('select remedio_id, horario from saude_doses where user_id = $1 and data = $2', [u, dia]),
    q(`select id, titulo, tipo, data::text as data, hora, local from saude_consultas
        where user_id = $1 and status = 'agendada' and data = $2`, [u, dia]),
    q(`select e.id, v.empresa, e.etapa, e.data::text as data, e.hora, e.link from prof_entrevistas e
         join prof_vagas v on v.id = e.vaga_id where e.user_id = $1 and e.resultado = 'agendada' and e.data = $2`, [u, dia]),
    q('select id, nome, foco, dias_semana, horario, ordem, ativa from academia_fichas where user_id = $1', [u]),
    q('select ficha_id, count(*)::int as n from academia_exercicios where user_id = $1 group by ficha_id', [u]),
    q('select ficha_id from saude_treinos where user_id = $1 and data = $2 and ficha_id is not null', [u, dia]),
    q(`select t.ficha_id from saude_treinos t join academia_fichas f on f.id = t.ficha_id
        where t.user_id = $1 and cardinality(f.dias_semana) = 0 and t.data < $2::date order by t.data desc, t.created_at desc limit 1`, [u, dia]),
    q(`select p.id, p.aplica_em from dieta_planos p where p.user_id = $1 and p.ativo`, [u]),
  ]);

  // tarefas do dia (pendentes): avulsas de hoje/atrasadas + ocorrências das repetidas
  const feitasHoje = new Set(conclusoes.map((c: any) => c.tarefa_id));
  const listaTarefas: DadosDoDia['tarefas'] = [];
  for (const t of tarefas as any[]) {
    const data = t.data === null ? null : String(t.data).slice(0, 10);
    if (t.repeticao === 'nenhuma') {
      if (!t.concluida_em && data && data <= dia) listaTarefas.push({ titulo: t.titulo, atrasada: data < dia });
    } else if (!feitasHoje.has(t.id) && ocorreEm({ data, repeticao: t.repeticao, dias_semana: t.dias_semana?.map(Number) ?? null, fim: t.fim ? String(t.fim).slice(0, 10) : null }, dia)) {
      listaTarefas.push({ titulo: t.titulo, atrasada: false });
    }
  }
  listaTarefas.sort((a, b) => Number(b.atrasada) - Number(a.atrasada));

  const tomadas = new Set(doses.map((d: any) => `${d.remedio_id}|${d.horario}`));
  const listaDoses = (remedios as any[]).flatMap((r) => (r.horarios ?? []).map((h: string) => ({
    remedio_id: r.id, nome: r.nome, dosagem: r.dosagem, horario: h, tomada: tomadas.has(`${r.id}|${h}`),
  }))).sort((a, b) => a.horario.localeCompare(b.horario));

  // treinos: fixos do dia + próximo do rodízio (a última do rodízio é a de antes de hoje,
  // senão quem treinou hoje veria a "próxima" e não a de hoje)
  const resumo = (fichas as any[]).map((f) => ({ ...f, dias_semana: (f.dias_semana ?? []).map(Number) }));
  const { fixas, rodizio } = fichasDoDia(resumo, diaSemana(dia), (ultimaRod[0] as any)?.ficha_id ?? null);
  const nEx = new Map((exercicios as any[]).map((e) => [e.ficha_id, e.n]));
  const feitas = new Set((feitos as any[]).map((f) => f.ficha_id));
  const treinoHojeFeito = feitas.size > 0;
  const treinos: DadosDoDia['treinos'] = [
    ...fixas.map((f: any) => ({ f, rodizio: false })),
    ...(rodizio ? [{ f: rodizio as any, rodizio: true }] : []),
  ].map(({ f, rodizio: r }) => ({
    ficha_id: f.id, nome: f.nome, foco: f.foco, horario: f.horario, exercicios: nEx.get(f.id) ?? 0,
    // rodízio: qualquer treino com ficha hoje conta como "já treinou"
    feito: feitas.has(f.id) || (r && treinoHojeFeito), rodizio: r,
  }));

  // refeições com lembrete do plano que vale hoje
  let refeicoes: DadosDoDia['refeicoes'] = [];
  if (planos.length) {
    const diaDeTreino = fixas.length > 0 || treinoHojeFeito;
    const p = (planos as any[]).find((x) => x.aplica_em === (diaDeTreino ? 'treino' : 'descanso')) ?? (planos as any[]).find((x) => x.aplica_em === 'todos');
    if (p) {
      const rs = await q(`select r.id, r.nome, r.horario, r.lembrar,
                                 exists(select 1 from dieta_registros g where g.refeicao_id = r.id and g.data = $2) as feita
                            from dieta_refeicoes r where r.plano_id = $1 order by r.ordem`, [p.id, dia]);
      refeicoes = rs as any;
    }
  }

  return {
    data: dia, tarefas: listaTarefas, doses: listaDoses, treinos, refeicoes,
    consultas: consultas as any, entrevistas: entrevistas as any,
  };
}

/** Dados do grupo da casa: tarefas compartilhadas do dia e contas/faturas vencendo. */
export async function coletarCasa(q: Consultar, casaId: string, dia: string, diasAntes: number): Promise<DadosCasa> {
  const ate = somarDias(dia, diasAntes);
  const [tarefas, conclusoes, previstos, recorrencias, faturas] = await Promise.all([
    q(`select t.id, t.titulo, t.data::text as data, t.repeticao, t.dias_semana, t.fim::text as fim, t.concluida_em, r.nome as responsavel
         from tarefas t left join usuarios r on r.id = t.responsavel_id
        where t.casa_id = $1 and t.compartilhada and not t.arquivada`, [casaId]),
    q(`select c.tarefa_id from tarefa_conclusoes c join tarefas t on t.id = c.tarefa_id where t.casa_id = $1 and c.data = $2`, [casaId, dia]),
    // contas previstas (fixos já gerados no mês ou lançamentos futuros), fora do cartão
    q(`select descricao, valor_centavos::bigint as valor_centavos, data::text as data, recorrencia_id, competencia::text as competencia
         from lancamentos where casa_id = $1 and tipo = 'despesa' and meio <> 'credito' and status = 'previsto' and data <= $2`, [casaId, ate]),
    // fixos que ainda não viraram lançamento no mês (a geração acontece quando alguém abre o app)
    q(`select r.id, r.descricao, r.valor_previsto_centavos::bigint as valor, r.dia_mes, r.inicio::text as inicio, r.fim::text as fim,
              (select array_agg(l.competencia::text) from lancamentos l where l.recorrencia_id = r.id) as competencias
         from recorrencias r where r.casa_id = $1 and r.ativa and r.tipo = 'despesa' and r.meio <> 'credito'`, [casaId]),
    q(`select ca.nome, f.data_vencimento::text as vencimento, f.valor_pago_centavos::bigint as pago,
              coalesce(sum(p.valor_centavos), 0)::bigint as total
         from faturas f join cartoes ca on ca.id = f.cartao_id left join parcelas p on p.fatura_id = f.id
        where f.casa_id = $1 and f.pago_em is null and f.data_vencimento <= $2 and f.data_vencimento >= $3
        group by f.id, ca.nome`, [casaId, ate, somarDias(dia, -5)]),
  ]);

  const feitas = new Set((conclusoes as any[]).map((c) => c.tarefa_id));
  const listaTarefas: DadosCasa['tarefas'] = [];
  for (const t of tarefas as any[]) {
    if (t.repeticao === 'nenhuma') {
      if (!t.concluida_em && t.data && t.data <= dia) listaTarefas.push({ titulo: t.titulo, responsavel: t.responsavel, atrasada: t.data < dia });
    } else if (!feitas.has(t.id) && ocorreEm({ data: t.data, repeticao: t.repeticao, dias_semana: t.dias_semana?.map(Number) ?? null, fim: t.fim }, dia)) {
      listaTarefas.push({ titulo: t.titulo, responsavel: t.responsavel, atrasada: false });
    }
  }
  listaTarefas.sort((a, b) => Number(b.atrasada) - Number(a.atrasada));

  const contas: DadosCasa['contas'] = [];
  // previstos vencidos há mais de 5 dias são "esquecidos" (provavelmente pagos sem confirmar): não poluem o grupo
  for (const l of previstos as any[]) {
    if (l.data >= somarDias(dia, -5)) contas.push({ descricao: l.descricao, valor_centavos: Number(l.valor_centavos), vencimento: l.data, tipo: 'conta' });
  }
  for (const r of recorrencias as any[]) {
    const geradas = new Set<string>(r.competencias ?? []);
    for (let x = dia; x <= ate; x = somarDias(x, 1)) {
      const ano = Number(x.slice(0, 4)), mes = Number(x.slice(5, 7));
      const comp = `${x.slice(0, 7)}-01`;
      if (diaNoMes(ano, mes, Number(r.dia_mes)) !== x) continue;
      if (comp < r.inicio.slice(0, 10) || (r.fim && comp > r.fim.slice(0, 10)) || geradas.has(comp)) continue;
      contas.push({ descricao: r.descricao, valor_centavos: Number(r.valor), vencimento: x, tipo: 'conta' });
    }
  }
  for (const f of faturas as any[]) {
    const aberto = Number(f.total) - Number(f.pago);
    if (aberto > 0) contas.push({ descricao: f.nome, valor_centavos: aberto, vencimento: f.vencimento, tipo: 'fatura' });
  }
  return { data: dia, tarefas: listaTarefas, contas };
}

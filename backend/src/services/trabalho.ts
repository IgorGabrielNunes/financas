import type { PoolClient } from 'pg';
import { competencia, fmt, hojeSP, mesDe, parse, somarMeses } from '../domain/datas.js';
import { carregarVinculo, decimoDoAno, liquidoQueCaiEm } from './salario.js';
import { sincronizarRecorrencia } from './vinculos.js';

/**
 * Fixo do salário: valor = líquido que cai no mês atual (histórico) ou o informado no perfil.
 * Meses futuros usam o histórico na materialização (um aumento com vigência futura entra sozinho).
 */
export async function syncSalario(c: PoolClient, userId: string, pessoaId: string) {
  const v = await carregarVinculo(c, pessoaId);
  if (!v) {
    await sincronizarRecorrencia(c, userId, 'salario', pessoaId, null);
    return;
  }
  const p = v.pessoa;
  const hoje = hojeSP();
  const doHistorico = liquidoQueCaiEm(v, competencia(mesDe(hoje)));
  const liquido = doHistorico?.liquido ?? (p.salario_centavos ? Number(p.salario_centavos) : null);
  if (doHistorico && Number(p.salario_centavos) !== doHistorico.liquido) {
    await c.query('update pessoas set salario_centavos = $2 where id = $1', [pessoaId, doHistorico.liquido]);
  }
  const ok = liquido && liquido > 0 && p.dia_salario;
  await sincronizarRecorrencia(c, userId, 'salario', pessoaId, ok
    ? {
        descricao: `Salário (${p.nome})`, tipo: 'receita', valor_previsto_centavos: liquido!, dia_mes: p.dia_salario,
        meio: 'transferencia', conta_id: p.conta_salario_id, categoria: 'Salário', pessoa_id: p.id,
        // se o dia do salário deste mês já passou, ele já está no saldo: a previsão começa no mês que vem
        inicio: competencia(+hoje.slice(8, 10) > p.dia_salario ? somarMeses(mesDe(hoje), 1) : mesDe(hoje)),
        fim: null,
      }
    : null);
  await syncDecimo(c, userId, v);
}

async function syncDecimo(c: PoolClient, userId: string, v: NonNullable<Awaited<ReturnType<typeof carregarVinculo>>>) {
  const p = v.pessoa;
  const hoje = hojeSP();
  const ano = hoje > fmt(parse(hoje).ano, 12, 20) ? parse(hoje).ano + 1 : parse(hoje).ano;
  const d = p.gerar_decimo ? decimoDoAno(v, ano) : null;
  const base = { tipo: 'receita' as const, meio: 'transferencia' as const, conta_id: p.conta_salario_id, categoria: '13º salário', pessoa_id: p.id };
  await sincronizarRecorrencia(c, userId, 'decimo1', p.id, d && d.primeira > 0
    ? { ...base, descricao: `13º 1ª parcela (${p.nome})`, valor_previsto_centavos: d.primeira, dia_mes: 30, inicio: fmt(ano, 11, 1), fim: fmt(ano, 11, 1) }
    : null);
  await sincronizarRecorrencia(c, userId, 'decimo2', p.id, d && d.segunda > 0
    ? { ...base, descricao: `13º 2ª parcela (${p.nome})`, valor_previsto_centavos: d.segunda, dia_mes: 20, inicio: fmt(ano, 12, 1), fim: fmt(ano, 12, 1) }
    : null);
}

/** Chamado nas leituras do painel/mês: mantém salário e 13º em dia na virada de mês/ano (no-op se nada mudou). */
export async function garantirVinculos(c: PoolClient, userId: string) {
  const r = await c.query<{ id: string }>('select id from pessoas where user_id = $1', [userId]);
  for (const p of r.rows) await syncSalario(c, userId, p.id);
}

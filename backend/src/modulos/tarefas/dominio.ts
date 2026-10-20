import { type ISODate, diaNoMes, parse, somarDias } from '../../core/datas.js';

export type Repeticao = 'nenhuma' | 'diaria' | 'semanal' | 'mensal';
export type RegraTarefa = {
  data: ISODate | null;          // início da série (repetida) ou data da avulsa
  repeticao: Repeticao;
  dias_semana: number[] | null;  // 0 = domingo
  fim: ISODate | null;
};

/** Dia da semana de uma data civil (0 = domingo), sem fuso. */
export function diaSemana(d: ISODate): number {
  const p = parse(d);
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay();
}

/** A tarefa repetida cai nesta data? */
export function ocorreEm(r: RegraTarefa, d: ISODate): boolean {
  if (r.repeticao === 'nenhuma' || !r.data) return false;
  if (d < r.data || (r.fim && d > r.fim)) return false;
  switch (r.repeticao) {
    case 'diaria':
      return true;
    case 'semanal':
      return (r.dias_semana ?? []).includes(diaSemana(d));
    case 'mensal': {
      // dia 31 vira o último dia em meses curtos (cai uma vez por mês, sempre)
      const p = parse(d);
      return d === diaNoMes(p.ano, p.mes, parse(r.data).dia);
    }
  }
}

/** Ocorrências de uma tarefa repetida entre `de` e `ate` (inclusive). Limite de 400 dias por segurança. */
export function ocorrencias(r: RegraTarefa, de: ISODate, ate: ISODate): ISODate[] {
  if (r.repeticao === 'nenhuma' || !r.data) return [];
  const out: ISODate[] = [];
  let d = de < r.data ? r.data : de;
  for (let i = 0; d <= ate && i < 400; i++, d = somarDias(d, 1)) {
    if (ocorreEm(r, d)) out.push(d);
  }
  return out;
}

/** Próxima ocorrência a partir de `de` (inclusive), procurando até ~1 ano à frente. */
export function proximaOcorrencia(r: RegraTarefa, de: ISODate): ISODate | null {
  return ocorrencias(r, de, somarDias(de, 370))[0] ?? null;
}

/**
 * Sequência atual de ocorrências feitas (streak), contando para trás a partir de hoje.
 * Hoje ainda não feito não quebra a sequência (o dia não acabou).
 */
export function sequencia(r: RegraTarefa, feitas: Set<ISODate>, hoje: ISODate): number {
  if (r.repeticao === 'nenhuma' || !r.data) return 0;
  const passadas = ocorrencias(r, somarDias(hoje, -399), hoje).reverse();
  let n = 0;
  for (const d of passadas) {
    if (feitas.has(d)) n++;
    else if (d === hoje) continue;
    else break;
  }
  return n;
}

export function descreverRepeticao(r: RegraTarefa): string {
  const NOMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  switch (r.repeticao) {
    case 'nenhuma': return '';
    case 'diaria': return 'Todo dia';
    case 'mensal': return `Todo dia ${r.data ? parse(r.data).dia : ''} do mês`;
    case 'semanal': {
      const ds = [...(r.dias_semana ?? [])].sort();
      if (ds.length === 7) return 'Todo dia';
      if (ds.join() === '1,2,3,4,5') return 'Dias úteis';
      if (ds.join() === '0,6') return 'Fins de semana';
      return ds.map((x) => NOMES[x]).join(', ');
    }
  }
}

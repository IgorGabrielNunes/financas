// Datas de negócio trafegam como 'YYYY-MM-DD' (sem fuso). Nada de `new Date('2026-10-19')`
// solto pelo código: isso vira UTC meia-noite e, em America/Sao_Paulo, "volta" um dia.

export type ISODate = string; // 'YYYY-MM-DD'
export type Mes = { ano: number; mes: number }; // mes 1..12

export function parse(d: ISODate): { ano: number; mes: number; dia: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Data inválida: ${d}`);
  return { ano: +m[1], mes: +m[2], dia: +m[3] };
}

export function fmt(ano: number, mes: number, dia: number): ISODate {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function ultimoDia(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Dia do mês "grampeado": dia 31 em fevereiro vira 28/29. */
export function diaNoMes(ano: number, mes: number, dia: number): ISODate {
  return fmt(ano, mes, Math.min(dia, ultimoDia(ano, mes)));
}

export function somarMeses(m: Mes, n: number): Mes {
  const idx = m.ano * 12 + (m.mes - 1) + n;
  return { ano: Math.floor(idx / 12), mes: (idx % 12) + 1 };
}

export function mesDe(d: ISODate): Mes {
  const { ano, mes } = parse(d);
  return { ano, mes };
}

export function competencia(m: Mes): ISODate {
  return fmt(m.ano, m.mes, 1);
}

export function hojeSP(): ISODate {
  // data civil em São Paulo, independente do TZ do servidor (Render roda em UTC)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// ---- aritmética de dias (UTC puro, sem fuso) ----
const ms = (d: ISODate) => { const p = parse(d); return Date.UTC(p.ano, p.mes - 1, p.dia); };
const deMs = (t: number): ISODate => { const x = new Date(t); return fmt(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); };

export function somarDias(d: ISODate, n: number): ISODate {
  return deMs(ms(d) + n * 86400000);
}
/** Dias corridos de a até b, contando os dois extremos (a == b → 1). */
export function diasInclusivos(a: ISODate, b: ISODate): number {
  return Math.round((ms(b) - ms(a)) / 86400000) + 1;
}
/** Mesma data n meses depois, grampeando o dia (31/01 + 1 mês = 28/02). */
export function somarMesesData(d: ISODate, n: number): ISODate {
  const p = parse(d);
  const m = somarMeses({ ano: p.ano, mes: p.mes }, n);
  return diaNoMes(m.ano, m.mes, p.dia);
}
export const maxData = (a: ISODate, b: ISODate) => (a > b ? a : b);
export const minData = (a: ISODate, b: ISODate) => (a < b ? a : b);

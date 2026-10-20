import { type ISODate, diaNoMes, mesDe, parse, somarMeses, competencia } from '../../../core/datas.js';

/** Vencimento da parcela k (1-based) de uma série mensal que começa em `primeira`. */
export function vencimentoParcela(primeira: ISODate, k: number): ISODate {
  const { dia } = parse(primeira);
  const m = somarMeses(mesDe(primeira), k - 1);
  return diaNoMes(m.ano, m.mes, dia);
}

export type Cronograma = {
  pagas: number;               // parcelas com vencimento até hoje (assume em dia)
  restantes: number;
  proxima: ISODate | null;
  ultima: ISODate;
  competenciaInicio: ISODate;  // mês da 1ª parcela
  competenciaFim: ISODate;     // mês da última parcela
};

/**
 * Situação de uma série de parcelas mensais fixas, derivada só de datas — nada de
 * "parcelas pagas" digitado à mão que fica desatualizado no mês seguinte.
 * Premissa: pagamentos em dia. Atraso é inadimplência e tem sua própria área.
 */
export function cronograma(primeira: ISODate, total: number, hoje: ISODate): Cronograma {
  let pagas = 0;
  // série curta (<= 600): laço simples é mais legível que aritmética de datas
  while (pagas < total && vencimentoParcela(primeira, pagas + 1) <= hoje) pagas++;
  const ultima = vencimentoParcela(primeira, total);
  return {
    pagas,
    restantes: total - pagas,
    proxima: pagas < total ? vencimentoParcela(primeira, pagas + 1) : null,
    ultima,
    competenciaInicio: competencia(mesDe(primeira)),
    competenciaFim: competencia(mesDe(ultima)),
  };
}

/**
 * Valor presente das parcelas restantes (Price): quanto custaria quitar hoje, aproximadamente.
 * PV = P × (1 − (1+i)^−n) / i. Sem taxa informada, devolve null (o saldo nominal é o teto).
 * É estimativa: o banco aplica a taxa do contrato e pode cobrar tarifas na quitação.
 */
export function valorPresente(parcelaCentavos: number, restantes: number, taxaMensalPct: number | null): number | null {
  if (taxaMensalPct === null || restantes <= 0) return restantes <= 0 ? 0 : null;
  const i = taxaMensalPct / 100;
  if (i === 0) return parcelaCentavos * restantes;
  return Math.round((parcelaCentavos * (1 - Math.pow(1 + i, -restantes))) / i);
}

/** Data em que a negativação deixa de poder constar no cadastro (prazo máximo de 5 anos). */
export function limiteNegativacao(desde: ISODate): ISODate {
  const { ano, mes, dia } = parse(desde);
  return diaNoMes(ano + 5, mes, dia);
}

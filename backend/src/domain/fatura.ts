import { ISODate, Mes, diaNoMes, mesDe, somarMeses, competencia } from './datas.js';

export type RegraCartao = { diaFechamento: number; diaVencimento: number };

export type Ciclo = {
  competencia: ISODate;     // 1º dia do mês do vencimento — chave da fatura
  dataFechamento: ISODate;
  dataVencimento: ISODate;
};

/**
 * Ciclo (fatura) cujo fechamento ocorre no mês `mesFechamento`.
 * Vencimento: se o dia de vencimento é maior que o de fechamento, vence no mesmo mês;
 * senão, no mês seguinte (ex.: fecha 28, vence 5).
 */
export function cicloPorMesFechamento(regra: RegraCartao, mesFechamento: Mes): Ciclo {
  const dataFechamento = diaNoMes(mesFechamento.ano, mesFechamento.mes, regra.diaFechamento);
  const mesVenc = regra.diaVencimento > regra.diaFechamento ? mesFechamento : somarMeses(mesFechamento, 1);
  const dataVencimento = diaNoMes(mesVenc.ano, mesVenc.mes, regra.diaVencimento);
  return { competencia: competencia(mesVenc), dataFechamento, dataVencimento };
}

/**
 * Mês de fechamento do ciclo em que cai uma compra.
 * Regra adotada (a mesma da maioria dos emissores BR): compra feita NO dia do fechamento
 * ou depois dele entra no ciclo seguinte. O "melhor dia de compra" é o próprio dia do fechamento.
 * Se o seu banco divergir, este é o único ponto a mudar (trocar `>=` por `>`).
 */
export function mesFechamentoDaCompra(regra: RegraCartao, dataCompra: ISODate): Mes {
  const m = mesDe(dataCompra);
  const fechamentoDoMes = diaNoMes(m.ano, m.mes, regra.diaFechamento);
  return dataCompra >= fechamentoDoMes ? somarMeses(m, 1) : m; // comparação lexicográfica é segura em YYYY-MM-DD
}

/**
 * Divide o total em N parcelas inteiras (centavos). A diferença de arredondamento vai para a
 * 1ª parcela — padrão dos emissores — garantindo que a soma bata exatamente com o total.
 */
export function dividirParcelas(totalCentavos: number, n: number): number[] {
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) throw new Error('Total inválido');
  if (!Number.isInteger(n) || n < 1) throw new Error('Número de parcelas inválido');
  const base = Math.floor(totalCentavos / n);
  const resto = totalCentavos - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + resto : base));
}

export type ParcelaPlanejada = { numero: number; valorCentavos: number; ciclo: Ciclo };

/** Plano completo de uma compra no crédito: em qual fatura cai cada parcela. */
export function planejarCompra(
  regra: RegraCartao,
  dataCompra: ISODate,
  totalCentavos: number,
  parcelas: number,
): ParcelaPlanejada[] {
  const primeiro = mesFechamentoDaCompra(regra, dataCompra);
  return dividirParcelas(totalCentavos, parcelas).map((valor, i) => ({
    numero: i + 1,
    valorCentavos: valor,
    ciclo: cicloPorMesFechamento(regra, somarMeses(primeiro, i)),
  }));
}

/** Fatura "corrente" = a que ainda está recebendo compras na data informada. */
export function cicloAtual(regra: RegraCartao, hoje: ISODate): Ciclo {
  return cicloPorMesFechamento(regra, mesFechamentoDaCompra(regra, hoje));
}

export type StatusFatura = 'aberta' | 'fechada' | 'paga' | 'parcial' | 'vencida';

export function statusFatura(
  f: { dataFechamento: ISODate; dataVencimento: ISODate; totalCentavos: number; valorPagoCentavos: number },
  hoje: ISODate,
): StatusFatura {
  if (f.totalCentavos > 0 && f.valorPagoCentavos >= f.totalCentavos) return 'paga';
  if (f.totalCentavos === 0 && f.valorPagoCentavos === 0 && hoje >= f.dataFechamento) return 'paga';
  if (hoje < f.dataFechamento) return 'aberta';
  if (hoje > f.dataVencimento) return f.valorPagoCentavos > 0 ? 'parcial' : 'vencida';
  return f.valorPagoCentavos > 0 ? 'parcial' : 'fechada';
}


import type { PoolClient } from 'pg';
import {
  type ISODate, competencia, diaNoMes, fmt, hojeSP, mesDe, parse, somarMeses, ultimoDia,
} from '../../../core/datas.js';
import {
  avos13, calcularDecimo, calcularFerias, diasAvisoProporcional, estimarFgts, periodosFerias, salarioLiquido, tabela,
  type FeriasGozo,
} from '../dominio/clt.js';
import { cronograma } from '../dominio/cronograma.js';

export type Vinculo = {
  pessoa: any;
  salarios: { id: string; vigencia: ISODate; bruto_centavos: number; liquido_centavos: number | null; cargo: string | null; observacao: string | null }[];
  ferias: (FeriasGozo & { id: string })[];
  folha: { valor_parcela_centavos: number; primeira_parcela: ISODate; parcelas_total: number; quitada_em: ISODate | null }[];
};

export async function carregarVinculo(c: PoolClient, pessoaId: string): Promise<Vinculo | null> {
  const p = await c.query('select * from pessoas where id = $1', [pessoaId]);
  if (!p.rowCount) return null;
  const [s, f, d] = await Promise.all([
    c.query('select id, vigencia, bruto_centavos, liquido_centavos, cargo, observacao from salarios where pessoa_id = $1 order by vigencia', [pessoaId]),
    c.query('select id, inicio, dias, abono_dias from ferias_gozadas where pessoa_id = $1 order by inicio', [pessoaId]),
    c.query(
      `select valor_parcela_centavos, primeira_parcela, parcelas_total, quitada_em from dividas
        where pessoa_id = $1 and forma_pagamento = 'folha'`, [pessoaId]),
  ]);
  return { pessoa: p.rows[0], salarios: s.rows, ferias: f.rows, folha: d.rows };
}

/** Linha do histórico vigente numa data (a mais recente com vigência <= data). */
export function salarioVigente(v: Vinculo, data: ISODate) {
  let atual = null;
  for (const s of v.salarios) if (s.vigencia <= data) atual = s;
  return atual;
}
export const brutoEm = (v: Vinculo) => (data: ISODate) => salarioVigente(v, data)?.bruto_centavos ?? v.salarios[0]?.bruto_centavos ?? 0;

/** Consignado em folha ativo numa competência (sai antes de o salário cair). */
function consignadoEm(v: Vinculo, comp: ISODate): number {
  return v.folha
    .filter((d) => {
      if (d.quitada_em && d.quitada_em < comp) return false;
      const cr = cronograma(d.primeira_parcela, d.parcelas_total, hojeSP());
      return comp >= cr.competenciaInicio && comp <= cr.competenciaFim;
    })
    .reduce((s, d) => s + d.valor_parcela_centavos, 0);
}

export type LiquidoDetalhado = {
  referencia: ISODate; bruto: number; inss: number; irrf: number; outros: number; consignado: number; liquido: number;
  informado: boolean; tabelaAno: number;
};

/**
 * Líquido do salário que CAI na competência `comp`. Com `paga_mes_seguinte`, o salário recebido em novembro é o
 * de outubro — então o aumento com vigência em novembro só aparece no pagamento de dezembro.
 */
export function liquidoQueCaiEm(v: Vinculo, comp: ISODate): LiquidoDetalhado | null {
  if (!v.salarios.length) return null;
  const m = mesDe(comp);
  const ref = v.pessoa.paga_mes_seguinte ? somarMeses(m, -1) : m;
  const fimRef = fmt(ref.ano, ref.mes, ultimoDia(ref.ano, ref.mes));
  const s = salarioVigente(v, fimRef);
  if (!s) return null;
  const consignado = consignadoEm(v, competencia(m));
  const { ano: tabelaAno } = tabela(ref.ano);
  if (s.liquido_centavos) {
    return { referencia: competencia(ref), bruto: s.bruto_centavos, inss: 0, irrf: 0, outros: 0, consignado: 0, liquido: s.liquido_centavos, informado: true, tabelaAno };
  }
  const l = salarioLiquido(s.bruto_centavos, v.pessoa.dependentes_ir, Number(v.pessoa.outros_descontos_centavos), ref.ano);
  return { referencia: competencia(ref), bruto: l.bruto, inss: l.inss, irrf: l.irrf, outros: l.outros, consignado, liquido: l.liquido - consignado, informado: false, tabelaAno };
}

export async function liquidoCompetencia(c: PoolClient, pessoaId: string, comp: ISODate): Promise<number | null> {
  const v = await carregarVinculo(c, pessoaId);
  return v ? liquidoQueCaiEm(v, comp)?.liquido ?? null : null;
}

/** Estimativa do 13º do ano: salário vigente em dezembro × avos até 31/12 (supõe emprego até o fim do ano). */
export function decimoDoAno(v: Vinculo, ano: number) {
  const adm = v.pessoa.data_admissao as ISODate | null;
  if (!adm || !v.salarios.length || adm > fmt(ano, 12, 31)) return null;
  const sal = brutoEm(v)(fmt(ano, 12, 1));
  const avos = avos13(adm, fmt(ano, 12, 31), ano);
  return { ano, salarioBase: sal, ...calcularDecimo(sal, avos, v.pessoa.dependentes_ir, ano), datas: { primeira: fmt(ano, 11, 30), segunda: fmt(ano, 12, 20) } };
}

/** Situação trabalhista completa da pessoa para a tela (sem rescisão — essa é sob demanda). */
export function resumoTrabalho(v: Vinculo, hoje = hojeSP()) {
  const adm = v.pessoa.data_admissao as ISODate | null;
  const ano = parse(hoje).ano;
  const vig = salarioVigente(v, hoje) ?? v.salarios[0] ?? null;
  const liquidoAtual = liquidoQueCaiEm(v, competencia(mesDe(hoje)));
  const proximoMes = liquidoQueCaiEm(v, competencia(somarMeses(mesDe(hoje), 1)));
  let ferias = null;
  if (adm && vig) {
    const ps = periodosFerias(adm, hoje, v.pessoa.ferias_quitadas_ate, v.ferias);
    const disponiveis = ps.filter((p) => p.completo && p.diasSaldo > 0);
    const prox = disponiveis[0] ?? null;
    ferias = {
      periodos: ps.reverse(),
      diasDisponiveis: disponiveis.reduce((s, p) => s + p.diasSaldo, 0),
      prazoMaisProximo: prox?.limiteGozo ?? null,
      algumEmDobro: disponiveis.some((p) => p.emDobro),
      simulacao30: calcularFerias(vig.bruto_centavos, 30, 0, v.pessoa.dependentes_ir, ano),
      simulacaoVendendo10: calcularFerias(vig.bruto_centavos, 20, 10, v.pessoa.dependentes_ir, ano),
    };
  }
  const anoDecimo = hoje > fmt(ano, 12, 20) ? ano + 1 : ano;
  return {
    temHistorico: v.salarios.length > 0,
    salarioVigente: vig,
    liquidoAtual,
    liquidoProximoMes: proximoMes,
    ferias,
    decimo: decimoDoAno(v, anoDecimo),
    avisoPrevioDias: adm ? diasAvisoProporcional(adm, hoje) : null,
    fgtsEstimado: adm && vig
      ? estimarFgts(adm, hoje, brutoEm(v), v.pessoa.saldo_fgts_centavos === null ? null : Number(v.pessoa.saldo_fgts_centavos), v.pessoa.saldo_fgts_em)
      : null,
    tempoDeCasa: adm ? tempoEntre(adm, hoje) : null,
    tabelaAno: tabela(ano).ano,
  };
}

function tempoEntre(a: ISODate, b: ISODate) {
  const pa = parse(a), pb = parse(b);
  let meses = (pb.ano - pa.ano) * 12 + (pb.mes - pa.mes) - (pb.dia < pa.dia ? 1 : 0);
  return { anos: Math.floor(meses / 12), meses: meses % 12 };
}

export { diaNoMes };

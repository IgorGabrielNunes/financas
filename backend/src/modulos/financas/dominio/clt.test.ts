import { describe, expect, it } from 'vitest';
import {
  avos13, avosFerias, calcularDecimo, calcularFerias, calcularRescisao, diasAvisoProporcional, estimarFgts, inss, irrf,
  periodosFerias, salarioLiquido,
} from './clt.js';

describe('INSS 2026', () => {
  it('faixas e teto', () => {
    expect(inss(162100, 2026)).toBe(12158);   // 1.621,00 × 7,5%
    expect(inss(500000, 2026)).toBe(50151);   // 5.000 × 14% − 198,49
    expect(inss(1000000, 2026)).toBe(98809);  // acima do teto → contribui sobre 8.475,55
  });
});

describe('IRRF 2026 com redutor (Lei 15.270/2025)', () => {
  it('até R$ 5.000 zera (desconto simplificado + redução de até R$ 312,89)', () => {
    const r = irrf(500000, 50151, 0, 2026);
    expect(r.simplificado).toBe(true);
    expect(r.impostoTabela).toBe(31289);
    expect(r.imposto).toBe(0);
  });
  it('faixa de transição: R$ 6.000 → R$ 385,10', () => {
    const r = irrf(600000, inss(600000, 2026), 0, 2026);
    expect(r.impostoTabela).toBe(56485);
    expect(r.reducao).toBe(17975); // 978,62 − 0,133145 × 6.000
    expect(r.imposto).toBe(38510);
  });
  it('acima de R$ 7.350 não tem redução; dependente reduz a base', () => {
    expect(irrf(1000000, 98809, 0, 2026).reducao).toBe(0);
    expect(irrf(1000000, 98809, 2, 2026).imposto).toBeLessThan(irrf(1000000, 98809, 0, 2026).imposto);
  });
  it('líquido mensal desconta INSS, IR e outros', () => {
    expect(salarioLiquido(600000, 0, 15000, 2026)).toEqual({ bruto: 600000, inss: 64151, irrf: 38510, outros: 15000, liquido: 482339 });
  });
});

describe('avos', () => {
  it('13º: mês com 15+ dias conta', () => {
    expect(avos13('2026-03-17', '2026-12-31', 2026)).toBe(10); // 17–31/03 = 15 dias
    expect(avos13('2026-03-18', '2026-12-31', 2026)).toBe(9);
    expect(avos13('2020-01-01', '2026-10-19', 2026)).toBe(10); // outubro: 19 dias
  });
  it('férias: fração acima de 14 dias conta', () => {
    expect(avosFerias('2026-01-10', '2026-06-24')).toBe(6);
    expect(avosFerias('2026-01-10', '2026-06-23')).toBe(5);
  });
  it('aviso proporcional: 30 + 3 por ano completo, máx 90', () => {
    expect(diasAvisoProporcional('2020-03-01', '2026-10-19')).toBe(48);
    expect(diasAvisoProporcional('2026-01-01', '2026-10-19')).toBe(30);
    expect(diasAvisoProporcional('1990-01-01', '2026-10-19')).toBe(90);
  });
});

describe('férias', () => {
  it('períodos: quitados, FIFO de gozos, saldo e dobro', () => {
    const ps = periodosFerias('2022-05-02', '2026-10-19', '2023-05-01', [{ inicio: '2024-07-01', dias: 20, abono_dias: 10 }]);
    expect(ps.map((p) => [p.inicio, p.completo, p.quitado, p.diasSaldo, p.emDobro])).toEqual([
      ['2022-05-02', true, true, 0, false],
      ['2023-05-02', true, false, 0, false],   // 20 gozados + 10 vendidos
      ['2024-05-02', true, false, 30, false],  // limite de gozo 01/05/2026... ver abaixo
      ['2025-05-02', true, false, 30, false],
      ['2026-05-02', false, false, 15, false], // 5 meses + 18 dias = 6 avos × 2,5
    ].map((x, i) => (i === 2 ? [x[0], x[1], x[2], x[3], true] : x)));
    expect(ps[2].limiteGozo).toBe('2026-05-01');
  });
  it('30 dias com R$ 3.000: 1/3, INSS, IR zerado pelo redutor', () => {
    const f = calcularFerias(300000, 30, 0, 0, 2026);
    expect([f.valorFerias, f.tercoFerias, f.inss, f.irrf, f.liquido]).toEqual([300000, 100000, 36860, 0, 363140]);
  });
  it('venda de 10 dias: abono + 1/3 sem INSS/IR', () => {
    const f = calcularFerias(300000, 20, 10, 0, 2026);
    expect(f.abono).toBe(100000);
    expect(f.tercoAbono).toBe(33333);
    expect(f.inss).toBe(inss(200000 + 66667, 2026));
  });
});

describe('13º', () => {
  it('R$ 6.000 integral: 1ª metade sem desconto, 2ª com INSS e IR exclusivo (com redutor)', () => {
    expect(calcularDecimo(600000, 12, 0, 2026)).toEqual({
      avos: 12, total: 600000, primeira: 300000, inss: 64151, irrf: 38510, segunda: 197339, liquido: 497339,
    });
  });
});

describe('rescisão', () => {
  const base = {
    admissao: '2023-02-01', salarioEm: () => 400000, dependentes: 0, feriasQuitadasAte: '2025-01-31',
    gozos: [], saldoFgts: 1000000, saqueAniversario: false,
  };
  const valor = (r: any, codigo: string) => r.verbas.filter((v: any) => v.codigo === codigo).reduce((s: number, v: any) => s + v.valor, 0);

  it('sem justa causa, aviso indenizado proporcional com projeção', () => {
    const r = calcularRescisao({ ...base, tipo: 'sem_justa_causa', dataReferencia: '2026-10-19' });
    expect(r.diasAviso).toBe(39);
    expect(r.dataProjetada).toBe('2026-11-27');
    expect(valor(r, 'saldo')).toBe(253333);
    expect(valor(r, 'aviso')).toBe(520000);
    expect(valor(r, '13')).toBe(366667);            // 11/12 com a projeção
    expect(valor(r, 'ferias_venc')).toBe(400000);
    expect(valor(r, 'ferias_prop')).toBe(333333);   // 10 avos → 25 dias
    expect(valor(r, 'terco')).toBe(133333 + 111111);
    expect(valor(r, 'inss')).toBe(20368);
    expect(valor(r, 'irrf')).toBe(0);
    expect(valor(r, 'inss13')).toBe(32860);
    expect(valor(r, 'irrf13')).toBe(0);
    expect(r.proventos).toBe(2117777);
    expect(r.liquidoRescisao).toBe(2117777 - 53228);
    expect(r.fgts).toEqual({ saldoAntes: 1000000, depositoRescisorio: 91200, multa40: 436480, sacavel: 1527680, bloqueadoPorSaqueAniversario: false });
  });

  it('pedido de demissão com aviso trabalhado: sai 30 dias depois, sem FGTS', () => {
    const r = calcularRescisao({ ...base, tipo: 'pedido_demissao', dataReferencia: '2026-10-19' });
    expect(r.dataSaida).toBe('2026-11-18');
    expect(r.avisoTrabalhado).toBe(true);
    expect(valor(r, 'aviso')).toBe(0);
    expect(valor(r, 'saldo')).toBe(240000);
    expect(valor(r, '13')).toBe(366667);
    expect(valor(r, 'ferias_prop')).toBe(333333);
    expect(r.fgts.sacavel).toBe(0);
    expect(r.fgts.multa40).toBe(0);
  });

  it('justa causa: só saldo e férias vencidas + 1/3', () => {
    const r = calcularRescisao({ ...base, tipo: 'justa_causa', dataReferencia: '2026-10-19' });
    expect(r.verbas.filter((v) => v.tipo === 'provento').map((v) => v.codigo)).toEqual(['saldo', 'ferias_venc', 'terco']);
    expect(r.fgts.sacavel).toBe(0);
  });

  it('saque-aniversário: na sem justa só a multa é liberada', () => {
    const r = calcularRescisao({ ...base, tipo: 'sem_justa_causa', dataReferencia: '2026-10-19', saqueAniversario: true });
    expect(r.fgts.sacavel).toBe(r.fgts.multa40);
  });

  it('desligado em dezembro: desconta a 1ª parcela do 13º já adiantada', () => {
    const r = calcularRescisao({ ...base, tipo: 'justa_causa', dataReferencia: '2026-12-10' });
    expect(valor(r, '13adiant')).toBe(0); // justa causa nem tem 13º
    const r2 = calcularRescisao({ ...base, tipo: 'pedido_demissao', dataReferencia: '2026-11-05' }); // sai 05/12
    expect(valor(r2, '13adiant')).toBe(200000);
  });
});

describe('FGTS estimado', () => {
  it('8% ao mês + 8% do 13º, a partir da admissão', () => {
    // jan–mar/2026 completos com R$ 4.000 → 3 × 320
    expect(estimarFgts('2026-01-01', '2026-04-10', () => 400000, null, null)).toBe(96000);
  });
  it('a partir de saldo informado não conta o mês informado de novo', () => {
    expect(estimarFgts('2020-01-01', '2026-04-10', () => 400000, 500000, '2026-02-15')).toBe(500000 + 32000);
  });
});

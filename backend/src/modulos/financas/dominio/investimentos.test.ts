import { describe, expect, it } from 'vitest';
import { aliquotaIOF, aliquotaIR, diasUteis, feriados, OPCOES_PADRAO, posicao, simular, taxaAnual, type Modelo, type Taxas } from './investimentos.js';

const T: Taxas = { selic_aa: 13.75, cdi_aa: 13.65, ipca_aa: 5, tr_am: 0.15 };
const cdi = (taxa: number, isento_ir = false): Modelo => ({ indexador: 'cdi', taxa, isento_ir });
const pre = (taxa: number, isento_ir = false): Modelo => ({ indexador: 'prefixado', taxa, isento_ir });

describe('calendário', () => {
  it('dias úteis no intervalo (a, b], sem fim de semana', () => {
    expect(diasUteis('2026-10-23', '2026-10-26')).toBe(1);  // sex → seg
    expect(diasUteis('2026-10-19', '2026-10-26')).toBe(5);  // seg → seg
    expect(diasUteis('2026-10-24', '2026-10-25')).toBe(0);  // sáb → dom
    expect(diasUteis('2026-10-26', '2026-10-26')).toBe(0);
    // 261 dias de semana − 12 feriados em dia útil (carnaval, sexta santa, Tiradentes, 1º/5, Corpus Christi,
    // 7/9, 12/10, 2/11, 20/11, Natal, 1º/1/2027)
    expect(diasUteis('2026-01-05', '2027-01-05')).toBe(249);
    expect(diasUteis('2026-11-19', '2026-11-23')).toBe(1); // sexta 20/11 é feriado
    expect(feriados(2026).length).toBe(12); // 15/11 cai num domingo
    expect(feriados(2024).map((t) => new Date(t).toISOString().slice(0, 10))).toContain('2024-02-13'); // carnaval 2024
  });
});

describe('taxas', () => {
  it('100% do CDI é o próprio CDI; 110% aplica sobre a taxa diária', () => {
    expect(taxaAnual(cdi(100), T)).toBeCloseTo(0.1365, 6);
    const r = taxaAnual(cdi(110), T);
    expect(r).toBeGreaterThan(0.1365 * 1.1 - 0.002);
    expect(r).toBeLessThan(0.1365 * 1.1 + 0.003); // composto diário: um pouco acima de 1,1 × 13,65%
  });
  it('IPCA+ compõe inflação e juro real; prefixado é a própria taxa', () => {
    expect(taxaAnual({ indexador: 'ipca', taxa: 7.5, isento_ir: false }, T)).toBeCloseTo(1.05 * 1.075 - 1, 8);
    expect(taxaAnual(pre(12), T)).toBeCloseTo(0.12, 8);
  });
  it('poupança: Selic acima de 8,5% → 0,5% a.m. + TR; abaixo → 70% da Selic', () => {
    expect(taxaAnual({ indexador: 'poupanca', taxa: 0, isento_ir: true }, T)).toBeCloseTo(Math.pow(1.0065, 12) - 1, 8);
    const baixa = taxaAnual({ indexador: 'poupanca', taxa: 0, isento_ir: true }, { ...T, selic_aa: 7, tr_am: 0 });
    expect(baixa).toBeCloseTo(0.049, 3);
  });
  it('taxa de administração reduz o rendimento; ações não têm projeção', () => {
    expect(taxaAnual({ ...cdi(100), taxa_adm_aa: 0.5 }, T)).toBeCloseTo(1.1365 * 0.995 - 1, 8);
    expect(taxaAnual({ indexador: 'nenhum', taxa: 0, isento_ir: false }, T)).toBe(0);
  });
  it('tabelas de IR e IOF', () => {
    expect([aliquotaIR(30), aliquotaIR(181), aliquotaIR(361), aliquotaIR(721)]).toEqual([0.225, 0.2, 0.175, 0.15]);
    expect([aliquotaIOF(0), aliquotaIOF(1), aliquotaIOF(10), aliquotaIOF(29), aliquotaIOF(30)]).toEqual([1, 0.96, 0.66, 0.03, 0]);
  });
});

describe('posição', () => {
  it('um aporte de R$ 10 mil a 12% pré por um ano: rende por dia útil e paga 17,5% de IR', () => {
    const p = posicao([{ data: '2026-01-05', tipo: 'aporte', valor_centavos: 1_000_000 }], [], pre(12), T, '2027-01-05');
    const bruto = 1_000_000 * Math.pow(1.12, 249 / 252);
    expect(p.saldo_bruto_centavos).toBe(Math.round(bruto));
    expect(p.investido_centavos).toBe(1_000_000);
    expect(Math.abs(p.ir_centavos - (bruto - 1_000_000) * 0.175)).toBeLessThanOrEqual(1);
    expect(p.saldo_liquido_centavos).toBe(p.saldo_bruto_centavos - p.ir_centavos);
    expect(p.taxa_aa_pct).toBe(12);
    expect(p.taxa_liquida_aa_pct).toBe(9.9); // 12% × (1 − 17,5%)
    expect(p.origem).toBe('estimado');
  });

  it('isento (LCI) não paga IR; com menos de 30 dias paga IOF', () => {
    const isento = posicao([{ data: '2026-01-05', tipo: 'aporte', valor_centavos: 100_000 }], [], cdi(92, true), T, '2026-07-05');
    expect(isento.ir_centavos).toBe(0);
    const curto = posicao([{ data: '2026-10-01', tipo: 'aporte', valor_centavos: 1_000_000 }], [], cdi(100), T, '2026-10-11');
    const g = curto.rendimento_bruto_centavos;
    expect(Math.abs(curto.iof_centavos - g * 0.66)).toBeLessThanOrEqual(1);
    expect(Math.abs(curto.ir_centavos - g * 0.34 * 0.225)).toBeLessThanOrEqual(1);
  });

  it('resgate sai dos aportes mais antigos (FIFO) e leva principal proporcional', () => {
    const movs = [
      { data: '2026-01-05', tipo: 'aporte' as const, valor_centavos: 100_000 },
      { data: '2026-06-01', tipo: 'aporte' as const, valor_centavos: 100_000 },
      { data: '2026-06-01', tipo: 'resgate' as const, valor_centavos: 50_000 },
    ];
    const p = posicao(movs, [], pre(0), T, '2026-06-01'); // taxa zero: só conta principal
    expect(p.saldo_bruto_centavos).toBe(150_000);
    expect(p.investido_centavos).toBe(150_000);
    expect(p.aportado_centavos).toBe(200_000);
    expect(p.resgatado_centavos).toBe(50_000);
    // resgatar mais do que existe zera, sem ficar negativo
    const tudo = posicao([...movs, { data: '2026-06-02', tipo: 'resgate', valor_centavos: 999_999 }], [], pre(0), T, '2026-06-03');
    expect(tudo.saldo_bruto_centavos).toBe(0);
  });

  it('saldo informado corrige a estimativa e segue rendendo a partir dele', () => {
    const movs = [{ data: '2026-01-05', tipo: 'aporte' as const, valor_centavos: 1_000_000 }];
    const p = posicao(movs, [{ data: '2026-10-01', valor_centavos: 1_100_000 }], pre(12), T, '2026-10-01');
    expect(p.saldo_bruto_centavos).toBe(1_100_000);
    expect(p.rendimento_bruto_centavos).toBe(100_000);
    expect(p.origem).toBe('informado');
    const depois = posicao(movs, [{ data: '2026-10-01', valor_centavos: 1_100_000 }], pre(12), T, '2026-10-08');
    expect(depois.saldo_bruto_centavos).toBe(Math.round(1_100_000 * Math.pow(1.12, 5 / 252)));
  });

  it('saldo informado sem aportes (ações, já aplicado antes): vira o próprio principal', () => {
    const p = posicao([], [{ data: '2026-10-01', valor_centavos: 500_000 }], { indexador: 'nenhum', taxa: 0, isento_ir: false }, T, '2026-10-20');
    expect(p.saldo_bruto_centavos).toBe(500_000);
    expect(p.rendimento_bruto_centavos).toBe(0);
    expect(p.ir_estimado).toBe(false);
    expect(p.rendimento_mes_centavos).toBe(0);
  });
});

describe('simulação', () => {
  it('aporte único: investido, IR do prazo e taxa líquida coerentes', () => {
    const r = simular({ inicial_centavos: 1_000_000, mensal_centavos: 0, meses: 24, inicio: '2026-11-02' }, pre(12), T);
    expect(r.investido_centavos).toBe(1_000_000);
    expect(r.liquido_centavos).toBe(r.bruto_centavos - r.ir_centavos);
    expect(Math.abs(r.ir_centavos - (r.bruto_centavos - 1_000_000) * 0.15)).toBeLessThanOrEqual(1);
    expect(r.taxa_liquida_aa_pct).toBeGreaterThan(9.8);
    expect(r.taxa_liquida_aa_pct).toBeLessThan(10.4); // ≈ 12% × 0,85
    expect(r.serie.at(-1)).toEqual({ mes: 24, liquido_centavos: r.liquido_centavos, investido_centavos: 1_000_000 });
  });

  it('aportes mensais: investido = inicial + mensal × meses; isento rende mais que o tributado equivalente', () => {
    const s = { inicial_centavos: 100_000, mensal_centavos: 50_000, meses: 12, inicio: '2026-11-02' };
    const cdb = simular(s, cdi(100), T);
    const lci = simular(s, cdi(92, true), T);
    expect(cdb.investido_centavos).toBe(100_000 + 50_000 * 12);
    expect(cdb.serie).toHaveLength(12);
    expect(lci.ir_centavos).toBe(0);
    expect(lci.liquido_centavos).toBeGreaterThan(cdb.liquido_centavos);
  });

  it('catálogo: todas as opções padrão simulam sem erro e a poupança perde para o CDI', () => {
    const s = { inicial_centavos: 1_000_000, mensal_centavos: 0, meses: 36, inicio: '2026-11-02' };
    const res = Object.fromEntries(OPCOES_PADRAO.map((o) => [o.chave, simular(s, o.modelo, T)]));
    for (const r of Object.values(res)) expect(r.liquido_centavos).toBeGreaterThan(1_000_000);
    expect(res.caixinha.liquido_centavos).toBeGreaterThan(res.poupanca.liquido_centavos);
    expect(res.fundo_di.liquido_centavos).toBeLessThan(res.caixinha.liquido_centavos);
  });

  it('prazo longo usa série reduzida (até ~120 pontos)', () => {
    const r = simular({ inicial_centavos: 0, mensal_centavos: 10_000, meses: 360, inicio: '2026-11-02' }, cdi(100), T);
    expect(r.serie.length).toBeLessThanOrEqual(121);
    expect(r.serie.at(-1)!.mes).toBe(360);
  });
});

describe('ordem no mesmo dia', () => {
  it('saldo informado antes de um aporte do mesmo dia não engole o aporte; informado depois já o inclui', () => {
    const m = pre(0);
    const aporte = { data: '2026-10-20', tipo: 'aporte' as const, valor_centavos: 100_000, criado: '2026-10-20T15:00:00Z' };
    const antes = { data: '2026-10-20', valor_centavos: 540_000, criado: '2026-10-20T14:00:00Z' };
    const depois = { data: '2026-10-20', valor_centavos: 640_000, criado: '2026-10-20T16:00:00Z' };
    expect(posicao([aporte], [antes], m, T, '2026-10-21').saldo_bruto_centavos).toBe(640_000);
    expect(posicao([aporte], [depois], m, T, '2026-10-21').saldo_bruto_centavos).toBe(640_000);
  });
});

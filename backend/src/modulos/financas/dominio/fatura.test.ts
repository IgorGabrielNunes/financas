import { describe, expect, it } from 'vitest';
import { cicloAtual, dividirParcelas, mesFechamentoDaCompra, planejarCompra, statusFatura } from './fatura.js';

const nubankLike = { diaFechamento: 3, diaVencimento: 10 }; // fecha e vence no mesmo mês
const viraMes = { diaFechamento: 28, diaVencimento: 5 };    // vence no mês seguinte ao fechamento

describe('dividirParcelas', () => {
  it('soma sempre bate com o total; diferença na 1ª parcela', () => {
    expect(dividirParcelas(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(dividirParcelas(100, 7).reduce((a, b) => a + b, 0)).toBe(100);
    expect(dividirParcelas(1, 1)).toEqual([1]);
  });
  it('rejeita valores inválidos', () => {
    expect(() => dividirParcelas(0, 1)).toThrow();
    expect(() => dividirParcelas(10.5, 1)).toThrow();
    expect(() => dividirParcelas(100, 0)).toThrow();
  });
});

describe('ciclo da compra', () => {
  it('compra antes do fechamento entra na fatura do mês', () => {
    const [p] = planejarCompra(nubankLike, '2026-10-02', 5000, 1);
    expect(p.ciclo).toEqual({ competencia: '2026-10-01', dataFechamento: '2026-10-03', dataVencimento: '2026-10-10' });
  });
  it('compra NO dia do fechamento já vai para a próxima', () => {
    expect(mesFechamentoDaCompra(nubankLike, '2026-10-03')).toEqual({ ano: 2026, mes: 11 });
    const [p] = planejarCompra(nubankLike, '2026-10-03', 5000, 1);
    expect(p.ciclo.dataVencimento).toBe('2026-11-10');
  });
  it('vencimento no mês seguinte quando dia_venc <= dia_fech', () => {
    const [p] = planejarCompra(viraMes, '2026-10-19', 5000, 1);
    expect(p.ciclo).toEqual({ competencia: '2026-11-01', dataFechamento: '2026-10-28', dataVencimento: '2026-11-05' });
  });
  it('virada de ano', () => {
    const [p] = planejarCompra(viraMes, '2026-12-29', 5000, 1);
    expect(p.ciclo).toEqual({ competencia: '2027-02-01', dataFechamento: '2027-01-28', dataVencimento: '2027-02-05' });
  });
  it('dia 31 em mês curto é grampeado (fevereiro)', () => {
    const r = { diaFechamento: 31, diaVencimento: 10 };
    const [p] = planejarCompra(r, '2027-02-15', 5000, 1);
    expect(p.ciclo.dataFechamento).toBe('2027-02-28');
    expect(p.ciclo.dataVencimento).toBe('2027-03-10');
    // compra em 28/02 = dia do fechamento grampeado -> próximo ciclo
    expect(planejarCompra(r, '2027-02-28', 5000, 1)[0].ciclo.dataFechamento).toBe('2027-03-31');
  });
  it('parcelado: uma parcela por fatura consecutiva', () => {
    const plano = planejarCompra(nubankLike, '2026-10-19', 30000, 3);
    expect(plano.map((p) => [p.numero, p.valorCentavos, p.ciclo.competencia])).toEqual([
      [1, 10000, '2026-11-01'], [2, 10000, '2026-12-01'], [3, 10000, '2027-01-01'],
    ]);
  });
  it('fatura atual = a que ainda recebe compras hoje', () => {
    expect(cicloAtual(nubankLike, '2026-10-19').competencia).toBe('2026-11-01');
    expect(cicloAtual(nubankLike, '2026-10-01').competencia).toBe('2026-10-01');
  });
});

describe('statusFatura', () => {
  const f = { dataFechamento: '2026-11-03', dataVencimento: '2026-11-10', totalCentavos: 1000, valorPagoCentavos: 0 };
  it('ciclo de vida', () => {
    expect(statusFatura(f, '2026-11-02')).toBe('aberta');
    expect(statusFatura(f, '2026-11-03')).toBe('fechada');
    expect(statusFatura(f, '2026-11-11')).toBe('vencida');
    expect(statusFatura({ ...f, valorPagoCentavos: 500 }, '2026-11-05')).toBe('parcial');
    expect(statusFatura({ ...f, valorPagoCentavos: 1000 }, '2026-11-05')).toBe('paga');
  });
});

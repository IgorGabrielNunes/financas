import { describe, expect, it } from 'vitest';
import { planejarCompra } from '../dominio/fatura.js';
import { chaveDescricao, cicloDaFatura, planejarLinha, resolverData, sugerirCategoria } from './regras.js';

// Nubank do Igor: fecha dia 3, vence dia 10 (mesmo mês)
const nubank = { diaFechamento: 3, diaVencimento: 10 };
// Inter: fecha 25, vence 5 do mês seguinte
const inter = { diaFechamento: 25, diaVencimento: 5 };
const out26 = { ano: 2026, mes: 10 };

describe('fatura escolhida', () => {
  it('ciclo da fatura pelo mês de vencimento', () => {
    expect(cicloDaFatura(nubank, out26)).toEqual({ competencia: '2026-10-01', dataFechamento: '2026-10-03', dataVencimento: '2026-10-10' });
    expect(cicloDaFatura(inter, out26)).toEqual({ competencia: '2026-10-01', dataFechamento: '2026-09-25', dataVencimento: '2026-10-05' });
  });
  it('data sem ano usa o ano da fatura (dezembro numa fatura de janeiro é do ano anterior)', () => {
    expect(resolverData({ dia: 15, mes: 9, ano: null }, out26)).toBe('2026-09-15');
    expect(resolverData({ dia: 28, mes: 12, ano: null }, { ano: 2027, mes: 1 })).toBe('2026-12-28');
    expect(resolverData({ dia: 31, mes: 2, ano: 2026 }, out26)).toBe('2026-02-28');
  });
});

describe('planejar linha', () => {
  it('à vista dentro do ciclo', () => {
    const p = planejarLinha(nubank, out26, '2026-09-20', 5000, null);
    expect(p).toEqual({ data: '2026-09-20', valor_total: 5000, parcelas_total: 1, parcelas_pagas_antes: 0, competencia: '2026-10-01', fora_da_fatura: false });
  });

  it('à vista que o cadastro do cartão põe em outra fatura é sinalizada', () => {
    const p = planejarLinha(nubank, out26, '2026-10-03', 5000, null); // no dia do fechamento → próxima
    expect(p.fora_da_fatura).toBe(true);
    expect(p.competencia).toBe('2026-11-01');
  });

  it('parcela 3/12 com a data original da compra (Nubank) cai na fatura escolhida', () => {
    const p = planejarLinha(nubank, out26, '2026-07-15', 29990, { atual: 3, total: 12 });
    expect(p).toMatchObject({ data: '2026-07-15', valor_total: 359880, parcelas_total: 12, parcelas_pagas_antes: 2, fora_da_fatura: false });
    const plano = planejarCompra(nubank, p.data, p.valor_total, 12);
    expect(plano[2].ciclo.competencia).toBe('2026-10-01');
  });

  it('parcela com a data da fatura (outros bancos): data sintética leva a parcela k para a fatura certa', () => {
    const p = planejarLinha(inter, out26, '2026-09-20', 15000, { atual: 2, total: 4 });
    expect(p.parcelas_pagas_antes).toBe(1);
    expect(p.fora_da_fatura).toBe(false);
    expect(planejarCompra(inter, p.data, p.valor_total, 4)[1].ciclo.competencia).toBe('2026-10-01');
    // a 1ª parcela ficou um ciclo antes, a véspera do fechamento de agosto
    expect(p.data).toBe('2026-08-24');
  });

  it('fechamento no dia 1: véspera vira o último dia do mês anterior', () => {
    const r = { diaFechamento: 1, diaVencimento: 8 };
    const p = planejarLinha(r, out26, '2026-10-20', 1000, { atual: 2, total: 3 });
    expect(planejarCompra(r, p.data, p.valor_total, 3)[1].ciclo.competencia).toBe('2026-10-01');
    expect(p.fora_da_fatura).toBe(false);
  });
});

describe('categoria sugerida', () => {
  const cats = [
    { id: 'merc', nome: 'Mercado', tipo: 'despesa' }, { id: 'fora', nome: 'Alimentação fora', tipo: 'despesa' },
    { id: 'transp', nome: 'Transporte', tipo: 'despesa' }, { id: 'ass', nome: 'Assinaturas', tipo: 'despesa' },
    { id: 'comp', nome: 'Compras', tipo: 'despesa' }, { id: 'sal', nome: 'Salário', tipo: 'receita' },
  ];
  it('histórico ganha de tudo', () => {
    const h = new Map([[chaveDescricao('IFOOD *RESTAURANTE 123456'), 'merc']]);
    expect(sugerirCategoria('IFOOD *RESTAURANTE 987654', 'restaurantes', h, cats)).toBe('merc');
  });
  it('categoria do banco, depois palavras-chave', () => {
    expect(sugerirCategoria('Loja qualquer', 'supermercado', new Map(), cats)).toBe('merc');
    expect(sugerirCategoria('Loja qualquer', 'Mercado', new Map(), cats)).toBe('merc');
    expect(sugerirCategoria('UBER *TRIP HELP.UBER.COM', null, new Map(), cats)).toBe('transp');
    expect(sugerirCategoria('NETFLIX.COM', null, new Map(), cats)).toBe('ass');
    expect(sugerirCategoria('MERCADOLIVRE*VENDEDOR', null, new Map(), cats)).toBe('comp');
    expect(sugerirCategoria('MERCADO LIVRE', null, new Map(), cats)).toBe('comp');
    expect(sugerirCategoria('Mercado Bom Preço', null, new Map(), cats)).toBe('merc');
    expect(sugerirCategoria('Pagamento XYZ', null, new Map(), cats)).toBeNull();
  });
  it('chave ignora números de pedido e parcela', () => {
    expect(chaveDescricao('MAGALU*PEDIDO 123456 PARC 03/10')).toBe(chaveDescricao('Magalu pedido 998877'));
  });
});

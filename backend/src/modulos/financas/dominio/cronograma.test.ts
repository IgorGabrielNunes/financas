import { describe, expect, it } from 'vitest';
import { cronograma, limiteNegativacao, valorPresente, vencimentoParcela } from './cronograma.js';

describe('cronograma', () => {
  it('conta parcelas vencidas até hoje e projeta o fim', () => {
    const c = cronograma('2025-03-10', 24, '2026-10-19');
    // mar/25 .. out/26 = 20 vencimentos até 10/out/26
    expect(c.pagas).toBe(20);
    expect(c.restantes).toBe(4);
    expect(c.proxima).toBe('2026-11-10');
    expect(c.ultima).toBe('2027-02-10');
    expect(c.competenciaFim).toBe('2027-02-01');
  });
  it('vencimento no dia de hoje conta como paga', () => {
    expect(cronograma('2026-10-19', 3, '2026-10-19').pagas).toBe(1);
  });
  it('dia 31 respeita meses curtos sem "andar" o dia', () => {
    expect(vencimentoParcela('2026-01-31', 2)).toBe('2026-02-28');
    expect(vencimentoParcela('2026-01-31', 3)).toBe('2026-03-31');
  });
  it('quitada', () => {
    const c = cronograma('2020-01-05', 12, '2026-10-19');
    expect(c.restantes).toBe(0);
    expect(c.proxima).toBeNull();
  });
});

describe('valorPresente', () => {
  it('Price: 12x R$ 1.000 a 2% a.m. ≈ R$ 10.575,34', () => {
    expect(valorPresente(100000, 12, 2)).toBe(1057534);
  });
  it('sem taxa → null; sem parcelas → 0; taxa zero → nominal', () => {
    expect(valorPresente(100000, 12, null)).toBeNull();
    expect(valorPresente(100000, 0, 2)).toBe(0);
    expect(valorPresente(100000, 5, 0)).toBe(500000);
  });
});

describe('limiteNegativacao', () => {
  it('5 anos, inclusive 29/02', () => {
    expect(limiteNegativacao('2022-03-15')).toBe('2027-03-15');
    expect(limiteNegativacao('2024-02-29')).toBe('2029-02-28');
  });
});

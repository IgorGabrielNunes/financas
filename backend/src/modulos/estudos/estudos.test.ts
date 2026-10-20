import { describe, expect, it } from 'vitest';
import { situacaoDisciplina } from './rotas.js';
import { imc } from '../saude/rotas.js';

const av = (nota: number | null, peso = 1, nota_maxima = 10) => ({ nota, peso, nota_maxima });

describe('situação da disciplina', () => {
  it('aprovado/reprovado só com todas as notas', () => {
    expect(situacaoDisciplina([av(7), av(8)], 7)).toMatchObject({ media: 7.5, situacao: 'aprovado' });
    expect(situacaoDisciplina([av(5), av(6)], 7)).toMatchObject({ media: 5.5, situacao: 'reprovado' });
  });
  it('em risco quando nem nota máxima nas restantes salva', () => {
    expect(situacaoDisciplina([av(2, 3), av(null, 1)], 7)).toMatchObject({ situacao: 'em_risco', precisa_nas_restantes: 22 });
  });
  it('normaliza notas de escalas diferentes (APOL 0–100)', () => {
    expect(situacaoDisciplina([av(90, 1, 100), av(6, 1, 10)], 7).media).toBe(7.5);
  });
  it('sem avaliações', () => {
    expect(situacaoDisciplina([], 7).situacao).toBe('sem_avaliacoes');
  });
});

describe('IMC', () => {
  it('faixas da OMS', () => {
    expect(imc(70, 175)).toEqual({ valor: 22.9, faixa: 'peso normal' });
    expect(imc(95, 175).faixa).toBe('obesidade');
  });
});

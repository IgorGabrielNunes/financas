import { describe, expect, it } from 'vitest';
import { descreverRepeticao, diaSemana, ocorrencias, ocorreEm, proximaOcorrencia, sequencia } from './dominio.js';

const base = { fim: null, dias_semana: null };

describe('repetição', () => {
  it('dia da semana sem fuso', () => {
    expect(diaSemana('2026-10-20')).toBe(2); // terça
    expect(diaSemana('2026-10-25')).toBe(0); // domingo
  });
  it('diária respeita início e fim', () => {
    const r = { ...base, data: '2026-10-20', repeticao: 'diaria' as const, fim: '2026-10-22' };
    expect(ocorrencias(r, '2026-10-18', '2026-10-25')).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });
  it('semanal nos dias marcados', () => {
    const r = { ...base, data: '2026-10-01', repeticao: 'semanal' as const, dias_semana: [1, 3, 5] };
    expect(ocorrencias(r, '2026-10-19', '2026-10-25')).toEqual(['2026-10-19', '2026-10-21', '2026-10-23']);
  });
  it('mensal no dia 31 cai no último dia de meses curtos', () => {
    const r = { ...base, data: '2026-01-31', repeticao: 'mensal' as const };
    expect(ocorrencias(r, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    expect(ocorreEm(r, '2026-02-27')).toBe(false);
  });
  it('avulsa não tem ocorrências calculadas', () => {
    expect(ocorrencias({ ...base, data: '2026-10-20', repeticao: 'nenhuma' }, '2026-10-01', '2026-10-31')).toEqual([]);
  });
  it('próxima ocorrência', () => {
    const r = { ...base, data: '2026-10-01', repeticao: 'semanal' as const, dias_semana: [6] };
    expect(proximaOcorrencia(r, '2026-10-20')).toBe('2026-10-24');
  });
});

describe('sequência', () => {
  const r = { ...base, data: '2026-10-01', repeticao: 'diaria' as const };
  it('conta dias seguidos; hoje pendente não quebra', () => {
    const feitas = new Set(['2026-10-17', '2026-10-18', '2026-10-19']);
    expect(sequencia(r, feitas, '2026-10-20')).toBe(3);
    expect(sequencia(r, new Set([...feitas, '2026-10-20']), '2026-10-20')).toBe(4);
  });
  it('um dia perdido zera', () => {
    expect(sequencia(r, new Set(['2026-10-17', '2026-10-19']), '2026-10-20')).toBe(1);
  });
  it('semanal só conta os dias da regra', () => {
    const s = { ...base, data: '2026-10-01', repeticao: 'semanal' as const, dias_semana: [1, 3] };
    expect(sequencia(s, new Set(['2026-10-12', '2026-10-14', '2026-10-19']), '2026-10-20')).toBe(3);
  });
});

describe('descrição', () => {
  it('textos', () => {
    expect(descreverRepeticao({ ...base, data: '2026-10-01', repeticao: 'semanal', dias_semana: [1, 2, 3, 4, 5] })).toBe('Dias úteis');
    expect(descreverRepeticao({ ...base, data: '2026-10-01', repeticao: 'semanal', dias_semana: [6, 0] })).toBe('Fins de semana');
    expect(descreverRepeticao({ ...base, data: '2026-10-01', repeticao: 'semanal', dias_semana: [2, 4] })).toBe('ter, qui');
    expect(descreverRepeticao({ ...base, data: '2026-10-15', repeticao: 'mensal' })).toBe('Todo dia 15 do mês');
  });
});

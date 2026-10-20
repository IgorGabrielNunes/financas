import { describe, expect, it } from 'vitest';
import { fichasDoDia, planoDoDia, somarMacros } from './dominio.js';

const f = (id: string, ordem: number, dias: number[] = [], ativa = true) => ({ id, nome: id, dias_semana: dias, ordem, ativa });

describe('fichasDoDia', () => {
  it('dias fixos: só as fichas do dia da semana', () => {
    const r = fichasDoDia([f('A', 0, [1, 4]), f('B', 1, [2, 5])], 1, null);
    expect(r.fixas.map((x) => x.id)).toEqual(['A']);
    expect(r.rodizio).toBeNull();
  });

  it('rodízio: próxima depois da última feita, voltando ao início', () => {
    const fs = [f('A', 0), f('B', 1), f('C', 2)];
    expect(fichasDoDia(fs, 3, null).rodizio?.id).toBe('A');
    expect(fichasDoDia(fs, 3, 'A').rodizio?.id).toBe('B');
    expect(fichasDoDia(fs, 3, 'C').rodizio?.id).toBe('A');
  });

  it('ignora fichas inativas e última feita que saiu do rodízio', () => {
    const fs = [f('A', 0), f('B', 1, [], false), f('C', 2)];
    expect(fichasDoDia(fs, 0, 'A').rodizio?.id).toBe('C');
    expect(fichasDoDia(fs, 0, 'X').rodizio?.id).toBe('A'); // ficha apagada/fixa: recomeça
  });

  it('fixas e rodízio convivem', () => {
    const r = fichasDoDia([f('Corrida', 0, [6]), f('A', 1), f('B', 2)], 6, 'A');
    expect(r.fixas.map((x) => x.id)).toEqual(['Corrida']);
    expect(r.rodizio?.id).toBe('B');
  });
});

describe('dieta', () => {
  it('soma macros ignorando campos vazios', () => {
    expect(somarMacros([
      { kcal: 150, proteina_g: '12.5', carbo_g: null, gordura_g: 10 },
      { kcal: 200, proteina_g: 4, carbo_g: '40', gordura_g: null },
    ])).toEqual({ kcal: 350, proteina_g: 16.5, carbo_g: 40, gordura_g: 10 });
    expect(somarMacros([{ kcal: null, proteina_g: null, carbo_g: null, gordura_g: null }]).kcal).toBeNull();
  });

  it('plano do tipo de dia ganha do "todos"', () => {
    const ps = [{ id: 't', aplica_em: 'todos', ativo: true }, { id: 'tr', aplica_em: 'treino', ativo: true }, { id: 'd', aplica_em: 'descanso', ativo: false }];
    expect(planoDoDia(ps, true)?.id).toBe('tr');
    expect(planoDoDia(ps, false)?.id).toBe('t'); // descanso inativo → cai no "todos"
    expect(planoDoDia([], true)).toBeNull();
  });
});

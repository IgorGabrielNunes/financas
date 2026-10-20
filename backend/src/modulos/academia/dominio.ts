// Regras puras da academia (sem banco): qual ficha treinar no dia e totais de dieta.

export type FichaResumo = { id: string; nome: string; dias_semana: number[]; ordem: number; ativa: boolean };

/**
 * Fichas do dia:
 * - fichas com dias fixos valem nos dias marcados (ex.: A seg/qui, B ter/sex);
 * - fichas sem dias fixos formam um rodízio na ordem cadastrada: a sugestão é a próxima
 *   depois da última feita (A → B → C → A). Sem histórico, começa pela primeira.
 * Fixas e rodízio convivem: no dia com fixa, o rodízio também aparece como sugestão
 * (quem treina duas vezes no dia, ou quer trocar).
 */
export function fichasDoDia(fichas: FichaResumo[], diaSemana: number, ultimaRodizioId: string | null) {
  const ativas = fichas.filter((f) => f.ativa).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  const fixas = ativas.filter((f) => f.dias_semana.includes(diaSemana));
  const rodizio = ativas.filter((f) => f.dias_semana.length === 0);
  let proxima: FichaResumo | null = null;
  if (rodizio.length) {
    const i = ultimaRodizioId ? rodizio.findIndex((f) => f.id === ultimaRodizioId) : -1;
    proxima = rodizio[(i + 1) % rodizio.length];
  }
  return { fixas, rodizio: proxima };
}

type ItemNutri = { kcal: number | null; proteina_g: number | string | null; carbo_g: number | string | null; gordura_g: number | string | null };

/** Soma macros de uma lista de alimentos; campos vazios não contam (não vira 0 "falso"). */
export function somarMacros(itens: ItemNutri[]) {
  const n = (v: number | string | null) => (v === null || v === undefined || v === '' ? null : Number(v));
  const soma = (k: keyof ItemNutri) => {
    const vs = itens.map((i) => n(i[k])).filter((v): v is number => v !== null);
    return vs.length ? Math.round(vs.reduce((s, v) => s + v, 0) * 10) / 10 : null;
  };
  return { kcal: soma('kcal'), proteina_g: soma('proteina_g'), carbo_g: soma('carbo_g'), gordura_g: soma('gordura_g') };
}

/** Plano de dieta que vale no dia: específico do tipo de dia ganha do "todos". */
export function planoDoDia<T extends { aplica_em: string; ativo: boolean }>(planos: T[], diaDeTreino: boolean): T | null {
  const ativos = planos.filter((p) => p.ativo);
  return ativos.find((p) => p.aplica_em === (diaDeTreino ? 'treino' : 'descanso')) ?? ativos.find((p) => p.aplica_em === 'todos') ?? null;
}

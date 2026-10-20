export type Opcao = { v: unknown; r: string };
export type Campo = {
  k: string;                 // chave no modelo / payload
  r: string;                 // rótulo
  t?: 'texto' | 'area' | 'data' | 'hora' | 'num' | 'sel' | 'dinheiro' | 'tags' | 'bool' | 'cor' | 'url';
  op?: Opcao[] | (() => Opcao[]);
  meia?: boolean;            // ocupa meia linha (dois por linha)
  dica?: string;
  obrig?: boolean;
  ph?: string;
  min?: number; max?: number; passo?: number;
  linhas?: number;
  vazio?: string;            // rótulo da opção "nenhum" em selects (vira null)
  se?: (m: Record<string, any>) => boolean; // só aparece quando a condição é verdadeira
};

export const opcoes = (o: Record<string, string>): Opcao[] => Object.entries(o).map(([v, r]) => ({ v, r }));

/** Converte o modelo do formulário no payload da API: '' vira null, tags viram array, números viram number. */
export function paraPayload(campos: Campo[], m: Record<string, any>) {
  const out: Record<string, unknown> = {};
  for (const c of campos) {
    if (c.se && !c.se(m)) continue;
    let v = m[c.k];
    if (c.t === 'num') v = v === '' || v === null || v === undefined ? null : Number(v);
    else if (c.t === 'tags') v = Array.isArray(v) ? v : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (c.t === 'dinheiro') v = v ? Number(v) : null;
    else if (c.t === 'hora' && typeof v === 'string') v = v.trim() ? v.slice(0, 5) : null; // banco devolve HH:MM:SS
    else if (typeof v === 'string') v = v.trim() === '' ? null : v.trim();
    out[c.k] = v === undefined ? null : v;
  }
  return out;
}

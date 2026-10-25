// Rendimento de investimentos de renda fixa (puro, sem banco). Tudo em centavos e datas 'YYYY-MM-DD'.
//
// Convenções de mercado usadas:
// - CDI/Selic/IPCA+/prefixado capitalizam por DIA ÚTIL, base 252: fator = (1 + taxa a.a.)^(du/252).
//   "x% do CDI" aplica o percentual sobre a taxa DIÁRIA do CDI (é assim que o banco calcula).
// - Dias úteis = segunda a sexta menos feriados nacionais (≈ 252 por ano, como o calendário ANBIMA).
// - Poupança: Selic > 8,5% a.a. → 0,5% a.m. + TR; senão 70% da Selic + TR. Aqui vira taxa anual equivalente.
// - IR regressivo pela idade de CADA aporte (lote): até 180 dias 22,5%; 181–360 20%; 361–720 17,5%; acima 15%.
//   IOF regressivo sobre o rendimento nos primeiros 29 dias. LCI/LCA/poupança: isentos.
// - Resgates saem dos aportes mais antigos primeiro (FIFO), como no come-IR dos bancos.
// - Taxas de referência são as ATUAIS aplicadas ao período todo: é estimativa. O saldo informado (o que o
//   app do banco mostra) corrige a estimativa a partir daquela data.
import { parse as pd, somarMesesData, type ISODate } from '../../../core/datas.js';

export type Indexador = 'cdi' | 'selic' | 'ipca' | 'prefixado' | 'poupanca' | 'nenhum';
/** Em % (13.65 = 13,65% a.a.; tr_am em % ao mês). */
export type Taxas = { selic_aa: number; cdi_aa: number; ipca_aa: number; tr_am: number };
/** taxa: % do índice (cdi/selic), taxa real % a.a. (ipca), % a.a. (prefixado); ignorada em poupança/nenhum. */
export type Modelo = { indexador: Indexador; taxa: number; isento_ir: boolean; taxa_adm_aa?: number };

// ------------------------------------------------------------------ calendário
const ms = (d: ISODate) => { const p = pd(d); return Date.UTC(p.ano, p.mes - 1, p.dia); };
export const diasCorridos = (a: ISODate, b: ISODate) => Math.round((ms(b) - ms(a)) / 86400000);

/** Feriados nacionais bancários (calendário ANBIMA) que caem em dia de semana, em ms UTC. */
const cacheFeriados = new Map<number, number[]>();
export function feriados(ano: number): number[] {
  const c = cacheFeriados.get(ano);
  if (c) return c;
  // Páscoa (algoritmo de Meeus/Jones/Butcher)
  const a = ano % 19, b = Math.floor(ano / 100), cc = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(cc / 4), k = cc % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const pascoa = Date.UTC(ano, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  const dia = 86400000;
  const fixos: [number, number][] = [[1, 1], [4, 21], [5, 1], [9, 7], [10, 12], [11, 2], [11, 15], [12, 25]];
  if (ano >= 2024) fixos.push([11, 20]); // Consciência Negra, nacional desde 2024
  const lista = [
    ...fixos.map(([mes, d1]) => Date.UTC(ano, mes - 1, d1)),
    pascoa - 48 * dia, pascoa - 47 * dia, // carnaval (segunda e terça)
    pascoa - 2 * dia,                     // sexta-feira santa
    pascoa + 60 * dia,                    // Corpus Christi
  ].filter((t) => { const w = new Date(t).getUTCDay(); return w !== 0 && w !== 6; });
  cacheFeriados.set(ano, lista);
  return lista;
}

/** Dias úteis no intervalo (a, b]: o dia da aplicação não rende, o dia final rende. Sem fins de semana e feriados nacionais. */
export function diasUteis(a: ISODate, b: ISODate): number {
  const n = diasCorridos(a, b);
  if (n <= 0) return 0;
  const ta = ms(a), tb = ms(b);
  const w = new Date(ta).getUTCDay(); // 0 = domingo
  let du = Math.floor(n / 7) * 5;
  for (let i = 1; i <= n % 7; i++) { const d = (w + i) % 7; if (d !== 0 && d !== 6) du++; }
  for (let ano = pd(a).ano; ano <= pd(b).ano; ano++) for (const t of feriados(ano)) if (t > ta && t <= tb) du--;
  return du;
}

// ------------------------------------------------------------------ taxas
/** Taxa efetiva anual BRUTA (fração: 0.1365 = 13,65% a.a.). */
export function taxaAnual(m: Modelo, t: Taxas): number {
  let r: number;
  switch (m.indexador) {
    case 'cdi':
    case 'selic': {
      const base = (m.indexador === 'cdi' ? t.cdi_aa : t.selic_aa) / 100;
      const diaria = (Math.pow(1 + base, 1 / 252) - 1) * (m.taxa / 100);
      r = Math.pow(1 + diaria, 252) - 1;
      break;
    }
    case 'ipca': r = (1 + t.ipca_aa / 100) * (1 + m.taxa / 100) - 1; break;
    case 'prefixado': r = m.taxa / 100; break;
    case 'poupanca': {
      const selic = t.selic_aa / 100;
      const mensal = (selic > 0.085 ? 0.005 : Math.pow(1 + 0.7 * selic, 1 / 12) - 1) + t.tr_am / 100;
      r = Math.pow(1 + mensal, 12) - 1;
      break;
    }
    default: return 0;
  }
  const adm = (m.taxa_adm_aa ?? 0) / 100;
  return adm > 0 ? (1 + r) * (1 - adm) - 1 : r;
}

export const fator = (aa: number, a: ISODate, b: ISODate) => Math.pow(1 + aa, diasUteis(a, b) / 252);

export function aliquotaIR(dias: number): number {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.2;
  if (dias <= 720) return 0.175;
  return 0.15;
}
// IOF regressivo (% do rendimento) por dia corrido desde a aplicação; a partir do 30º dia é zero
const IOF = [100, 96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10, 6, 3];
export const aliquotaIOF = (dias: number) => (dias >= 30 ? 0 : IOF[Math.max(0, dias)] / 100);

// ------------------------------------------------------------------ lotes (um por aporte)
type Lote = { data: ISODate; principal: number; valor: number; em: ISODate };

function atualizar(lotes: Lote[], aa: number, d: ISODate) {
  for (const l of lotes) if (d > l.em) { l.valor *= fator(aa, l.em, d); l.em = d; }
}
/** Retira `valor` dos lotes mais antigos; o principal sai na mesma proporção do valor retirado. */
function retirar(lotes: Lote[], valor: number) {
  while (valor > 0.5 && lotes.length) {
    const l = lotes[0];
    if (l.valor <= valor + 0.5) { valor -= l.valor; lotes.shift(); continue; }
    const frac = valor / l.valor;
    l.principal *= 1 - frac;
    l.valor -= valor;
    valor = 0;
  }
}

/** `criado` (quando foi registrado) desempata eventos do mesmo dia: um saldo informado antes de um aporte
 *  feito no mesmo dia não "engole" o aporte; um saldo informado depois já o inclui. */
export type Movimento = { data: ISODate; tipo: 'aporte' | 'resgate'; valor_centavos: number; criado?: string | Date };
export type SaldoInformado = { data: ISODate; valor_centavos: number; criado?: string | Date };

export type Posicao = {
  investido_centavos: number;          // quanto do SEU dinheiro ainda está aplicado (principal)
  aportado_centavos: number;           // soma de todos os aportes
  resgatado_centavos: number;          // soma de todos os resgates
  saldo_bruto_centavos: number;
  rendimento_bruto_centavos: number;
  iof_centavos: number;
  ir_centavos: number;
  saldo_liquido_centavos: number;      // se resgatasse tudo hoje
  rendimento_liquido_centavos: number;
  rentabilidade_pct: number;           // rendimento bruto ÷ investido
  taxa_aa_pct: number;                 // taxa bruta do modelo hoje
  taxa_liquida_aa_pct: number;         // descontando o IR na faixa atual dos aportes
  rendimento_mes_centavos: number;     // quanto rende nos próximos ~30 dias (21 dias úteis), bruto
  origem: 'estimado' | 'informado';
  saldo_informado: SaldoInformado | null;
  ir_estimado: boolean;                // false para ações/FII/cripto (IR depende de venda, isenção etc.)
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function fechar(lotes: Lote[], m: Modelo, aa: number, ate: ISODate) {
  let bruto = 0, investido = 0, ir = 0, iof = 0, ganho = 0;
  for (const l of lotes) {
    bruto += l.valor; investido += l.principal;
    const g = l.valor - l.principal;
    if (g <= 0 || m.indexador === 'nenhum') continue;
    ganho += g;
    const dias = diasCorridos(l.data, ate);
    const i1 = g * aliquotaIOF(dias);
    iof += i1;
    if (!m.isento_ir) ir += (g - i1) * aliquotaIR(dias);
  }
  // alíquota efetiva atual (média ponderada dos lotes); sem rendimento ainda, usa a do aporte mais novo
  const aliq = m.isento_ir || m.indexador === 'nenhum' ? 0
    : ganho > 0 ? ir / ganho : aliquotaIR(lotes.length ? diasCorridos(lotes[lotes.length - 1].data, ate) : 0);
  return { bruto, investido, ir, iof, aliq };
}

export function posicao(movs: Movimento[], saldos: SaldoInformado[], m: Modelo, taxas: Taxas, ate: ISODate): Posicao {
  const aa = taxaAnual(m, taxas);
  // mesmo dia: pela ordem de registro quando conhecida; senão aportes, resgates e por fim o saldo informado
  const ordem = { aporte: 0, resgate: 1, saldo: 2 } as const;
  const t = (x: { criado?: string | Date }) => (x.criado ? new Date(x.criado).getTime() : null);
  const eventos = [
    ...movs.map((x) => ({ ...x, k: x.tipo })),
    ...saldos.map((x) => ({ ...x, k: 'saldo' as const })),
  ].filter((e) => e.data <= ate).sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    const ta = t(a), tb = t(b);
    return ta !== null && tb !== null && ta !== tb ? ta - tb : ordem[a.k] - ordem[b.k];
  });

  const lotes: Lote[] = [];
  let ultimoSaldo: SaldoInformado | null = null;
  for (const e of eventos) {
    atualizar(lotes, aa, e.data);
    if (e.k === 'aporte') lotes.push({ data: e.data, principal: e.valor_centavos, valor: e.valor_centavos, em: e.data });
    else if (e.k === 'resgate') retirar(lotes, e.valor_centavos);
    else {
      ultimoSaldo = { data: e.data, valor_centavos: e.valor_centavos };
      const total = lotes.reduce((s, l) => s + l.valor, 0);
      if (total > 0) { const k = e.valor_centavos / total; for (const l of lotes) l.valor *= k; }
      else if (e.valor_centavos > 0) lotes.push({ data: e.data, principal: e.valor_centavos, valor: e.valor_centavos, em: e.data });
    }
  }
  atualizar(lotes, aa, ate);
  const f = fechar(lotes, m, aa, ate);
  const soma = (tipo: Movimento['tipo']) => movs.filter((x) => x.tipo === tipo && x.data <= ate).reduce((s, x) => s + x.valor_centavos, 0);
  // arredonda as partes e deriva o resto: os números da tela sempre fecham (bruto − IR − IOF = líquido)
  const [bruto, investido, ir, iof] = [f.bruto, f.investido, f.ir, f.iof].map(Math.round);
  const rend = bruto - investido;
  return {
    investido_centavos: investido,
    aportado_centavos: soma('aporte'),
    resgatado_centavos: soma('resgate'),
    saldo_bruto_centavos: bruto,
    rendimento_bruto_centavos: rend,
    iof_centavos: iof,
    ir_centavos: ir,
    saldo_liquido_centavos: bruto - ir - iof,
    rendimento_liquido_centavos: rend - ir - iof,
    rentabilidade_pct: investido > 0 ? r2((rend / investido) * 100) : 0,
    taxa_aa_pct: r2(aa * 100),
    taxa_liquida_aa_pct: r2(aa * (1 - f.aliq) * 100),
    rendimento_mes_centavos: Math.round(f.bruto * (Math.pow(1 + aa, 21 / 252) - 1)),
    origem: ultimoSaldo ? 'informado' : 'estimado',
    saldo_informado: ultimoSaldo,
    ir_estimado: m.indexador !== 'nenhum',
  };
}

// ------------------------------------------------------------------ simulação
export type Simulacao = { inicial_centavos: number; mensal_centavos: number; meses: number; inicio: ISODate };
export type ResultadoSimulacao = {
  investido_centavos: number;
  bruto_centavos: number;
  ir_centavos: number;
  iof_centavos: number;
  liquido_centavos: number;
  rendimento_liquido_centavos: number;
  taxa_aa_pct: number;           // bruta
  taxa_liquida_aa_pct: number;   // taxa anual equivalente do que sobra líquido (TIR dos aportes)
  serie: { mes: number; liquido_centavos: number; investido_centavos: number }[];
};

export function aportesDaSimulacao(s: Simulacao): Movimento[] {
  const movs: Movimento[] = [];
  for (let k = 0; k < s.meses; k++) {
    const v = (k === 0 ? s.inicial_centavos : 0) + s.mensal_centavos;
    if (v > 0) movs.push({ data: somarMesesData(s.inicio, k), tipo: 'aporte', valor_centavos: v });
  }
  return movs;
}

/** TIR mensal (bisseção) de aportes mensais que viram `final` no mês `meses`. */
function tirMensal(fluxos: { mes: number; valor: number }[], meses: number, final: number): number {
  const vf = (r: number) => fluxos.reduce((s, f) => s + f.valor * Math.pow(1 + r, meses - f.mes), 0);
  let lo = -0.99, hi = 1;
  if (vf(hi) < final) return hi;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (vf(mid) < final) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export function simular(s: Simulacao, m: Modelo, t: Taxas): ResultadoSimulacao {
  const movs = aportesDaSimulacao(s);
  const fim = somarMesesData(s.inicio, s.meses);
  const p = posicao(movs, [], m, t, fim);
  const serie = [];
  // série mensal para o gráfico (até ~120 pontos)
  const passo = Math.max(1, Math.ceil(s.meses / 120));
  for (let k = passo; k <= s.meses; k += passo) {
    const d = somarMesesData(s.inicio, k);
    const q = k === s.meses ? p : posicao(movs, [], m, t, d);
    serie.push({ mes: k, liquido_centavos: q.saldo_liquido_centavos, investido_centavos: q.investido_centavos });
  }
  if (serie.at(-1)?.mes !== s.meses) serie.push({ mes: s.meses, liquido_centavos: p.saldo_liquido_centavos, investido_centavos: p.investido_centavos });
  const fluxos = movs.map((x, i) => ({ mes: i, valor: x.valor_centavos }));
  const tir = p.investido_centavos > 0 ? tirMensal(fluxos, s.meses, p.saldo_liquido_centavos) : 0;
  return {
    investido_centavos: p.investido_centavos,
    bruto_centavos: p.saldo_bruto_centavos,
    ir_centavos: p.ir_centavos,
    iof_centavos: p.iof_centavos,
    liquido_centavos: p.saldo_liquido_centavos,
    rendimento_liquido_centavos: p.rendimento_liquido_centavos,
    taxa_aa_pct: p.taxa_aa_pct,
    taxa_liquida_aa_pct: r2((Math.pow(1 + tir, 12) - 1) * 100),
    serie,
  };
}

// ------------------------------------------------------------------ catálogo de opções para o simulador
export type TipoInvestimento = 'cdb' | 'lci_lca' | 'tesouro_selic' | 'tesouro_ipca' | 'tesouro_prefixado'
  | 'poupanca' | 'fundo_di' | 'caixinha' | 'acoes' | 'fii' | 'cripto' | 'outro';
export type Opcao = { chave: string; nome: string; tipo: TipoInvestimento; modelo: Modelo; liquidez: 'diaria' | 'vencimento'; nota: string };

/** Referências típicas de mercado (editáveis na tela). Taxas de títulos mudam todo dia: confira antes de aplicar. */
export const OPCOES_PADRAO: Opcao[] = [
  { chave: 'poupanca', nome: 'Poupança', tipo: 'poupanca', liquidez: 'diaria', modelo: { indexador: 'poupanca', taxa: 0, isento_ir: true }, nota: 'Isenta de IR, rende só no aniversário mensal. Garantida pelo FGC.' },
  { chave: 'caixinha', nome: 'Caixinha / CDB liquidez diária (100% CDI)', tipo: 'caixinha', liquidez: 'diaria', modelo: { indexador: 'cdi', taxa: 100, isento_ir: false }, nota: 'Ótima para reserva de emergência: saca quando quiser. FGC até R$ 250 mil.' },
  { chave: 'tesouro_selic', nome: 'Tesouro Selic', tipo: 'tesouro_selic', liquidez: 'diaria', modelo: { indexador: 'selic', taxa: 100, isento_ir: false }, nota: 'Risco do governo federal (o menor do país). Taxa B3 de 0,2% a.a. acima de R$ 10 mil não incluída.' },
  { chave: 'cdb_110', nome: 'CDB 110% do CDI (no vencimento)', tipo: 'cdb', liquidez: 'vencimento', modelo: { indexador: 'cdi', taxa: 110, isento_ir: false }, nota: 'Rende mais por travar o dinheiro até o vencimento. Bancos médios pagam mais; FGC até R$ 250 mil.' },
  { chave: 'lci_lca', nome: 'LCI/LCA 92% do CDI', tipo: 'lci_lca', liquidez: 'vencimento', modelo: { indexador: 'cdi', taxa: 92, isento_ir: true }, nota: 'Isenta de IR: 92% do CDI isento equivale a 108%–119% do CDI num CDB tributado, conforme o prazo. Carência mínima de 9 (LCA) a 12 meses (LCI).' },
  { chave: 'tesouro_ipca', nome: 'Tesouro IPCA+ (IPCA + 7,5%)', tipo: 'tesouro_ipca', liquidez: 'vencimento', modelo: { indexador: 'ipca', taxa: 7.5, isento_ir: false }, nota: 'Protege da inflação no longo prazo. Se vender antes do vencimento, o preço oscila (marcação a mercado).' },
  { chave: 'tesouro_pre', nome: 'Tesouro Prefixado (13,3% a.a.)', tipo: 'tesouro_prefixado', liquidez: 'vencimento', modelo: { indexador: 'prefixado', taxa: 13.3, isento_ir: false }, nota: 'Você sabe hoje quanto vai ter no vencimento. Ganha se os juros caírem; perde para o CDI se subirem.' },
  { chave: 'fundo_di', nome: 'Fundo DI (100% CDI, adm. 0,5%)', tipo: 'fundo_di', liquidez: 'diaria', modelo: { indexador: 'cdi', taxa: 100, isento_ir: false, taxa_adm_aa: 0.5 }, nota: 'A taxa de administração come parte do rendimento; come-cotas semestral não incluído.' },
];

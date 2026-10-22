// Leitura de arquivos de fatura de cartão: CSV (Nubank, Inter, C6, genérico), OFX (Itaú, BB, Bradesco,
// Santander…) e JSON. Função pura: texto → linhas normalizadas. Nada de banco aqui.

export type Formato = 'csv' | 'ofx' | 'json';
export type Parcela = { atual: number; total: number };
export type DataParcial = { dia: number; mes: number; ano: number | null }; // ano null = arquivo sem ano ("15/10")

export type LinhaLida = {
  linha: number;                 // nº da linha/registro no arquivo (para o usuário achar)
  data: DataParcial | null;
  descricao: string;             // sem o "Parcela 3/10"
  valor_centavos: number;        // positivo = gasto; negativo = pagamento/estorno
  parcela: Parcela | null;
  categoria_texto: string | null;
  erro: string | null;
};

export type ResultadoLeitura = { formato: Formato; linhas: LinhaLida[]; sinal_invertido: boolean; avisos: string[] };

// ----------------------------------------------------------------- utilitários

/** minúsculas, sem acento, espaços simples: para comparar cabeçalhos e descrições. */
export const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Valor em centavos a partir dos formatos que os bancos usam:
 * "1.234,56", "1234.56", "1,234.56", "R$ -50,00", "(50,00)", "-R$ 12,30", 12.5 (número em reais).
 */
export function lerValor(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  s = s.replace(/r\$|brl|\s/gi, '');
  if (s.startsWith('-')) { negativo = !negativo; s = s.slice(1); }
  if (s.endsWith('-')) { negativo = !negativo; s = s.slice(0, -1); } // alguns extratos: "50,00-"
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const ultPonto = s.lastIndexOf('.'), ultVirg = s.lastIndexOf(',');
  let num: number;
  if (ultPonto >= 0 && ultVirg >= 0) {
    // o separador que aparece por último é o decimal
    num = ultVirg > ultPonto ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  } else if (ultVirg >= 0) {
    num = Number(s.replace(/\./g, '').replace(',', '.'));
  } else if (ultPonto >= 0) {
    // "1.234" (só um ponto e 3 dígitos depois) é milhar; "12.50" é decimal
    const partes = s.split('.');
    num = partes.length > 2 || (partes.length === 2 && partes[1].length === 3) ? Number(s.replace(/\./g, '')) : Number(s);
  } else {
    num = Number(s);
  }
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) * (negativo ? -1 : 1);
}

const MESES: Record<string, number> = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };

/** "2026-10-15", "15/10/2026", "15/10/26", "15-10-2026", "20261015", "15/10", "15 OUT", "15 de out. de 2026". */
export function lerData(v: unknown): DataParcial | null {
  if (typeof v !== 'string') return null;
  const s = normalizar(v).replace(/\./g, '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valida(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})/); // OFX: 20261015[000000[-3:BRT]]
  if (m) return valida(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (m) return valida(+m[1], +m[2], m[3] ? anoCompleto(+m[3]) : null);
  m = s.match(/^(\d{1,2})(?: de)? ([a-z]{3})[a-z]*(?:(?: de)? (\d{2,4}))?$/);
  if (m && MESES[m[2]]) return valida(+m[1], MESES[m[2]], m[3] ? anoCompleto(+m[3]) : null);
  return null;
}
const anoCompleto = (a: number) => (a < 100 ? 2000 + a : a);
function valida(dia: number, mes: number, ano: number | null): DataParcial | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (ano !== null && (ano < 2000 || ano > 2100)) return null;
  return { dia, mes, ano };
}

/**
 * Parcela escrita na descrição ("Parcela 3/10", "PARC 03/10", "(3/10)", "LOJA X 03/10", "3 de 10").
 * Retorna a descrição limpa. Só aceita total entre 2 e 48 e atual ≤ total.
 */
export function extrairParcela(descricao: string): { descricao: string; parcela: Parcela | null } {
  const padroes = [
    /\s*[-–|]?\s*\(?\s*parc(?:ela)?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*\)?/i,
    /\s*[-–|]?\s*\((\d{1,2})\s*\/\s*(\d{1,2})\)/,
    /\s*[-–|]?\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*$/,
    /\s*[-–|]?\s+(\d{1,2}) de (\d{1,2})\s*$/i,
  ];
  for (const re of padroes) {
    const m = descricao.match(re);
    if (!m) continue;
    const atual = +m[1], total = +m[2];
    if (total < 2 || total > 48 || atual < 1 || atual > total) continue;
    const limpa = (descricao.slice(0, m.index) + descricao.slice(m.index! + m[0].length)).replace(/\s*[-–|]\s*$/, '').replace(/\s+/g, ' ').trim();
    return { descricao: limpa || descricao.trim(), parcela: { atual, total } };
  }
  return { descricao: descricao.replace(/\s+/g, ' ').trim(), parcela: null };
}

/** Coluna "Parcela" (C6, Inter): "1/3", "02 de 10", "Única", "-". */
function lerColunaParcela(v: string): Parcela | null {
  const m = normalizar(v).match(/(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/);
  if (!m) return null;
  const atual = +m[1], total = +m[2];
  return total >= 2 && total <= 48 && atual >= 1 && atual <= total ? { atual, total } : null;
}

// ----------------------------------------------------------------------- CSV

/** Separa uma linha de CSV respeitando aspas ("a;b" e aspas duplicadas ""). */
function dividirCsv(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') { atual += '"'; i++; }
      else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { out.push(atual); atual = ''; }
    else atual += c;
  }
  out.push(atual);
  return out.map((x) => x.trim());
}

/** Linhas do arquivo, juntando quebras de linha dentro de aspas. */
function linhasCsv(texto: string): { n: number; texto: string }[] {
  const brutas = texto.replace(/^﻿/, '').split(/\r?\n/);
  const out: { n: number; texto: string }[] = [];
  let acum = '', inicio = 0;
  brutas.forEach((l, i) => {
    if (!acum) inicio = i + 1;
    acum = acum ? `${acum}\n${l}` : l;
    if ((acum.match(/"/g) ?? []).length % 2 === 0) { if (acum.trim()) out.push({ n: inicio, texto: acum }); acum = ''; }
  });
  if (acum.trim()) out.push({ n: inicio, texto: acum });
  return out;
}

const COLUNAS = {
  data: ['data', 'date', 'data da compra', 'data de compra', 'data compra', 'dt', 'data lancamento', 'data do lancamento', 'data transacao', 'dia'],
  descricao: ['descricao', 'title', 'titulo', 'estabelecimento', 'historico', 'lancamento', 'descricao do lancamento', 'memo', 'nome', 'description', 'detalhe', 'loja'],
  valor: ['valor', 'amount', 'value', 'valor (r$)', 'valor em r$', 'valor r$', 'valor brl', 'valor (em r$)', 'valor em reais'],
  parcela: ['parcela', 'parcelas', 'installment', 'installments', 'n parcela'],
  categoria: ['categoria', 'category'],
};

function acharColunas(cab: string[]) {
  const n = cab.map(normalizar);
  const achar = (nomes: string[]) => n.findIndex((c) => nomes.includes(c));
  let valor = achar(COLUNAS.valor);
  if (valor < 0) {
    // "Valor (em US$)" + "Valor (em R$)" (C6): fica com a coluna em reais, nunca a de dólar/cotação
    const cands = n.map((c, i) => ({ c, i })).filter(({ c }) => /valor|amount/.test(c) && !/us\$|usd|dolar|cotacao/.test(c));
    valor = (cands.find(({ c }) => /r\$|brl|real/.test(c)) ?? cands[0])?.i ?? -1;
  }
  return { data: achar(COLUNAS.data), descricao: achar(COLUNAS.descricao), valor, parcela: achar(COLUNAS.parcela), categoria: achar(COLUNAS.categoria) };
}

function lerCsv(texto: string): { linhas: LinhaLida[]; avisos: string[] } {
  const linhas = linhasCsv(texto);
  if (!linhas.length) return { linhas: [], avisos: ['Arquivo vazio'] };
  const primeira = linhas[0].texto;
  // separador: o mais frequente fora de aspas na primeira linha
  const sep = [';', ',', '\t', '|'].map((s) => ({ s, n: dividirCsv(primeira, s).length })).sort((a, b) => b.n - a.n)[0].s;
  // CSV separado por vírgula com valor "12,50" sem aspas: a vírgula decimal parte o valor em duas colunas.
  // Se as duas últimas forem "número" + "2 dígitos" e sobrar uma coluna, junta de volta.
  const ler = (t: string, esperado?: number) => {
    const c = dividirCsv(t, sep);
    const n = c.length;
    if (sep === ',' && n >= 2 && (esperado === undefined || n === esperado + 1)
      && /^-?(?:r\$\s*)?[\d.]+$/i.test(c[n - 2]) && /^\d{2}-?$/.test(c[n - 1])) {
      return [...c.slice(0, n - 2), `${c[n - 2]},${c[n - 1]}`];
    }
    return c;
  };
  const cabCru = dividirCsv(primeira, sep);
  const temCabecalho = acharColunas(cabCru).data >= 0 && acharColunas(cabCru).valor >= 0;
  const cab = temCabecalho ? cabCru : ler(primeira);
  let col = acharColunas(cab);
  let inicio = 1;
  const avisos: string[] = [];
  if (col.data < 0 || col.valor < 0) {
    // sem cabeçalho reconhecível: a primeira linha já é dado? assume data, descrição, valor
    if (lerData(cab[0]) && cab.length >= 3 && lerValor(cab[cab.length - 1]) !== null) {
      col = { data: 0, descricao: 1, valor: cab.length - 1, parcela: -1, categoria: -1 };
      inicio = 0;
      avisos.push('Arquivo sem cabeçalho: usei a 1ª coluna como data, a 2ª como descrição e a última como valor.');
    } else {
      throw new Error(`Não reconheci as colunas do CSV. Cabeçalho encontrado: "${cab.join(sep)}". Precisa ter pelo menos data, descrição e valor.`);
    }
  }
  if (col.descricao < 0) col.descricao = cab.findIndex((_, i) => i !== col.data && i !== col.valor && i !== col.parcela && i !== col.categoria);

  const out: LinhaLida[] = [];
  for (const l of linhas.slice(inicio)) {
    const c = ler(l.texto, temCabecalho ? cab.length : undefined);
    if (c.every((x) => !x)) continue;
    const bruta = c[col.descricao] ?? '';
    const { descricao, parcela: daDescricao } = extrairParcela(bruta);
    const parcelaCol = col.parcela >= 0 ? lerColunaParcela(c[col.parcela] ?? '') : null;
    const data = lerData(c[col.data] ?? '');
    const valor = lerValor(c[col.valor] ?? '');
    out.push({
      linha: l.n, data, descricao, valor_centavos: valor ?? 0, parcela: parcelaCol ?? daDescricao,
      categoria_texto: col.categoria >= 0 ? c[col.categoria] || null : null,
      erro: !data ? `Data inválida: "${c[col.data] ?? ''}"` : valor === null ? `Valor inválido: "${c[col.valor] ?? ''}"` : !descricao ? 'Sem descrição' : null,
    });
  }
  return { linhas: out, avisos };
}

// ----------------------------------------------------------------------- OFX

function lerOfx(texto: string): { linhas: LinhaLida[]; avisos: string[] } {
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  if (!blocos.length) throw new Error('OFX sem transações (<STMTTRN>)');
  // OFX 1.x é SGML: tags sem fechamento ("<TRNAMT>-50.00")
  const tag = (b: string, t: string) => b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i'))?.[1]?.trim() ?? '';
  const out = blocos.map((b, i): LinhaLida => {
    const bruta = tag(b, 'MEMO') || tag(b, 'NAME');
    const { descricao, parcela } = extrairParcela(bruta);
    const data = lerData(tag(b, 'DTPOSTED'));
    const valorTxt = tag(b, 'TRNAMT');
    // OFX usa ponto decimal sempre
    const valor = valorTxt && /^[-+]?\d+(\.\d+)?$/.test(valorTxt) ? Math.round(Number(valorTxt) * 100) : lerValor(valorTxt);
    return {
      linha: i + 1, data, descricao, valor_centavos: valor ?? 0, parcela, categoria_texto: null,
      erro: !data ? 'Data inválida' : valor === null ? `Valor inválido: "${valorTxt}"` : !descricao ? 'Sem descrição' : null,
    };
  });
  return { linhas: out, avisos: [] };
}

// ---------------------------------------------------------------------- JSON

function lerJson(texto: string): { linhas: LinhaLida[]; avisos: string[] } {
  let j: unknown;
  try { j = JSON.parse(texto); } catch (e) { throw new Error(`JSON inválido: ${(e as Error).message}`); }
  const lista = Array.isArray(j) ? j
    : j && typeof j === 'object' ? (['itens', 'lancamentos', 'transacoes', 'transactions', 'compras', 'items'].map((k) => (j as any)[k]).find(Array.isArray) ?? null)
    : null;
  if (!lista) throw new Error('JSON precisa ser uma lista de compras, ou um objeto com "itens": [...]');
  const pega = (o: Record<string, unknown>, nomes: string[]) => {
    const k = Object.keys(o).find((x) => nomes.includes(normalizar(x).replace(/_/g, ' ')));
    return k === undefined ? undefined : o[k];
  };
  return {
    avisos: [],
    linhas: lista.map((o: any, i: number): LinhaLida => {
      if (!o || typeof o !== 'object') return { linha: i + 1, data: null, descricao: '', valor_centavos: 0, parcela: null, categoria_texto: null, erro: 'Item não é um objeto' };
      const bruta = String(pega(o, COLUNAS.descricao) ?? '');
      const ext = extrairParcela(bruta);
      // parcela explícita: {"parcela": "3/10"} ou {"parcela_atual": 3, "parcelas_total": 10}
      const pa = Number(pega(o, ['parcela atual'])), pt = Number(pega(o, ['parcelas total', 'total parcelas', 'parcelas']));
      const parcelaExplicita = Number.isInteger(pa) && Number.isInteger(pt) && pt >= 2 && pt <= 48 && pa >= 1 && pa <= pt ? { atual: pa, total: pt }
        : typeof pega(o, ['parcela']) === 'string' ? lerColunaParcela(String(pega(o, ['parcela']))) : null;
      const centavos = pega(o, ['valor centavos']);
      const valor = typeof centavos === 'number' ? Math.round(centavos) : lerValor(pega(o, COLUNAS.valor));
      const data = lerData(String(pega(o, COLUNAS.data) ?? ''));
      return {
        linha: i + 1, data, descricao: ext.descricao, valor_centavos: valor ?? 0, parcela: parcelaExplicita ?? ext.parcela,
        categoria_texto: (pega(o, COLUNAS.categoria) as string | undefined) ?? null,
        erro: !data ? 'Data inválida' : valor === null ? 'Valor inválido' : !ext.descricao ? 'Sem descrição' : null,
      };
    }),
  };
}

// ------------------------------------------------------------------- entrada

export function detectarFormato(texto: string, nome = ''): Formato {
  const t = texto.trimStart();
  if (/\.json$/i.test(nome) || t.startsWith('[') || t.startsWith('{')) return 'json';
  if (/\.ofx$/i.test(nome) || /OFXHEADER|<OFX>/i.test(t.slice(0, 2000))) return 'ofx';
  return 'csv';
}

/**
 * Lê o arquivo e normaliza o sinal: em fatura, gasto é a maioria. Se a maioria vier negativa
 * (OFX e alguns CSVs trazem compra como débito), inverte tudo — pagamentos/estornos ficam negativos.
 */
export function lerArquivo(texto: string, nome = ''): ResultadoLeitura {
  if (texto.length > 2_000_000) throw new Error('Arquivo grande demais (máx. 2 MB)');
  const formato = detectarFormato(texto, nome);
  const { linhas, avisos } = formato === 'json' ? lerJson(texto) : formato === 'ofx' ? lerOfx(texto) : lerCsv(texto);
  const validas = linhas.filter((l) => !l.erro && l.valor_centavos !== 0);
  const negativas = validas.filter((l) => l.valor_centavos < 0).length;
  const inverter = validas.length > 0 && negativas > validas.length / 2;
  if (inverter) for (const l of linhas) l.valor_centavos = -l.valor_centavos;
  return { formato, linhas, sinal_invertido: inverter, avisos };
}

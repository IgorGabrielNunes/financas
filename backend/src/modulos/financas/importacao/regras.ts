// Regras puras da importação: em que fatura cada linha cai, como registrar uma parcela avulsa
// ("3/12") sem duplicar as anteriores, e qual categoria sugerir.
import { competencia, diaNoMes, somarDias, somarMeses, ultimoDia, type Mes } from '../../../core/datas.js';
import { cicloPorMesFechamento, planejarCompra, type Ciclo, type RegraCartao } from '../dominio/fatura.js';
import { normalizar, type DataParcial, type Parcela } from './leitor.js';

/** Ciclo da fatura que vence no mês `venc` (YYYY-MM). */
export function cicloDaFatura(regra: RegraCartao, venc: Mes): Ciclo {
  // vence no mesmo mês do fechamento se o dia de vencimento > dia de fechamento; senão, no mês seguinte
  const mesFech = regra.diaVencimento > regra.diaFechamento ? venc : somarMeses(venc, -1);
  return cicloPorMesFechamento(regra, mesFech);
}

/**
 * Completa a data sem ano ("15/10") com o ano da fatura: compras são anteriores ao vencimento,
 * então mês posterior ao do vencimento é do ano anterior (fatura de jan com compra de dez).
 */
export function resolverData(d: DataParcial, venc: Mes): string {
  const ano = d.ano ?? (d.mes > venc.mes ? venc.ano - 1 : venc.ano);
  const dia = Math.min(d.dia, ultimoDia(ano, d.mes));
  return `${ano}-${String(d.mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export type Plano = {
  data: string;               // data da compra a gravar
  valor_total: number;        // total da compra (parcela × n)
  parcelas_total: number;
  parcelas_pagas_antes: number;
  competencia: string;        // fatura em que a linha do arquivo cai pelo cadastro do cartão
  fora_da_fatura: boolean;    // cai em outra fatura que não a escolhida (dia de fechamento divergente)
};

/**
 * Como gravar uma linha:
 * - à vista: compra na data do arquivo; avisa se o cadastro do cartão a põe em outra fatura;
 * - parcela k/n: compra de n parcelas com k−1 "já pagas antes" (não entram em fatura nem limite),
 *   e a parcela k na fatura escolhida. Usa a data do arquivo se ela já leva a parcela k para lá
 *   (Nubank mostra a data original); senão, data sintética: véspera do fechamento, k−1 meses antes.
 */
export function planejarLinha(regra: RegraCartao, venc: Mes, data: string, valor: number, parcela: Parcela | null): Plano {
  const alvo = cicloDaFatura(regra, venc);
  if (!parcela) {
    const ciclo = planejarCompra(regra, data, valor, 1)[0].ciclo;
    return { data, valor_total: valor, parcelas_total: 1, parcelas_pagas_antes: 0, competencia: ciclo.competencia, fora_da_fatura: ciclo.competencia !== alvo.competencia };
  }
  const { atual: k, total: n } = parcela;
  const total = valor * n;
  const cai = (d: string) => planejarCompra(regra, d, total, n)[k - 1].ciclo.competencia;
  let d = data;
  if (cai(d) !== alvo.competencia) {
    // fechamento do ciclo da parcela 1 = k−1 meses antes do fechamento da fatura alvo
    const fech = alvo.dataFechamento;
    const mes1 = somarMeses({ ano: +fech.slice(0, 4), mes: +fech.slice(5, 7) }, -(k - 1));
    d = somarDias(diaNoMes(mes1.ano, mes1.mes, regra.diaFechamento), -1);
  }
  return { data: d, valor_total: total, parcelas_total: n, parcelas_pagas_antes: k - 1, competencia: cai(d), fora_da_fatura: cai(d) !== alvo.competencia };
}

export const competenciaDe = (venc: Mes) => competencia(venc);

// ------------------------------------------------------------- categorias

/** Descrição comparável: sem acento, sem números de pedido/cidade, sem "*" e afins. */
export function chaveDescricao(d: string) {
  return normalizar(d)
    .replace(/\b(parc(ela)?\.?\s*)?\d{1,2}\s*\/\s*\d{1,2}\b/g, ' ')
    .replace(/[*#_.\-–|()]/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')             // números longos (pedido, loja, CNPJ)
    .replace(/\s+/g, ' ').trim();
}

// palavras-chave → nome de categoria (casadas com as categorias que a casa tem, pelo nome)
const REGRAS: [RegExp, string[]][] = [
  [/ifood|rappi|aiqfome|restaurante|lanchonete|padaria|burger|pizza|mc ?donald|bk |subway|cafe|cafeteria|sorveteria|churrasc|bar /, ['alimentacao fora', 'restaurantes', 'alimentacao']],
  [/supermerc|mercado(?! ?livre| ?pago)|atacad|assai|carrefour|zaffari|bistek|big |nacional|condor|hortifruti|acougue|sacolao/, ['mercado', 'supermercado']],
  [/posto|shell|ipiranga|petrobras|br mania|combust|uber|99 ?(pop|app|taxi)?\b|cabify|estacion|pedagio|sem parar|conectcar|veloe|onibus|passagem/, ['transporte']],
  [/farmac|drogaria|droga |panvel|raia|drogasil|pague menos|sao joao|unimed|clinica|laborat|hospital|odonto|dentista|otica/, ['saude']],
  [/netflix|spotify|prime video|amazon prime|disney|hbo|max\.com|globoplay|youtube|deezer|apple\.com|icloud|google (one|storage|play)|chatgpt|openai|microsoft|xbox game pass|paramount|crunchyroll/, ['assinaturas', 'servicos']],
  [/escola|curso|udemy|alura|uninter|faculdade|universidade|livraria|livro|coursera|duolingo/, ['educacao']],
  [/cinema|ingresso|sympla|eventim|steam|playstation|nintendo|show|teatro|parque/, ['lazer']],
  [/amazon|mercado ?livre|mercadolivre|shopee|magalu|magazine|shein|aliexpress|americanas|casas bahia|kabum|renner|riachuelo|c&a|cea |zara|netshoes|centauro|decathlon/, ['compras', 'vestuario', 'eletronicos']],
  [/energia|luz|rge|cpfl|cemig|enel|copel|celesc|agua|corsan|sabesp|sanepar|internet|vivo|claro|tim |oi |net |sky|gas /, ['contas da casa', 'moradia']],
  [/aluguel|condominio|imobiliaria/, ['moradia']],
];

// categorias que os bancos mandam no arquivo (Nubank, Inter, C6) → nossas
const DO_BANCO: Record<string, string[]> = {
  supermercado: ['mercado'], mercado: ['mercado'], restaurante: ['alimentacao fora'], restaurantes: ['alimentacao fora'], alimentacao: ['alimentacao fora'],
  transporte: ['transporte'], 'automovel': ['transporte'], 'auto e transporte': ['transporte'], saude: ['saude'], farmacia: ['saude'],
  educacao: ['educacao'], lazer: ['lazer'], entretenimento: ['lazer'], viagem: ['lazer'], servicos: ['assinaturas'], assinaturas: ['assinaturas'],
  vestuario: ['compras'], eletronicos: ['compras'], eletronico: ['compras'], compras: ['compras'], 'lojas de departamento': ['compras'],
  casa: ['contas da casa', 'moradia'], moradia: ['moradia'], outros: ['outros'],
};

export type Categoria = { id: string; nome: string; tipo: string };

/**
 * Sugestão de categoria, na ordem de confiança:
 * 1) o que você usou da última vez para a mesma descrição (histórico da casa);
 * 2) a categoria que o banco mandou no arquivo;
 * 3) palavras-chave da descrição.
 */
export function sugerirCategoria(descricao: string, categoriaDoBanco: string | null, historico: Map<string, string>, categorias: Categoria[]): string | null {
  const desp = categorias.filter((c) => c.tipo === 'despesa');
  const porNome = (nomes: string[]) => {
    for (const n of nomes) { const c = desp.find((x) => normalizar(x.nome) === n); if (c) return c.id; }
    return null;
  };
  const doHistorico = historico.get(chaveDescricao(descricao));
  if (doHistorico && desp.some((c) => c.id === doHistorico)) return doHistorico;
  if (categoriaDoBanco) {
    const n = normalizar(categoriaDoBanco);
    const exata = desp.find((x) => normalizar(x.nome) === n);
    if (exata) return exata.id;
    const mapeada = DO_BANCO[n] ? porNome(DO_BANCO[n]) : null;
    if (mapeada) return mapeada;
  }
  const d = ` ${normalizar(descricao)} `;
  for (const [re, nomes] of REGRAS) if (re.test(d)) { const id = porNome(nomes); if (id) return id; }
  return null;
}

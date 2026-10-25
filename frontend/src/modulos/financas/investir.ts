// Tipos e rótulos de metas e investimentos (compartilhados pelas telas e formulários).
import { pct } from '../../core/format';

export type Indexador = 'cdi' | 'selic' | 'ipca' | 'prefixado' | 'poupanca' | 'nenhum';
export type Modelo = { indexador: Indexador; taxa: number; isento_ir: boolean; taxa_adm_aa?: number };
export type Taxas = { selic_aa: number; cdi_aa: number; ipca_aa: number; tr_am: number; fonte: 'padrao' | 'bcb' | 'manual'; atualizado_em: string };

export type Posicao = {
  investido_centavos: number; aportado_centavos: number; resgatado_centavos: number;
  saldo_bruto_centavos: number; rendimento_bruto_centavos: number; iof_centavos: number; ir_centavos: number;
  saldo_liquido_centavos: number; rendimento_liquido_centavos: number; rentabilidade_pct: number;
  taxa_aa_pct: number; taxa_liquida_aa_pct: number; rendimento_mes_centavos: number;
  origem: 'estimado' | 'informado'; saldo_informado: { data: string; valor_centavos: number } | null; ir_estimado: boolean;
};
export type Investimento = {
  id: string; nome: string; tipo: string; indexador: Indexador; taxa: number; taxa_adm_aa: number; isento_ir: boolean;
  liquidez: 'diaria' | 'vencimento'; vencimento: string | null; conta_id: string | null; conta_nome: string | null; conta_cor: string | null;
  meta_id: string | null; meta_nome: string | null; usuario_id: string | null; usuario_nome: string | null;
  ativo: boolean; observacao: string | null; posicao: Posicao;
};
export type MovInvest = { id: string; tipo: 'aporte' | 'resgate'; data: string; valor_centavos: number; conta_id: string | null; conta_nome: string | null; observacao: string | null };
export type InvestimentoDetalhe = Investimento & {
  movimentos: MovInvest[];
  saldos: { id: string; data: string; valor_centavos: number }[];
  evolucao: { data: string; saldo_centavos: number; investido_centavos: number }[];
};
export type Totais = {
  investido_centavos: number; saldo_bruto_centavos: number; rendimento_bruto_centavos: number;
  saldo_liquido_centavos: number; rendimento_liquido_centavos: number; rendimento_mes_centavos: number; qtd: number;
};
export type Carteira = { taxas: Taxas; totais: Totais; por_conta: { conta_id: string | null; conta_nome: string; conta_cor: string | null; saldo_centavos: number }[]; itens: Investimento[] };

export type Meta = {
  id: string; nome: string; tipo: string; icone: string | null; cor: string; valor_alvo_centavos: number; data_alvo: string | null;
  usuario_id: string | null; usuario_nome: string | null; arquivada: boolean; observacao: string | null;
  guardado_manual_centavos: number; em_investimentos_centavos: number; guardado_centavos: number; falta_centavos: number;
  pct: number; concluida: boolean; meses_restantes: number | null; mensal_necessario_centavos: number | null;
  mensal_com_rendimento_centavos: number | null; investimentos: { id: string; nome: string; saldo_centavos: number }[];
  qtd_movimentos: number;
};
export type MovMeta = { id: string; data: string; valor_centavos: number; conta_id: string | null; conta_nome: string | null; descricao: string | null };

export type Opcao = { chave: string; nome: string; tipo?: string; modelo: Modelo; liquidez?: 'diaria' | 'vencimento'; nota?: string };
export type Resultado = Opcao & {
  investido_centavos: number; bruto_centavos: number; ir_centavos: number; iof_centavos: number; liquido_centavos: number;
  rendimento_liquido_centavos: number; taxa_aa_pct: number; taxa_liquida_aa_pct: number;
  serie: { mes: number; liquido_centavos: number; investido_centavos: number }[];
};
export type Simulacao = { taxas: Taxas; inicio: string; atual: Resultado | null; resultados: Resultado[] };
export type Membro = { id: string; nome: string };

export const TIPOS_INVEST: Record<string, { nome: string; modelo: Modelo; liquidez: 'diaria' | 'vencimento' }> = {
  caixinha: { nome: 'Caixinha / conta remunerada', modelo: { indexador: 'cdi', taxa: 100, isento_ir: false }, liquidez: 'diaria' },
  cdb: { nome: 'CDB', modelo: { indexador: 'cdi', taxa: 100, isento_ir: false }, liquidez: 'vencimento' },
  lci_lca: { nome: 'LCI / LCA', modelo: { indexador: 'cdi', taxa: 90, isento_ir: true }, liquidez: 'vencimento' },
  tesouro_selic: { nome: 'Tesouro Selic', modelo: { indexador: 'selic', taxa: 100, isento_ir: false }, liquidez: 'diaria' },
  tesouro_ipca: { nome: 'Tesouro IPCA+', modelo: { indexador: 'ipca', taxa: 7.5, isento_ir: false }, liquidez: 'vencimento' },
  tesouro_prefixado: { nome: 'Tesouro Prefixado', modelo: { indexador: 'prefixado', taxa: 13, isento_ir: false }, liquidez: 'vencimento' },
  poupanca: { nome: 'Poupança', modelo: { indexador: 'poupanca', taxa: 0, isento_ir: true }, liquidez: 'diaria' },
  fundo_di: { nome: 'Fundo DI / renda fixa', modelo: { indexador: 'cdi', taxa: 100, isento_ir: false, taxa_adm_aa: 0.5 }, liquidez: 'diaria' },
  acoes: { nome: 'Ações', modelo: { indexador: 'nenhum', taxa: 0, isento_ir: false }, liquidez: 'diaria' },
  fii: { nome: 'Fundos imobiliários (FII)', modelo: { indexador: 'nenhum', taxa: 0, isento_ir: false }, liquidez: 'diaria' },
  cripto: { nome: 'Cripto', modelo: { indexador: 'nenhum', taxa: 0, isento_ir: false }, liquidez: 'diaria' },
  outro: { nome: 'Outro', modelo: { indexador: 'cdi', taxa: 100, isento_ir: false }, liquidez: 'diaria' },
};

export const INDEXADORES: Record<Indexador, { nome: string; taxa: string | null }> = {
  cdi: { nome: '% do CDI', taxa: '% do CDI (ex.: 102)' },
  selic: { nome: '% da Selic', taxa: '% da Selic (ex.: 100)' },
  ipca: { nome: 'IPCA + taxa', taxa: 'Taxa acima da inflação, % a.a. (ex.: 6,5)' },
  prefixado: { nome: 'Prefixado', taxa: 'Taxa ao ano, % (ex.: 13,2)' },
  poupanca: { nome: 'Regra da poupança', taxa: null },
  nenhum: { nome: 'Sem projeção (renda variável)', taxa: null },
};

const n = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
/** "102% do CDI", "IPCA + 6,5%", "13,2% a.a." */
export function rotuloModelo(m: Modelo): string {
  const adm = m.taxa_adm_aa ? `, adm. ${n(m.taxa_adm_aa)}%` : '';
  switch (m.indexador) {
    case 'cdi': return `${n(m.taxa)}% do CDI${adm}`;
    case 'selic': return `${n(m.taxa)}% da Selic${adm}`;
    case 'ipca': return `IPCA + ${n(m.taxa)}%${adm}`;
    case 'prefixado': return `${n(m.taxa)}% a.a.${adm}`;
    case 'poupanca': return 'regra da poupança';
    default: return 'Renda variável';
  }
}
export const taxaAno = (v: number) => `${pct(v)} a.a.`;
/** taxa de referência com até 2 casas: 13,65% */
export const taxa2 = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export const TIPOS_META: Record<string, { nome: string; icone: string }> = {
  viagem: { nome: 'Viagem', icone: '✈️' },
  cofrinho: { nome: 'Cofrinho', icone: '🐷' },
  investimento: { nome: 'Investimento', icone: '📈' },
  reserva: { nome: 'Reserva de emergência', icone: '🛟' },
  compra: { nome: 'Compra', icone: '🛍️' },
  outro: { nome: 'Outro objetivo', icone: '🎯' },
};

/** Converte texto "6,5" / "6.5" em número; vazio → null. */
export function numero(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(String(v).replace(/\./g, (m, i, s) => (s.includes(',') ? '' : m)).replace(',', '.'));
  return Number.isFinite(x) ? x : null;
}

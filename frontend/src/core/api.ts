import { ref } from 'vue';

// tolera barra no fim da variável (https://api.com/ → https://api.com)
const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3333').replace(/\/+$/, '');
const KEY = 'caixa.token';

function lerToken() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export const token = ref<string | null>(lerToken());

export function setToken(t: string | null) {
  token.value = t;
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* modo privado */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}),
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null); // token expirado: o guard do router manda para o login
    location.assign('/login');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j.erro ?? `Erro ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => req<T>('PUT', p, b),
  patch: <T>(p: string, b?: unknown) => req<T>('PATCH', p, b),
  del: (p: string) => req<void>('DELETE', p),
};

// ----------------------------- tipos da API -----------------------------
export type Meio = 'debito' | 'credito' | 'pix' | 'dinheiro' | 'boleto' | 'transferencia';
export type Conta = {
  id: string; nome: string; tipo: string; saldo_inicial_centavos: number; saldo_centavos: number; cor: string; ativa: boolean;
  pessoa_id: string | null; pessoa_nome?: string | null; cartao_debito: boolean;
};
export type Categoria = { id: string; nome: string; tipo: 'receita' | 'despesa'; cor: string };
export type Fatura = {
  id: string; cartao_id: string; cartao_nome: string; cartao_cor: string; competencia: string;
  data_fechamento: string; data_vencimento: string; total_centavos: number; valor_pago_centavos: number;
  em_aberto_centavos: number; pago_em: string | null; conta_pagamento_id: string | null; qtd_parcelas: number;
  status: 'aberta' | 'fechada' | 'paga' | 'parcial' | 'vencida';
};
export type Cartao = {
  id: string; nome: string; bandeira: string | null; final: string | null; limite_centavos: number;
  dia_fechamento: number; dia_vencimento: number; conta_pagamento_id: string | null; cor: string; ativo: boolean;
  pessoa_id: string | null; pessoa_nome?: string | null;
  usado_centavos: number; livre_centavos: number; futuras_centavos: number;
  fatura_atual: { id: string | null; competencia: string; data_fechamento: string; data_vencimento: string; total_centavos: number };
  fatura_a_pagar: Fatura | null;
  gasto_seguro_centavos?: number;
};
export type Lancamento = {
  id: string; tipo: 'receita' | 'despesa'; descricao: string; valor_centavos: number; data: string; meio: Meio;
  conta_id: string | null; cartao_id: string | null; categoria_id: string | null; parcelas_total: number;
  parcelas_pagas_antes: number; status: 'previsto' | 'realizado'; recorrencia_id: string | null; observacao: string | null;
  categoria_nome?: string; categoria_cor?: string; conta_nome?: string; cartao_nome?: string; qtd_comprovantes: number;
};
export type Recorrencia = {
  id: string; descricao: string; tipo: 'receita' | 'despesa'; valor_previsto_centavos: number; dia_mes: number; meio: Meio;
  categoria_id: string | null; conta_id: string | null; cartao_id: string | null; inicio: string; fim: string | null; ativa: boolean;
  categoria_nome?: string; conta_nome?: string; cartao_nome?: string;
  origem: 'manual' | 'salario' | 'divida' | 'acordo'; pessoa_nome?: string | null;
};
export type ParcelaPlanejada = { numero: number; valorCentavos: number; ciclo: { competencia: string; dataFechamento: string; dataVencimento: string } };
export type Comprovante = { id: string; nome_original: string; mime: string; tamanho_bytes: number; created_at: string };

export type Pessoa = {
  id: string; nome: string; cargo: string | null; salario_centavos: number | null; dia_salario: number | null;
  conta_salario_id: string | null; conta_salario_nome?: string | null; cor: string;
  cartoes_credito: { id: string; nome: string; cor: string; limite_centavos: number }[];
  contas: { id: string; nome: string; cor: string; cartao_debito: boolean }[];
  qtd_cartoes_credito: number; qtd_cartoes_debito: number; maior_limite_centavos: number; soma_limites_centavos: number;
  dividas_saldo_centavos: number; dividas_qtd: number; desconto_folha_centavos: number; parcelas_mensais_centavos: number;
  comprometimento_pct: number | null; inadimplencias_qtd: number; inadimplencias_em_aberto_centavos: number;
};
export type TipoDivida = 'consignado' | 'emprestimo' | 'financiamento_veiculo' | 'financiamento_imovel' | 'cheque_especial' | 'outro';
export type Divida = {
  id: string; pessoa_id: string | null; pessoa_nome?: string | null; pessoa_cor?: string | null; tipo: TipoDivida; credor: string;
  descricao: string | null; valor_contratado_centavos: number | null; taxa_mensal_pct: number | null; parcelas_total: number;
  valor_parcela_centavos: number; primeira_parcela: string; forma_pagamento: 'folha' | 'debito' | 'boleto' | 'pix';
  conta_id: string | null; conta_nome?: string | null; quitada_em: string | null; observacao: string | null;
  parcelas_pagas: number; parcelas_restantes: number; proxima_parcela: string | null; ultima_parcela: string;
  saldo_nominal_centavos: number; valor_quitacao_estimado_centavos: number | null; total_pago_no_fim_centavos: number; ativa: boolean;
};
export type OrigemInad = 'faculdade' | 'cartao' | 'emprestimo' | 'financiamento' | 'conta_consumo' | 'aluguel' | 'outro';
export type Inadimplencia = {
  id: string; pessoa_id: string | null; pessoa_nome?: string | null; pessoa_cor?: string | null; credor: string; origem: OrigemInad;
  motivo: string | null; valor_original_centavos: number; valor_atual_centavos: number | null; desde: string; negativado: boolean;
  status: 'em_aberto' | 'negociando' | 'acordo' | 'quitada'; acordo_parcelas: number | null; acordo_valor_parcela_centavos: number | null;
  acordo_primeira_parcela: string | null; acordo_forma_pagamento: 'boleto' | 'pix' | 'debito' | null; acordo_conta_id: string | null;
  quitada_em: string | null; observacao: string | null;
  meses_em_atraso: number | null; limite_negativacao: string | null; devido_centavos: number; acordo_total_centavos: number | null;
  acordo_desconto_centavos: number | null; acordo_parcelas_pagas: number | null; acordo_restante_centavos: number | null;
  acordo_proxima: string | null; acordo_ultima: string | null; em_aberto_centavos: number;
};

// ------------------------------------------------------------- trabalho (CLT)
export type SalarioHist = {
  id: string; vigencia: string; bruto_centavos: number; liquido_centavos: number | null; liquido_estimado: number;
  cargo: string | null; observacao: string | null;
};
export type FeriasGozada = { id: string; inicio: string; dias: number; abono_dias: number };
export type Periodo = {
  inicio: string; fim: string; limiteGozo: string; completo: boolean; quitado: boolean;
  diasDireito: number; diasUsados: number; diasSaldo: number; emDobro: boolean;
};
export type SimFerias = {
  dias: number; abonoDias: number; salarioBase: number; valorFerias: number; tercoFerias: number; abono: number;
  tercoAbono: number; inss: number; irrf: number; bruto: number; liquido: number;
};
export type Trabalho = {
  pessoa: Pessoa & {
    data_admissao: string | null; dependentes_ir: number; outros_descontos_centavos: number; paga_mes_seguinte: boolean;
    ferias_quitadas_ate: string | null; saque_aniversario: boolean; saldo_fgts_centavos: number | null; saldo_fgts_em: string | null;
    gerar_decimo: boolean;
  };
  salarios: SalarioHist[];
  ferias: FeriasGozada[];
  resumo: {
    temHistorico: boolean;
    salarioVigente: SalarioHist | null;
    liquidoAtual: { referencia: string; bruto: number; inss: number; irrf: number; outros: number; consignado: number; liquido: number; informado: boolean } | null;
    liquidoProximoMes: { liquido: number } | null;
    ferias: { periodos: Periodo[]; diasDisponiveis: number; prazoMaisProximo: string | null; algumEmDobro: boolean; simulacao30: SimFerias; simulacaoVendendo10: SimFerias } | null;
    decimo: { ano: number; salarioBase: number; avos: number; total: number; primeira: number; inss: number; irrf: number; segunda: number; liquido: number; datas: { primeira: string; segunda: string } } | null;
    avisoPrevioDias: number | null;
    fgtsEstimado: number | null;
    tempoDeCasa: { anos: number; meses: number } | null;
    tabelaAno: number;
  };
};
export type Rescisao = {
  tipo: string; dataSaida: string; dataProjetada: string; diasAviso: number; avisoTrabalhado: boolean; salarioBase: number;
  verbas: { codigo: string; descricao: string; valor: number; tipo: 'provento' | 'desconto'; obs?: string }[];
  proventos: number; descontos: number; liquidoRescisao: number;
  fgts: { saldoAntes: number; depositoRescisorio: number; multa40: number; sacavel: number; bloqueadoPorSaqueAniversario: boolean };
  totalDisponivel: number; seguroDesemprego: boolean; observacoes: string[];
};

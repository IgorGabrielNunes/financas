const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const dinheiro = (centavos: number) => brl.format(centavos / 100);
/** 13.1 → "13,1%" (vírgula decimal, como o resto da interface) */
export const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export const vezes = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`;

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Datas chegam como 'YYYY-MM-DD'. Formatamos por string para não cair na armadilha de fuso do `new Date()`.
export function dataCurta(d: string) {
  const [, m, dia] = d.split('-');
  return `${+dia} ${MESES[+m - 1]}`;
}
export function dataBR(d: string) {
  const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a}`;
}
export function mesAno(comp: string) {
  const [a, m] = comp.split('-');
  return `${MESES[+m - 1]}/${a.slice(2)}`;
}
export function mesLongo(ano: number, mes: number) {
  return `${MESES_LONGOS[mes - 1]} de ${ano}`;
}

export function hoje(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export function diasAte(d: string): number {
  const ms = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const h = hoje();
  const hms = Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10));
  return Math.round((ms - hms) / 86400000);
}

export const MEIOS: Record<string, string> = {
  debito: 'Débito', credito: 'Crédito', pix: 'Pix', dinheiro: 'Dinheiro', boleto: 'Boleto', transferencia: 'Transferência',
};

export const STATUS_FATURA: Record<string, string> = {
  aberta: 'Aberta', fechada: 'Fechada', paga: 'Paga', parcial: 'Paga em parte', vencida: 'Vencida',
};

export const TIPOS_DIVIDA: Record<string, string> = {
  consignado: 'Consignado', emprestimo: 'Empréstimo pessoal', financiamento_veiculo: 'Financiamento de veículo',
  financiamento_imovel: 'Financiamento de imóvel', cheque_especial: 'Cheque especial', outro: 'Outra dívida',
};
export const FORMAS_DIVIDA: Record<string, string> = {
  folha: 'Desconto em folha', debito: 'Débito automático', boleto: 'Boleto', pix: 'Pix',
};
export const ORIGENS_INAD: Record<string, string> = {
  faculdade: 'Faculdade / curso', cartao: 'Cartão de crédito', emprestimo: 'Empréstimo', financiamento: 'Financiamento',
  conta_consumo: 'Conta de consumo (luz, água, telefone)', aluguel: 'Aluguel', outro: 'Outro',
};
export const STATUS_INAD: Record<string, string> = {
  em_aberto: 'Em aberto', negociando: 'Negociando', acordo: 'Em acordo', quitada: 'Quitada',
};

/**
 * Cálculos trabalhistas (CLT) — funções puras, valores em centavos.
 *
 * Escopo: salário fixo mensal, sem horas extras, adicionais, comissões ou faltas.
 * Tudo aqui é ESTIMATIVA para planejamento; a folha da empresa é a fonte oficial.
 *
 * Tabelas por ano em TABELAS. Ano sem tabela usa a mais recente e sinaliza `tabelaAno`.
 */
import {
  type ISODate, parse, fmt, ultimoDia, somarDias, diasInclusivos, somarMesesData, maxData, minData,
} from '../../../core/datas.js';

// --------------------------------------------------------------------------- tabelas
type FaixaInss = { ate: number; aliquota: number; deduzir: number };
type FaixaIr = { ate: number; aliquota: number; deduzir: number };
type Tabela = {
  inss: FaixaInss[];           // último `ate` = teto do salário de contribuição
  irrf: FaixaIr[];             // último `ate` = Infinity
  deducaoDependente: number;
  descontoSimplificado: number;
  // Lei 15.270/2025 (art. 3º-A da Lei 9.250/1995): redução sobre o rendimento tributável bruto
  redutor: { isentoAte: number; reducaoMaxIsento: number; parcialAte: number; a: number; b: number } | null;
};

export const TABELAS: Record<number, Tabela> = {
  2026: {
    // Portaria interministerial 2026 — salário mínimo R$ 1.621,00, teto R$ 8.475,55
    inss: [
      { ate: 162100, aliquota: 0.075, deduzir: 0 },
      { ate: 290284, aliquota: 0.09, deduzir: 2432 },
      { ate: 435427, aliquota: 0.12, deduzir: 11140 },
      { ate: 847555, aliquota: 0.14, deduzir: 19849 },
    ],
    // tabela progressiva mensal (inalterada em 2026; a mudança veio pelo redutor)
    irrf: [
      { ate: 242880, aliquota: 0, deduzir: 0 },
      { ate: 282665, aliquota: 0.075, deduzir: 18216 },
      { ate: 375105, aliquota: 0.15, deduzir: 39416 },
      { ate: 466468, aliquota: 0.225, deduzir: 67549 },
      { ate: Infinity, aliquota: 0.275, deduzir: 90873 },
    ],
    deducaoDependente: 18959,
    descontoSimplificado: 60720,
    // até R$ 5.000: reduz até R$ 312,89 (zera o imposto); até R$ 7.350: 978,62 − 0,133145 × rendimento
    redutor: { isentoAte: 500000, reducaoMaxIsento: 31289, parcialAte: 735000, a: 97862, b: 0.133145 },
  },
};

export function tabela(ano: number): { t: Tabela; ano: number } {
  if (TABELAS[ano]) return { t: TABELAS[ano], ano };
  const anos = Object.keys(TABELAS).map(Number).sort((x, y) => x - y);
  const usado = anos.filter((a) => a <= ano).pop() ?? anos[0];
  return { t: TABELAS[usado], ano: usado };
}

// ------------------------------------------------------------------------ impostos
/** INSS do empregado: progressivo por faixas (equivalente a alíquota × base − parcela a deduzir), limitado ao teto. */
export function inss(baseCentavos: number, ano: number): number {
  const { t } = tabela(ano);
  if (baseCentavos <= 0) return 0;
  const teto = t.inss[t.inss.length - 1].ate;
  const base = Math.min(baseCentavos, teto);
  const faixa = t.inss.find((f) => base <= f.ate)!;
  return Math.round(base * faixa.aliquota - faixa.deduzir);
}

function impostoTabela(base: number, t: Tabela): number {
  if (base <= 0) return 0;
  const f = t.irrf.find((x) => base <= x.ate)!;
  return Math.max(0, Math.round(base * f.aliquota - f.deduzir));
}

function redutor(rendimentoBruto: number, imposto: number, t: Tabela): number {
  const r = t.redutor;
  if (!r || imposto <= 0) return 0;
  if (rendimentoBruto <= r.isentoAte) return Math.min(imposto, r.reducaoMaxIsento);
  if (rendimentoBruto <= r.parcialAte) return Math.min(imposto, Math.max(0, Math.round(r.a - r.b * rendimentoBruto)));
  return 0;
}

export type Irrf = { base: number; impostoTabela: number; reducao: number; imposto: number; simplificado: boolean };

/**
 * IRRF mensal. Usa a dedução mais vantajosa: (INSS + dependentes) ou desconto simplificado.
 * `exclusivo` (13º): sem desconto simplificado — só INSS e dependentes.
 * O redutor da Lei 15.270/2025 vale também para o 13º (§ 3º do art. 3º-A).
 */
export function irrf(rendimentoBruto: number, inssPago: number, dependentes: number, ano: number, exclusivo = false): Irrf {
  const { t } = tabela(ano);
  const baseLegal = rendimentoBruto - inssPago - dependentes * t.deducaoDependente;
  const baseSimpl = rendimentoBruto - t.descontoSimplificado;
  const usarSimpl = !exclusivo && impostoTabela(baseSimpl, t) < impostoTabela(baseLegal, t);
  const base = Math.max(0, usarSimpl ? baseSimpl : baseLegal);
  const bruto = impostoTabela(base, t);
  const reducao = redutor(rendimentoBruto, bruto, t);
  return { base, impostoTabela: bruto, reducao, imposto: bruto - reducao, simplificado: usarSimpl };
}

export type Liquido = { bruto: number; inss: number; irrf: number; outros: number; liquido: number };
export function salarioLiquido(bruto: number, dependentes: number, outrosDescontos: number, ano: number): Liquido {
  const i = inss(bruto, ano);
  const ir = irrf(bruto, i, dependentes, ano).imposto;
  return { bruto, inss: i, irrf: ir, outros: outrosDescontos, liquido: bruto - i - ir - outrosDescontos };
}

// ------------------------------------------------------------------------- avos
/** Avos de 13º no ano: mês com 15 dias ou mais trabalhados conta 1/12 (Lei 4.090/1962). */
export function avos13(admissao: ISODate, ate: ISODate, ano: number): number {
  let avos = 0;
  for (let m = 1; m <= 12; m++) {
    const ini = maxData(admissao, fmt(ano, m, 1));
    const fim = minData(ate, fmt(ano, m, ultimoDia(ano, m)));
    if (fim >= ini && diasInclusivos(ini, fim) >= 15) avos++;
  }
  return avos;
}

/** Avos de férias no período aquisitivo iniciado em `inicio`: mês completo = 1; fração > 14 dias = 1 (art. 146). */
export function avosFerias(inicio: ISODate, ate: ISODate): number {
  if (ate < inicio) return 0;
  let k = 0;
  while (k < 12 && somarDias(somarMesesData(inicio, k + 1), -1) <= ate) k++;
  if (k >= 12) return 12;
  const resto = diasInclusivos(somarMesesData(inicio, k), ate);
  return k + (resto >= 15 ? 1 : 0);
}

// ----------------------------------------------------------------------- férias
export type FeriasGozo = { inicio: ISODate; dias: number; abono_dias: number };

export type PeriodoAquisitivo = {
  inicio: ISODate;
  fim: ISODate;               // fim do período aquisitivo
  limiteGozo: ISODate;        // fim do período concessivo (12 meses depois)
  completo: boolean;
  quitado: boolean;           // marcado como resolvido antes de usar o app
  diasDireito: number;        // 30 (completo) ou proporcional (avos × 2,5)
  diasUsados: number;
  diasSaldo: number;
  emDobro: boolean;           // concessivo vencido sem gozo integral (art. 137)
};

/**
 * Períodos aquisitivos desde a admissão até `ate`. Férias gozadas consomem os períodos mais
 * antigos primeiro (FIFO). Períodos que terminam até `quitadasAte` contam como resolvidos.
 * Simplificação: não considera faltas injustificadas (art. 130).
 */
export function periodosFerias(admissao: ISODate, ate: ISODate, quitadasAte: ISODate | null, gozos: FeriasGozo[]): PeriodoAquisitivo[] {
  const ps: PeriodoAquisitivo[] = [];
  for (let k = 0; ; k++) {
    const inicio = somarMesesData(admissao, 12 * k);
    if (inicio > ate) break;
    const fim = somarDias(somarMesesData(admissao, 12 * (k + 1)), -1);
    const completo = fim <= ate;
    const quitado = !!quitadasAte && fim <= quitadasAte;
    const diasDireito = completo ? 30 : Math.round(avosFerias(inicio, ate) * 2.5);
    ps.push({
      inicio, fim, limiteGozo: somarDias(somarMesesData(admissao, 12 * (k + 2)), -1), completo, quitado,
      diasDireito: quitado ? 0 : diasDireito, diasUsados: 0, diasSaldo: quitado ? 0 : diasDireito, emDobro: false,
    });
  }
  // FIFO: cada gozo (dias + abono vendido) abate dos períodos em aberto mais antigos
  let fila = [...gozos].sort((a, b) => (a.inicio < b.inicio ? -1 : 1)).map((g) => g.dias + g.abono_dias);
  for (const p of ps) {
    if (p.quitado) continue;
    const cap = p.completo ? 30 : 30; // férias podem ser antecipadas sobre período incompleto
    while (fila.length && p.diasUsados < cap) {
      const usa = Math.min(fila[0], cap - p.diasUsados);
      p.diasUsados += usa;
      fila[0] -= usa;
      if (fila[0] === 0) fila.shift();
    }
    p.diasSaldo = Math.max(0, p.diasDireito - p.diasUsados);
    p.emDobro = p.completo && p.diasSaldo > 0 && ate > p.limiteGozo;
  }
  return ps;
}

export type ResultadoFerias = {
  dias: number; abonoDias: number; salarioBase: number;
  valorFerias: number; tercoFerias: number; abono: number; tercoAbono: number;
  inss: number; irrf: number; bruto: number; liquido: number;
};

/**
 * Férias gozadas: (salário/30 × dias) + 1/3, com INSS e IRRF (calculado em separado do salário do mês).
 * Abono pecuniário (venda de até 10 dias, art. 143) + 1/3: sem INSS (art. 144) e sem IR.
 */
export function calcularFerias(salario: number, dias: number, abonoDias: number, dependentes: number, ano: number): ResultadoFerias {
  const valorFerias = Math.round((salario / 30) * dias);
  const tercoFerias = Math.round(valorFerias / 3);
  const abono = Math.round((salario / 30) * abonoDias);
  const tercoAbono = Math.round(abono / 3);
  const tributavel = valorFerias + tercoFerias;
  const i = inss(tributavel, ano);
  const ir = irrf(tributavel, i, dependentes, ano).imposto;
  const bruto = tributavel + abono + tercoAbono;
  return { dias, abonoDias, salarioBase: salario, valorFerias, tercoFerias, abono, tercoAbono, inss: i, irrf: ir, bruto, liquido: bruto - i - ir };
}

// ---------------------------------------------------------------------------- 13º
export type Decimo = {
  avos: number; total: number; primeira: number; inss: number; irrf: number; segunda: number; liquido: number;
};
/** 13º: 1ª parcela (até 30/11) = metade, sem descontos; 2ª (até 20/12) = restante − INSS − IRRF (exclusivo na fonte). */
export function calcularDecimo(salario: number, avos: number, dependentes: number, ano: number): Decimo {
  const total = Math.round((salario * avos) / 12);
  const primeira = Math.round(total / 2);
  const i = inss(total, ano);
  const ir = irrf(total, i, dependentes, ano, true).imposto;
  return { avos, total, primeira, inss: i, irrf: ir, segunda: total - primeira - i - ir, liquido: total - i - ir };
}

// ------------------------------------------------------------------------ rescisão
export type TipoRescisao = 'sem_justa_causa' | 'pedido_demissao' | 'justa_causa';

/** Aviso prévio proporcional (Lei 12.506/2011): 30 dias + 3 por ano completo, até 90. Devido pelo empregador. */
export function diasAvisoProporcional(admissao: ISODate, desligamento: ISODate): number {
  let anos = 0;
  while (somarMesesData(admissao, 12 * (anos + 1)) <= desligamento) anos++;
  return Math.min(90, 30 + 3 * anos);
}

export type Verba = { codigo: string; descricao: string; valor: number; tipo: 'provento' | 'desconto'; tributavel: boolean; obs?: string };

export type EntradaRescisao = {
  tipo: TipoRescisao;
  dataReferencia: ISODate;      // sem justa/justa: último dia trabalhado; pedido: data em que avisa
  admissao: ISODate;
  salarioEm: (data: ISODate) => number;  // salário bruto vigente numa data (histórico)
  dependentes: number;
  feriasQuitadasAte: ISODate | null;
  gozos: FeriasGozo[];
  saldoFgts: number;            // saldo estimado/informado antes das verbas rescisórias
  saqueAniversario: boolean;
};

export type ResultadoRescisao = {
  tipo: TipoRescisao;
  dataSaida: ISODate;
  dataProjetada: ISODate;
  diasAviso: number;
  avisoTrabalhado: boolean;
  salarioBase: number;
  verbas: Verba[];
  proventos: number;
  descontos: number;
  liquidoRescisao: number;
  fgts: { saldoAntes: number; depositoRescisorio: number; multa40: number; sacavel: number; bloqueadoPorSaqueAniversario: boolean };
  totalDisponivel: number;
  seguroDesemprego: boolean;
  observacoes: string[];
};

export function calcularRescisao(e: EntradaRescisao): ResultadoRescisao {
  const obs: string[] = [];
  const pedido = e.tipo === 'pedido_demissao';
  const semJusta = e.tipo === 'sem_justa_causa';

  // Pedido com aviso trabalhado: 30 dias contados do dia seguinte ao aviso (proporcional não se aplica ao empregado).
  const saida = pedido ? somarDias(e.dataReferencia, 30) : e.dataReferencia;
  const diasAviso = semJusta ? diasAvisoProporcional(e.admissao, saida) : pedido ? 30 : 0;
  // Aviso indenizado projeta o contrato (art. 487, § 1º): conta para 13º e férias.
  const projetada = semJusta ? somarDias(saida, diasAviso) : saida;
  const salario = e.salarioEm(saida);
  const ano = parse(saida).ano;
  const diaria = salario / 30;
  const verbas: Verba[] = [];
  const add = (v: Verba) => { if (v.valor !== 0) verbas.push(v); };

  // saldo de salário (mês comercial de 30 dias)
  const diasSaldo = Math.min(parse(saida).dia, 30);
  const saldoSalario = Math.round(diaria * diasSaldo);
  add({ codigo: 'saldo', descricao: `Saldo de salário (${diasSaldo} dias)`, valor: saldoSalario, tipo: 'provento', tributavel: true });

  let aviso = 0;
  if (semJusta) {
    aviso = Math.round(diaria * diasAviso);
    add({ codigo: 'aviso', descricao: `Aviso prévio indenizado (${diasAviso} dias)`, valor: aviso, tipo: 'provento', tributavel: false, obs: 'Isento de IR e de INSS' });
  }
  if (pedido) obs.push('Aviso trabalhado: os 30 dias do aviso são pagos como salário normal até a data de saída.');

  // 13º proporcional (não devido na justa causa)
  let decimo = 0;
  const anoProj = parse(projetada).ano;
  if (!(e.tipo === 'justa_causa')) {
    const av = avos13(e.admissao, projetada, anoProj);
    decimo = Math.round((salario * av) / 12);
    add({ codigo: '13', descricao: `13º proporcional (${av}/12)`, valor: decimo, tipo: 'provento', tributavel: true });
    // 1ª parcela só foi adiantada se a pessoa ainda estava empregada em 30/11 daquele ano
    if (anoProj === ano && saida >= fmt(ano, 11, 30) && av > 0) {
      const adiantado = Math.round(salario / 2);
      add({ codigo: '13adiant', descricao: '1ª parcela do 13º já paga', valor: Math.min(adiantado, decimo), tipo: 'desconto', tributavel: false, obs: 'Supõe 1ª parcela paga até 30/11' });
    }
    if (anoProj > ano) obs.push('A projeção do aviso atravessa o ano: o 13º do ano da saída já teria sido pago em dezembro.');
  }

  // férias
  const ps = periodosFerias(e.admissao, projetada, e.feriasQuitadasAte, e.gozos);
  const vencidas = ps.filter((p) => p.completo && p.diasSaldo > 0);
  for (const p of vencidas) {
    const valor = Math.round(diaria * p.diasSaldo) * (p.emDobro ? 2 : 1);
    add({
      codigo: 'ferias_venc', descricao: `Férias vencidas ${fmtCurta(p.inicio)}–${fmtCurta(p.fim)} (${p.diasSaldo} dias${p.emDobro ? ', em dobro' : ''})`,
      valor, tipo: 'provento', tributavel: false, obs: p.emDobro ? 'Prazo para gozo expirou (art. 137)' : undefined,
    });
    add({ codigo: 'terco', descricao: '1/3 sobre férias vencidas', valor: Math.round(valor / 3), tipo: 'provento', tributavel: false });
  }
  if (e.tipo !== 'justa_causa') {
    const atual = ps.find((p) => !p.completo);
    if (atual && atual.diasSaldo > 0) {
      const valor = Math.round(diaria * atual.diasSaldo);
      add({ codigo: 'ferias_prop', descricao: `Férias proporcionais (${atual.diasSaldo} dias)`, valor, tipo: 'provento', tributavel: false });
      add({ codigo: 'terco', descricao: '1/3 sobre férias proporcionais', valor: Math.round(valor / 3), tipo: 'provento', tributavel: false });
    }
  } else {
    obs.push('Justa causa: sem aviso, sem 13º e férias proporcionais, sem saque do FGTS e sem multa de 40%.');
  }

  // descontos legais — férias indenizadas e aviso indenizado são isentos (Súmula 386 STJ; Lei 7.713/88 art. 6º, V)
  const inssSaldo = inss(saldoSalario, ano);
  const irSaldo = irrf(saldoSalario, inssSaldo, e.dependentes, ano).imposto;
  add({ codigo: 'inss', descricao: 'INSS sobre saldo de salário', valor: inssSaldo, tipo: 'desconto', tributavel: false });
  add({ codigo: 'irrf', descricao: 'IRRF sobre saldo de salário', valor: irSaldo, tipo: 'desconto', tributavel: false });
  if (decimo > 0) {
    const inss13 = inss(decimo, anoProj);
    add({ codigo: 'inss13', descricao: 'INSS sobre 13º', valor: inss13, tipo: 'desconto', tributavel: false });
    add({ codigo: 'irrf13', descricao: 'IRRF sobre 13º (exclusivo na fonte)', valor: irrf(decimo, inss13, e.dependentes, anoProj, true).imposto, tipo: 'desconto', tributavel: false });
  }

  const proventos = verbas.filter((v) => v.tipo === 'provento').reduce((s, v) => s + v.valor, 0);
  const descontos = verbas.filter((v) => v.tipo === 'desconto').reduce((s, v) => s + v.valor, 0);

  // FGTS: 8% sobre saldo, aviso indenizado (Súmula 305 TST) e 13º; não incide sobre férias indenizadas
  const deposito = Math.round(0.08 * (saldoSalario + aviso + decimo));
  const multa = semJusta ? Math.round(0.4 * (e.saldoFgts + deposito)) : 0;
  const bloqueado = semJusta && e.saqueAniversario;
  const sacavel = semJusta ? (bloqueado ? multa : e.saldoFgts + deposito + multa) : 0;
  if (bloqueado) obs.push('Com saque-aniversário ativo, na demissão sem justa causa só a multa de 40% é liberada; o saldo fica retido.');
  if (semJusta) obs.push('Pode ter direito a seguro-desemprego (depende de quantas vezes já pediu e de meses trabalhados).');
  if (pedido) obs.push('Pedido de demissão: FGTS fica na conta (sem saque e sem multa) e não há seguro-desemprego.');

  return {
    tipo: e.tipo, dataSaida: saida, dataProjetada: projetada, diasAviso, avisoTrabalhado: pedido, salarioBase: salario,
    verbas, proventos, descontos, liquidoRescisao: proventos - descontos,
    fgts: { saldoAntes: e.saldoFgts, depositoRescisorio: deposito, multa40: multa, sacavel, bloqueadoPorSaqueAniversario: bloqueado },
    totalDisponivel: proventos - descontos + sacavel,
    seguroDesemprego: semJusta,
    observacoes: obs,
  };
}

function fmtCurta(d: ISODate) {
  const p = parse(d);
  return `${String(p.mes).padStart(2, '0')}/${p.ano}`;
}

// ---------------------------------------------------------------------- FGTS estimado
/**
 * Saldo estimado de FGTS: 8% do salário de cada mês trabalhado + 8% do 13º de cada ano, a partir de
 * um saldo informado (ou da admissão). Ignora a remuneração da conta (TR + 3% a.a. + distribuição de
 * lucros) — o saldo real tende a ser um pouco maior. Consulte o app FGTS para o valor exato.
 */
export function estimarFgts(admissao: ISODate, ate: ISODate, salarioEm: (d: ISODate) => number, saldoInformado: number | null, informadoEm: ISODate | null): number {
  let saldo = saldoInformado ?? 0;
  const inicio = saldoInformado !== null && informadoEm ? informadoEm : admissao;
  const ini = parse(inicio);
  const fim = parse(ate);
  // meses completos depois do ponto de partida até o mês anterior à data
  let a = ini.ano, m = ini.mes;
  const avancar = () => { m++; if (m > 12) { m = 1; a++; } };
  if (saldoInformado !== null) avancar(); // o mês do saldo informado já está nele
  while (a < fim.ano || (a === fim.ano && m < fim.mes)) {
    const ref = fmt(a, m, 1);
    const sal = salarioEm(ref);
    const diasMes = ultimoDia(a, m);
    const ini2 = maxData(admissao, ref);
    // mês inteiro = salário cheio (fevereiro não vale "28/30"); mês de admissão = proporcional aos dias
    const trabalhados = ini2 === ref ? 30 : Math.min(30, diasInclusivos(ini2, fmt(a, m, diasMes)));
    saldo += Math.round(0.08 * (sal / 30) * trabalhados);
    if (m === 12) saldo += Math.round(0.08 * ((sal * avos13(admissao, fmt(a, 12, 31), a)) / 12));
    avancar();
  }
  return saldo;
}

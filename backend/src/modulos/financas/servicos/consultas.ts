import type { PoolClient } from 'pg';
import { cicloAtual, statusFatura } from '../dominio/fatura.js';
import { competencia, diaNoMes, hojeSP, mesDe, somarMeses, ultimoDia, type Mes } from '../../../core/datas.js';
import { materializarJanela, materializarMes } from './recorrencias.js';
import { listarDividas, listarInadimplencias } from '../rotas/pessoas.js';
import { garantirVinculos } from './trabalho.js';

// ---------------------------------------------------------------------------
// Saldos de contas
// saldo = inicial + receitas realizadas − despesas realizadas (fora do crédito) − pagamentos de fatura
// ---------------------------------------------------------------------------
export async function contasComSaldo(c: PoolClient, userId: string) {
  const { rows } = await c.query(
    `select ct.*,
       ct.saldo_inicial_centavos
       + coalesce((select sum(case when l.tipo = 'receita' then l.valor_centavos else -l.valor_centavos end)
                     from lancamentos l
                    where l.conta_id = ct.id and l.status = 'realizado' and l.meio <> 'credito'), 0)
       - coalesce((select sum(f.valor_pago_centavos) from faturas f where f.conta_pagamento_id = ct.id), 0)
       as saldo_centavos,
       (select nome from pessoas p where p.id = ct.pessoa_id) as pessoa_nome
     from contas ct where ct.casa_id = $1 order by ct.ativa desc, ct.nome`,
    [userId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Faturas com total calculado a partir das parcelas (fatura nunca guarda total)
// ---------------------------------------------------------------------------
const SQL_FATURAS = `
  select f.id, f.cartao_id, f.competencia, f.data_fechamento, f.data_vencimento,
         f.valor_pago_centavos, f.pago_em, f.conta_pagamento_id,
         ca.nome as cartao_nome, ca.cor as cartao_cor,
         coalesce(sum(p.valor_centavos), 0)::bigint as total_centavos,
         count(p.id)::int as qtd_parcelas
    from faturas f
    join cartoes ca on ca.id = f.cartao_id
    left join parcelas p on p.fatura_id = f.id
   where f.casa_id = $1 %FILTRO%
   group by f.id, ca.nome, ca.cor
   order by f.data_vencimento`;

export async function listarFaturas(c: PoolClient, userId: string, filtro = '', params: unknown[] = []) {
  const hoje = hojeSP();
  const { rows } = await c.query(SQL_FATURAS.replace('%FILTRO%', filtro), [userId, ...params]);
  return rows.map((f) => ({
    ...f,
    em_aberto_centavos: Math.max(f.total_centavos - f.valor_pago_centavos, 0),
    status: statusFatura(
      { dataFechamento: f.data_fechamento, dataVencimento: f.data_vencimento, totalCentavos: f.total_centavos, valorPagoCentavos: f.valor_pago_centavos },
      hoje,
    ),
  }));
}

// ---------------------------------------------------------------------------
// Cartões: limite usado = tudo que ainda não foi pago, em faturas atuais E futuras
// (é assim que o emissor calcula: uma compra 10x consome o limite inteiro na hora)
// ---------------------------------------------------------------------------
export async function cartoesResumo(c: PoolClient, userId: string) {
  const hoje = hojeSP();
  const cartoes = (await c.query(
    `select ca.*, p.nome as pessoa_nome from cartoes ca left join pessoas p on p.id = ca.pessoa_id
      where ca.casa_id = $1 order by ca.ativo desc, ca.nome`, [userId])).rows;
  const faturas = await listarFaturas(c, userId);
  return cartoes.map((ca) => {
    const fs = faturas.filter((f) => f.cartao_id === ca.id);
    const usado = fs.reduce((s, f) => s + f.em_aberto_centavos, 0);
    const atual = cicloAtual({ diaFechamento: ca.dia_fechamento, diaVencimento: ca.dia_vencimento }, hoje);
    const faturaAtual = fs.find((f) => f.competencia === atual.competencia);
    // próxima a pagar: a mais antiga fechada/vencida com saldo em aberto
    const aPagar = fs.find((f) => f.em_aberto_centavos > 0 && f.status !== 'aberta');
    return {
      ...ca,
      usado_centavos: usado,
      livre_centavos: ca.limite_centavos - usado,
      fatura_atual: {
        competencia: atual.competencia,
        data_fechamento: atual.dataFechamento,
        data_vencimento: atual.dataVencimento,
        total_centavos: faturaAtual?.total_centavos ?? 0,
        id: faturaAtual?.id ?? null,
      },
      fatura_a_pagar: aPagar ?? null,
      futuras_centavos: fs
        .filter((f) => f.competencia > atual.competencia)
        .reduce((s, f) => s + f.em_aberto_centavos, 0),
    };
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export async function dashboard(c: PoolClient, userId: string) {
  const hoje = hojeSP();
  const mesAtual = mesDe(hoje);
  await garantirVinculos(c, userId); // salário e 13º acompanham histórico e virada de ano
  // garante que as recorrências do horizonte de projeção existam (6 meses)
  await materializarJanela(c, userId, mesAtual, 6);

  const contas = await contasComSaldo(c, userId);
  const saldoContas = contas.filter((x) => x.ativa).reduce((s, x) => s + x.saldo_centavos, 0);

  // Horizonte = próxima receita prevista (normalmente o salário). Sem receita prevista: fim do mês.
  const prox = await c.query<{ data: string; descricao: string }>(
    `select data, descricao from lancamentos
      where casa_id = $1 and tipo = 'receita' and status = 'previsto' and data > $2
      order by data limit 1`,
    [userId, hoje],
  );
  const horizonte = prox.rows[0]?.data ?? diaNoMes(mesAtual.ano, mesAtual.mes, ultimoDia(mesAtual.ano, mesAtual.mes));

  // Assimetria proposital (conservadora):
  // - receitas previstas só contam se ainda VÃO cair (data >= hoje). Uma receita com data passada e não
  //   confirmada é ambígua (caiu e ninguém confirmou, ou atrasou?) — vira pendência para o usuário resolver,
  //   em vez de inflar o disponível;
  // - despesas previstas contam inclusive atrasadas: ainda precisam ser pagas.
  const prev = await c.query<{ receitas: number; despesas: number }>(
    `select
       coalesce(sum(valor_centavos) filter (where tipo = 'receita' and data >= $3), 0) as receitas,
       coalesce(sum(valor_centavos) filter (where tipo = 'despesa'), 0) as despesas
     from lancamentos
     where casa_id = $1 and status = 'previsto' and meio <> 'credito' and data < $2`,
    [userId, horizonte, hoje],
  );
  const pendentes = await c.query(
    `select id, descricao, valor_centavos, data from lancamentos
      where casa_id = $1 and tipo = 'receita' and status = 'previsto' and data < $2 and data >= $3
      order by data`,
    [userId, hoje, competencia(somarMeses(mesAtual, -1))],
  );

  const faturas = await listarFaturas(c, userId);
  const faturasAteHorizonte = faturas.filter((f) => f.data_vencimento <= horizonte && f.em_aberto_centavos > 0);
  const faturasAPagar = faturasAteHorizonte.reduce((s, f) => s + f.em_aberto_centavos, 0);

  const disponivel = saldoContas + prev.rows[0].receitas - prev.rows[0].despesas - faturasAPagar;

  const cartoes = (await cartoesResumo(c, userId)).filter((x) => x.ativo);

  // Projeção mensal: quanto da receita do mês já está comprometido
  const projecao = [];
  for (let i = 0; i < 6; i++) {
    const m = somarMeses(mesAtual, i);
    const ini = competencia(m);
    const fim = diaNoMes(m.ano, m.mes, ultimoDia(m.ano, m.mes));
    const r = await c.query<{ receitas: number; despesas: number }>(
      `select coalesce(sum(valor_centavos) filter (where tipo = 'receita'), 0) as receitas,
              coalesce(sum(valor_centavos) filter (where tipo = 'despesa' and meio <> 'credito'), 0) as despesas
         from lancamentos where casa_id = $1 and data between $2 and $3`,
      [userId, ini, fim],
    );
    const fat = faturas.filter((f) => f.competencia === ini).reduce((s, f) => s + f.total_centavos, 0);
    const { receitas, despesas } = r.rows[0];
    projecao.push({
      competencia: ini,
      receitas_centavos: receitas,
      despesas_centavos: despesas,
      faturas_centavos: fat,
      saldo_centavos: receitas - despesas - fat,
      comprometido_pct: receitas > 0 ? Math.round(((despesas + fat) / receitas) * 1000) / 10 : null,
    });
  }

  const dividas = (await listarDividas(c, userId)).filter((d) => d.ativa);
  const inads = (await listarInadimplencias(c, userId)).filter((i) => i.status !== 'quitada');
  const renda = await c.query<{ total: number }>('select coalesce(sum(salario_centavos), 0) as total from pessoas where casa_id = $1', [userId]);
  const parcelasCaixa = dividas.filter((d) => d.forma_pagamento !== 'folha').reduce((s, d) => s + d.valor_parcela_centavos, 0)
    + inads.filter((i) => i.status === 'acordo' && i.acordo_proxima).reduce((s, i) => s + i.acordo_valor_parcela_centavos, 0);

  return {
    hoje,
    horizonte,
    dividas: {
      qtd: dividas.length,
      saldo_centavos: dividas.reduce((s, d) => s + d.saldo_nominal_centavos, 0),
      parcelas_mensais_centavos: parcelasCaixa,
      desconto_folha_centavos: dividas.filter((d) => d.forma_pagamento === 'folha').reduce((s, d) => s + d.valor_parcela_centavos, 0),
      renda_mensal_centavos: renda.rows[0].total,
      comprometimento_pct: renda.rows[0].total > 0 ? Math.round((parcelasCaixa / renda.rows[0].total) * 1000) / 10 : null,
      inadimplencias_qtd: inads.length,
      inadimplencias_em_aberto_centavos: inads.reduce((s, i) => s + i.em_aberto_centavos, 0),
    },
    proxima_receita: prox.rows[0] ?? null,
    receitas_a_confirmar: pendentes.rows,
    disponivel: {
      disponivel_centavos: disponivel,
      saldo_contas_centavos: saldoContas,
      receitas_previstas_centavos: prev.rows[0].receitas,
      despesas_previstas_centavos: prev.rows[0].despesas,
      faturas_a_pagar_centavos: faturasAPagar,
      faturas: faturasAteHorizonte,
    },
    contas,
    cartoes: cartoes.map((ca) => ({
      ...ca,
      // quanto dá para passar no cartão sem estourar nem o limite nem o caixa real
      gasto_seguro_centavos: Math.max(0, Math.min(ca.livre_centavos, disponivel)),
    })),
    projecao,
  };
}

// ---------------------------------------------------------------------------
// Visão do mês (gastos mensais)
// ---------------------------------------------------------------------------
export async function visaoMes(c: PoolClient, userId: string, mes: Mes) {
  await garantirVinculos(c, userId);
  await materializarMes(c, userId, mes);
  const ini = competencia(mes);
  const fim = diaNoMes(mes.ano, mes.mes, ultimoDia(mes.ano, mes.mes));

  const lanc = await c.query(
    `select l.*, cat.nome as categoria_nome, cat.cor as categoria_cor, ct.nome as conta_nome, ca.nome as cartao_nome,
            (select count(*)::int from comprovantes cp where cp.lancamento_id = l.id) as qtd_comprovantes
       from lancamentos l
       left join categorias cat on cat.id = l.categoria_id
       left join contas ct on ct.id = l.conta_id
       left join cartoes ca on ca.id = l.cartao_id
      where l.casa_id = $1 and l.data between $2 and $3
      order by l.data, l.created_at`,
    [userId, ini, fim],
  );
  const caixa = lanc.rows.filter((l) => l.meio !== 'credito');
  const credito = lanc.rows.filter((l) => l.meio === 'credito');
  const faturas = await listarFaturas(c, userId, 'and f.competencia = $2', [ini]);

  const soma = (arr: any[], f: (x: any) => boolean) => arr.filter(f).reduce((s, x) => s + x.valor_centavos, 0);
  const receitas = soma(caixa, (l) => l.tipo === 'receita');
  const despesas = soma(caixa, (l) => l.tipo === 'despesa');
  const totalFaturas = faturas.reduce((s, f) => s + f.total_centavos, 0);

  return {
    competencia: ini,
    totais: {
      receitas_centavos: receitas,
      receitas_realizadas_centavos: soma(caixa, (l) => l.tipo === 'receita' && l.status === 'realizado'),
      despesas_centavos: despesas,
      despesas_realizadas_centavos: soma(caixa, (l) => l.tipo === 'despesa' && l.status === 'realizado'),
      faturas_centavos: totalFaturas,
      compras_credito_centavos: soma(credito, () => true),
      saldo_previsto_centavos: receitas - despesas - totalFaturas,
    },
    receitas: caixa.filter((l) => l.tipo === 'receita'),
    despesas: caixa.filter((l) => l.tipo === 'despesa'),
    faturas,
    compras_credito: credito,
  };
}

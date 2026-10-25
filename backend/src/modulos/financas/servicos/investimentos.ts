// Investimentos, metas e taxas de referência (dados da CASA).
import type { PoolClient } from 'pg';
import { pool } from '../../../core/db.js';
import { hojeSP, somarMesesData, type ISODate } from '../../../core/datas.js';
import { notFound } from '../../../core/errors.js';
import { diasCorridos, posicao, taxaAnual, type Modelo, type Movimento, type Posicao, type SaldoInformado, type Taxas } from '../dominio/investimentos.js';

// ------------------------------------------------------------------ taxas de referência
export type TaxasCasa = Taxas & { fonte: 'padrao' | 'bcb' | 'manual'; atualizado_em: string };

const SERIES_BCB = { selic_aa: 432, cdi_aa: 4389, ipca_aa: 13522, tr_am: 226 } as const;

/** Lê a última observação de cada série do SGS (Banco Central). Séries que falharem ficam de fora. */
export async function buscarTaxasBCB(fetcher: typeof fetch = fetch): Promise<Partial<Taxas>> {
  const out: Partial<Taxas> = {};
  await Promise.allSettled(Object.entries(SERIES_BCB).map(async ([campo, serie]) => {
    const r = await fetcher(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1?formato=json`,
      { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
    if (!r.ok) return;
    const j = (await r.json()) as { valor?: string }[];
    const v = Number(String(j?.at(-1)?.valor ?? '').replace(',', '.'));
    if (Number.isFinite(v) && v >= 0 && v < 100) out[campo as keyof Taxas] = v;
  }));
  return out;
}

const norm = (r: any): TaxasCasa => ({
  selic_aa: Number(r.selic_aa), cdi_aa: Number(r.cdi_aa), ipca_aa: Number(r.ipca_aa), tr_am: Number(r.tr_am),
  fonte: r.fonte, atualizado_em: new Date(r.atualizado_em).toISOString(),
});

export async function lerTaxas(c: PoolClient | typeof pool, casaId: string): Promise<TaxasCasa> {
  await c.query('insert into taxas_referencia (casa_id) values ($1) on conflict do nothing', [casaId]);
  return norm((await c.query('select * from taxas_referencia where casa_id = $1', [casaId])).rows[0]);
}

/**
 * Atualiza do Banco Central se estiver velho (12 h) ou se `forcar`. Fora de transação: a chamada externa
 * não pode segurar conexão do pool. Valores manuais só são substituídos quando o usuário pede (`forcar`).
 */
export async function atualizarTaxasSeVelhas(casaId: string, forcar = false, fetcher?: typeof fetch) {
  const atual = await lerTaxas(pool, casaId);
  const velho = Date.now() - Date.parse(atual.atualizado_em) > 12 * 3600_000 || atual.fonte === 'padrao';
  if (!forcar && (atual.fonte === 'manual' || !velho)) return { taxas: atual, atualizou: false };
  if (!forcar && process.env.NODE_ENV === 'test') return { taxas: atual, atualizou: false };
  const novas = await buscarTaxasBCB(fetcher).catch(() => ({} as Partial<Taxas>));
  if (novas.selic_aa === undefined || novas.cdi_aa === undefined) return { taxas: atual, atualizou: false };
  const r = await pool.query(
    `update taxas_referencia set selic_aa = $2, cdi_aa = $3, ipca_aa = coalesce($4, ipca_aa), tr_am = coalesce($5, tr_am),
            fonte = 'bcb', atualizado_em = now() where casa_id = $1 returning *`,
    [casaId, novas.selic_aa, novas.cdi_aa, novas.ipca_aa ?? null, novas.tr_am ?? null]);
  return { taxas: norm(r.rows[0]), atualizou: true };
}

// ------------------------------------------------------------------ investimentos
export const modeloDe = (i: { indexador: string; taxa: string | number; isento_ir: boolean; taxa_adm_aa: string | number }): Modelo => ({
  indexador: i.indexador as Modelo['indexador'], taxa: Number(i.taxa), isento_ir: i.isento_ir, taxa_adm_aa: Number(i.taxa_adm_aa),
});

export type InvestimentoComPosicao = Record<string, any> & { posicao: Posicao; modelo: Modelo };

/** Todos os investimentos da casa com a posição de hoje (3 consultas, cálculo em memória). */
export async function carregarInvestimentos(c: PoolClient, casaId: string, taxas?: Taxas, hoje: ISODate = hojeSP()) {
  const t = taxas ?? (await lerTaxas(c, casaId));
  const [invs, movs, saldos] = await Promise.all([
    c.query(
      `select i.*, ct.nome as conta_nome, ct.cor as conta_cor, m.nome as meta_nome, u.nome as usuario_nome
         from investimentos i
         left join contas ct on ct.id = i.conta_id
         left join metas m on m.id = i.meta_id
         left join usuarios u on u.id = i.usuario_id
        where i.casa_id = $1 order by i.ativo desc, i.created_at`, [casaId]),
    c.query('select investimento_id, tipo, data, valor_centavos, created_at as criado from investimentos_movimentos where casa_id = $1', [casaId]),
    c.query('select investimento_id, data, valor_centavos, created_at as criado from investimentos_saldos where casa_id = $1', [casaId]),
  ]);
  const porInv = <T extends { investimento_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.investimento_id, [...(m.get(r.investimento_id) ?? []), r]);
    return m;
  };
  const mv = porInv(movs.rows), sd = porInv(saldos.rows);
  return invs.rows.map((i): InvestimentoComPosicao => {
    const modelo = modeloDe(i);
    return {
      ...i, taxa: Number(i.taxa), taxa_adm_aa: Number(i.taxa_adm_aa), modelo,
      posicao: posicao((mv.get(i.id) ?? []) as Movimento[], (sd.get(i.id) ?? []) as SaldoInformado[], modelo, t, hoje),
    };
  });
}

export function totaisInvestimentos(invs: InvestimentoComPosicao[]) {
  const ativos = invs.filter((i) => i.ativo);
  const s = (k: keyof Posicao) => ativos.reduce((a, i) => a + (i.posicao[k] as number), 0);
  return {
    investido_centavos: s('investido_centavos'),
    saldo_bruto_centavos: s('saldo_bruto_centavos'),
    rendimento_bruto_centavos: s('rendimento_bruto_centavos'),
    saldo_liquido_centavos: s('saldo_liquido_centavos'),
    rendimento_liquido_centavos: s('rendimento_liquido_centavos'),
    rendimento_mes_centavos: s('rendimento_mes_centavos'),
    qtd: ativos.length,
  };
}

/** Evolução mensal do saldo (para o gráfico do detalhe): do primeiro movimento até hoje, até 60 pontos. */
export function evolucao(movs: Movimento[], saldos: SaldoInformado[], m: Modelo, t: Taxas, hoje: ISODate) {
  const datas = [...movs, ...saldos].map((x) => x.data).sort();
  if (!datas.length) return [];
  const pontos: ISODate[] = [];
  const meses = Math.max(1, Math.ceil(diasCorridos(datas[0], hoje) / 30.44));
  const passo = Math.max(1, Math.ceil(meses / 60));
  for (let k = 0; k < meses; k += passo) pontos.push(somarMesesData(datas[0], k));
  pontos.push(hoje);
  return pontos.filter((d, i, a) => d <= hoje && a.indexOf(d) === i).map((d) => {
    const p = posicao(movs, saldos, m, t, d);
    return { data: d, saldo_centavos: p.saldo_bruto_centavos, investido_centavos: p.investido_centavos };
  });
}

// ------------------------------------------------------------------ metas
export async function listarMetas(c: PoolClient, casaId: string, invs?: InvestimentoComPosicao[], hoje: ISODate = hojeSP()) {
  const lista = invs ?? (await carregarInvestimentos(c, casaId, undefined, hoje));
  const metas = (await c.query(
    `select m.*, u.nome as usuario_nome,
            coalesce((select sum(valor_centavos) from metas_movimentos mm where mm.meta_id = m.id), 0)::bigint as guardado_manual_centavos,
            (select count(*)::int from metas_movimentos mm where mm.meta_id = m.id) as qtd_movimentos
       from metas m left join usuarios u on u.id = m.usuario_id
      where m.casa_id = $1 order by m.arquivada, m.data_alvo nulls last, m.created_at`, [casaId])).rows;
  const t = await lerTaxas(c, casaId);
  return metas.map((m) => {
    const vinculados = lista.filter((i) => i.meta_id === m.id && i.ativo);
    const emInvest = vinculados.reduce((s, i) => s + i.posicao.saldo_bruto_centavos, 0);
    const guardado = m.guardado_manual_centavos + emInvest;
    const falta = Math.max(0, m.valor_alvo_centavos - guardado);
    let meses: number | null = null;
    if (m.data_alvo) {
      const dias = diasCorridos(hoje, m.data_alvo);
      meses = dias <= 0 ? 0 : Math.max(1, Math.ceil(dias / 30.44));
    }
    // quanto guardar por mês: sem rendimento (dinheiro parado) e, se houver investimento vinculado,
    // considerando que o que já está aplicado e os novos aportes rendem à taxa líquida média dele
    let comRendimento: number | null = null;
    if (meses && falta > 0 && vinculados.length) {
      const peso = vinculados.reduce((s, i) => s + Math.max(1, i.posicao.saldo_bruto_centavos), 0);
      const aaLiq = vinculados.reduce((s, i) => s + Math.max(1, i.posicao.saldo_bruto_centavos) * (taxaAnual(i.modelo, t) * (i.modelo.isento_ir ? 1 : 0.85)), 0) / peso;
      const im = Math.pow(1 + aaLiq, 1 / 12) - 1;
      const futuroDoAplicado = emInvest * Math.pow(1 + im, meses);
      const precisa = m.valor_alvo_centavos - m.guardado_manual_centavos - futuroDoAplicado;
      comRendimento = precisa <= 0 ? 0 : im > 0 ? Math.round((precisa * im) / (Math.pow(1 + im, meses) - 1)) : Math.round(precisa / meses);
    }
    return {
      ...m,
      em_investimentos_centavos: emInvest,
      guardado_centavos: guardado,
      falta_centavos: falta,
      pct: Math.min(100, Math.round((guardado / m.valor_alvo_centavos) * 1000) / 10),
      concluida: guardado >= m.valor_alvo_centavos,
      meses_restantes: meses,
      mensal_necessario_centavos: meses ? Math.ceil(falta / meses) : null,
      mensal_com_rendimento_centavos: comRendimento,
      investimentos: vinculados.map((i) => ({ id: i.id, nome: i.nome, saldo_centavos: i.posicao.saldo_bruto_centavos })),
    };
  });
}

/** Confere que um id (conta, meta, usuário, investimento) é desta casa. */
export async function daCasa(c: PoolClient, tabela: 'contas' | 'metas' | 'usuarios' | 'investimentos', id: string | null | undefined, casaId: string, nome: string) {
  if (!id) return;
  const r = await c.query(`select 1 from ${tabela} where id = $1 and casa_id = $2`, [id, casaId]);
  if (!r.rowCount) throw notFound(nome);
}

import type { PoolClient } from 'pg';
import { planejarCompra, type Ciclo } from '../dominio/fatura.js';
import { badRequest, conflict, notFound } from '../../../core/errors.js';
import { storage } from '../../../core/storage.js';
import { tx } from '../../../core/db.js';

export type Meio = 'debito' | 'credito' | 'pix' | 'dinheiro' | 'boleto' | 'transferencia';

export type LancamentoInput = {
  tipo: 'receita' | 'despesa';
  descricao: string;
  valor_centavos: number;
  data: string;
  meio: Meio;
  conta_id?: string | null;
  cartao_id?: string | null;
  categoria_id?: string | null;
  parcelas_total?: number;
  parcelas_pagas_antes?: number;
  status?: 'previsto' | 'realizado';
  observacao?: string | null;
  recorrencia_id?: string | null;
  competencia?: string | null;
};

type Cartao = { id: string; dia_fechamento: number; dia_vencimento: number };

async function garantirDono(c: PoolClient, tabela: 'contas' | 'cartoes' | 'categorias', id: string | null | undefined, userId: string) {
  if (!id) return;
  const r = await c.query(`select 1 from ${tabela} where id = $1 and casa_id = $2`, [id, userId]);
  if (!r.rowCount) throw notFound(tabela === 'contas' ? 'Conta' : tabela === 'cartoes' ? 'Cartão' : 'Categoria');
}

async function carregarCartao(c: PoolClient, id: string, userId: string): Promise<Cartao> {
  const r = await c.query<Cartao>(
    'select id, dia_fechamento, dia_vencimento from cartoes where id = $1 and casa_id = $2',
    [id, userId],
  );
  if (!r.rowCount) throw notFound('Cartão');
  return r.rows[0];
}

/** Upsert idempotente da fatura do ciclo. Retorna id e se já está paga (bloqueia novas parcelas). */
export async function faturaDoCiclo(c: PoolClient, userId: string, cartaoId: string, ciclo: Ciclo) {
  const r = await c.query<{ id: string; valor_pago_centavos: number }>(
    `insert into faturas (casa_id, cartao_id, competencia, data_fechamento, data_vencimento)
     values ($1, $2, $3, $4, $5)
     on conflict (cartao_id, competencia) do update set cartao_id = excluded.cartao_id
     returning id, valor_pago_centavos`,
    [userId, cartaoId, ciclo.competencia, ciclo.dataFechamento, ciclo.dataVencimento],
  );
  return r.rows[0];
}

async function gerarParcelas(c: PoolClient, userId: string, lancamentoId: string, cartao: Cartao, data: string, total: number, n: number, pagasAntes = 0) {
  const plano = planejarCompra(
    { diaFechamento: cartao.dia_fechamento, diaVencimento: cartao.dia_vencimento },
    data,
    total,
    n,
  );
  for (const p of plano) {
    if (p.numero <= pagasAntes) continue; // quitada antes de usar o app: não entra em fatura nem consome limite
    const fatura = await faturaDoCiclo(c, userId, cartao.id, p.ciclo);
    if (fatura.valor_pago_centavos > 0) {
      throw conflict(`A fatura com vencimento em ${p.ciclo.dataVencimento} já tem pagamento registrado. Ajuste o pagamento antes de lançar nela.`);
    }
    await c.query(
      'insert into parcelas (lancamento_id, fatura_id, numero, valor_centavos) values ($1, $2, $3, $4)',
      [lancamentoId, fatura.id, p.numero, p.valorCentavos],
    );
  }
}

/** Impede alterar/excluir compra cujas parcelas já estão em fatura com pagamento. */
export async function bloquearSeFaturaPaga(c: PoolClient, lancamentoId: string) {
  const r = await c.query(
    `select 1 from parcelas p join faturas f on f.id = p.fatura_id
      where p.lancamento_id = $1 and f.valor_pago_centavos > 0 limit 1`,
    [lancamentoId],
  );
  if (r.rowCount) {
    throw conflict('Esta compra tem parcelas em fatura com pagamento registrado. Estorne/ajuste o pagamento da fatura antes.');
  }
}

function validar(i: LancamentoInput) {
  if (i.meio === 'credito') {
    if (!i.cartao_id) throw badRequest('Compra no crédito exige cartão');
    if (i.tipo !== 'despesa') throw badRequest('Crédito só para despesa (estorno: exclua ou edite a compra)');
  } else {
    if (i.cartao_id) throw badRequest('Cartão só se aplica a meio "credito"');
    if ((i.parcelas_total ?? 1) !== 1) throw badRequest('Parcelamento só existe no crédito');
  }
  if ((i.parcelas_pagas_antes ?? 0) >= (i.parcelas_total ?? 1)) throw badRequest('Parcelas já pagas deve ser menor que o total de parcelas');
}

export async function criarLancamento(c: PoolClient, userId: string, i: LancamentoInput): Promise<string> {
  validar(i);
  await garantirDono(c, 'contas', i.conta_id, userId);
  await garantirDono(c, 'categorias', i.categoria_id, userId);
  const cartao = i.cartao_id ? await carregarCartao(c, i.cartao_id, userId) : null;

  const r = await c.query<{ id: string }>(
    `insert into lancamentos (casa_id, tipo, descricao, valor_centavos, data, meio, conta_id, cartao_id,
        categoria_id, parcelas_total, status, observacao, recorrencia_id, competencia, parcelas_pagas_antes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [
      userId, i.tipo, i.descricao, i.valor_centavos, i.data, i.meio,
      i.meio === 'credito' ? null : i.conta_id ?? null, i.cartao_id ?? null, i.categoria_id ?? null,
      i.parcelas_total ?? 1, i.status ?? 'realizado', i.observacao ?? null,
      i.recorrencia_id ?? null, i.competencia ?? null, i.meio === 'credito' ? i.parcelas_pagas_antes ?? 0 : 0,
    ],
  );
  const id = r.rows[0].id;
  if (cartao) await gerarParcelas(c, userId, id, cartao, i.data, i.valor_centavos, i.parcelas_total ?? 1, i.parcelas_pagas_antes ?? 0);
  return id;
}

export async function atualizarLancamento(c: PoolClient, userId: string, id: string, patch: Partial<LancamentoInput>) {
  const atual = await c.query('select * from lancamentos where id = $1 and casa_id = $2 for update', [id, userId]);
  if (!atual.rowCount) throw notFound('Lançamento');
  const a = atual.rows[0];
  const novo: LancamentoInput = {
    tipo: patch.tipo ?? a.tipo,
    descricao: patch.descricao ?? a.descricao,
    valor_centavos: patch.valor_centavos ?? a.valor_centavos,
    data: patch.data ?? a.data,
    meio: patch.meio ?? a.meio,
    conta_id: patch.conta_id !== undefined ? patch.conta_id : a.conta_id,
    cartao_id: patch.cartao_id !== undefined ? patch.cartao_id : a.cartao_id,
    categoria_id: patch.categoria_id !== undefined ? patch.categoria_id : a.categoria_id,
    parcelas_total: patch.parcelas_total ?? a.parcelas_total,
    parcelas_pagas_antes: patch.parcelas_pagas_antes ?? a.parcelas_pagas_antes,
    status: patch.status ?? a.status,
    observacao: patch.observacao !== undefined ? patch.observacao : a.observacao,
  };
  // trocar o meio para fora do crédito limpa o cartão automaticamente
  if (patch.meio && patch.meio !== 'credito' && patch.cartao_id === undefined) {
    novo.cartao_id = null;
    novo.parcelas_total = 1;
    novo.parcelas_pagas_antes = 0;
  }
  validar(novo);
  await garantirDono(c, 'contas', novo.conta_id, userId);
  await garantirDono(c, 'categorias', novo.categoria_id, userId);

  const mexeNoCredito =
    a.meio === 'credito' || novo.meio === 'credito'
      ? a.meio !== novo.meio || a.cartao_id !== novo.cartao_id || a.valor_centavos !== novo.valor_centavos ||
        a.data !== novo.data || a.parcelas_total !== novo.parcelas_total ||
        a.parcelas_pagas_antes !== novo.parcelas_pagas_antes
      : false;

  if (mexeNoCredito) {
    await bloquearSeFaturaPaga(c, id);
    await c.query('delete from parcelas where lancamento_id = $1', [id]);
  }

  await c.query(
    `update lancamentos set tipo=$3, descricao=$4, valor_centavos=$5, data=$6, meio=$7, conta_id=$8, cartao_id=$9,
        categoria_id=$10, parcelas_total=$11, status=$12, observacao=$13, parcelas_pagas_antes=$14
      where id=$1 and casa_id=$2`,
    [
      id, userId, novo.tipo, novo.descricao, novo.valor_centavos, novo.data, novo.meio,
      novo.meio === 'credito' ? null : novo.conta_id ?? null, novo.cartao_id ?? null, novo.categoria_id ?? null,
      novo.parcelas_total ?? 1, novo.status, novo.observacao ?? null,
      novo.meio === 'credito' ? novo.parcelas_pagas_antes ?? 0 : 0,
    ],
  );

  if (mexeNoCredito && novo.meio === 'credito') {
    const cartao = await carregarCartao(c, novo.cartao_id!, userId);
    await gerarParcelas(c, userId, id, cartao, novo.data, novo.valor_centavos, novo.parcelas_total ?? 1, novo.parcelas_pagas_antes ?? 0);
  }
}

/** Exclui o lançamento; os arquivos de comprovante são removidos do storage só após o commit. */
export async function excluirLancamento(userId: string, id: string) {
  const chaves = await tx(async (c) => {
    const r = await c.query('select 1 from lancamentos where id = $1 and casa_id = $2 for update', [id, userId]);
    if (!r.rowCount) throw notFound('Lançamento');
    await bloquearSeFaturaPaga(c, id);
    const k = await c.query<{ storage_key: string }>('select storage_key from comprovantes where lancamento_id = $1', [id]);
    await c.query('delete from lancamentos where id = $1', [id]);
    return k.rows.map((x) => x.storage_key);
  });
  await Promise.all(chaves.map((k) => storage.remove(k)));
}

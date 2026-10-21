// Importação de fatura: prévia (nada é gravado), confirmação (um lote, numa transação) e desfazer.
import type { PoolClient } from 'pg';
import { badRequest, conflict, notFound } from '../../../core/errors.js';
import { storage } from '../../../core/storage.js';
import { tx } from '../../../core/db.js';
import { bloquearSeFaturaPaga, criarLancamento } from '../servicos/lancamentos.js';
import { lerArquivo, type Formato, type Parcela } from './leitor.js';
import { chaveDescricao, cicloDaFatura, planejarLinha, resolverData, sugerirCategoria, type Plano } from './regras.js';
import type { Mes } from '../../../core/datas.js';

export type StatusItem = 'novo' | 'duplicado' | 'ignorado' | 'erro';
export type ItemPrevia = {
  linha: number;
  data: string | null;
  descricao: string;
  valor_centavos: number;          // valor da linha (na compra parcelada, o valor da parcela)
  parcela: Parcela | null;
  plano: Plano | null;
  categoria_id: string | null;
  status: StatusItem;
  motivo: string | null;
};

const mesDe = (venc: string): Mes => ({ ano: +venc.slice(0, 4), mes: +venc.slice(5, 7) });

async function cartaoDaCasa(c: PoolClient, casaId: string, cartaoId: string) {
  const r = await c.query<{ id: string; nome: string; dia_fechamento: number; dia_vencimento: number }>(
    'select id, nome, dia_fechamento, dia_vencimento from cartoes where id = $1 and casa_id = $2', [cartaoId, casaId]);
  if (!r.rowCount) throw notFound('Cartão');
  const k = r.rows[0];
  return { ...k, regra: { diaFechamento: k.dia_fechamento, diaVencimento: k.dia_vencimento } };
}

/** Histórico de categorias da casa: descrição normalizada → categoria mais recente usada. */
async function historicoCategorias(c: PoolClient, casaId: string) {
  const r = await c.query<{ descricao: string; categoria_id: string }>(
    `select descricao, categoria_id from lancamentos where casa_id = $1 and categoria_id is not null and tipo = 'despesa'
      order by created_at desc limit 3000`, [casaId]);
  const m = new Map<string, string>();
  for (const l of r.rows) { const k = chaveDescricao(l.descricao); if (k && !m.has(k)) m.set(k, l.categoria_id); }
  return m;
}

const parecidas = (a: string, b: string) => {
  const x = chaveDescricao(a), y = chaveDescricao(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
};

export async function previaImportacao(casaId: string, b: { cartao_id: string; vencimento: string; conteudo: string; nome?: string }) {
  return tx(async (c) => {
    const cartao = await cartaoDaCasa(c, casaId, b.cartao_id);
    const venc = mesDe(b.vencimento);
    const alvo = cicloDaFatura(cartao.regra, venc);
    let leitura;
    try { leitura = lerArquivo(b.conteudo, b.nome); } catch (e) { throw badRequest((e as Error).message); }

    const [categorias, historico] = await Promise.all([
      c.query<{ id: string; nome: string; tipo: string }>('select id, nome, tipo from categorias where casa_id = $1', [casaId]).then((r) => r.rows),
      historicoCategorias(c, casaId),
    ]);
    // compras já cadastradas no cartão, para marcar duplicados (inclusive parcelas de meses anteriores)
    const existentes = (await c.query<{ id: string; descricao: string; valor_centavos: string; data: string; parcelas_total: number }>(
      `select id, descricao, valor_centavos, data, parcelas_total from lancamentos
        where casa_id = $1 and cartao_id = $2 and meio = 'credito' and data >= $3::date - interval '4 years'`,
      [casaId, cartao.id, alvo.dataFechamento])).rows.map((l) => ({ ...l, valor: Number(l.valor_centavos), usado: false }));

    const itens: ItemPrevia[] = leitura.linhas.map((l) => {
      const base: ItemPrevia = { linha: l.linha, data: null, descricao: l.descricao, valor_centavos: l.valor_centavos, parcela: l.parcela, plano: null, categoria_id: null, status: 'novo', motivo: null };
      if (l.erro || !l.data) return { ...base, status: 'erro', motivo: l.erro ?? 'Data inválida' };
      const data = resolverData(l.data, venc);
      if (l.valor_centavos <= 0) {
        return { ...base, data, status: 'ignorado', motivo: l.valor_centavos === 0 ? 'Valor zero' : 'Pagamento, estorno ou crédito (não é compra)' };
      }
      const plano = planejarLinha(cartao.regra, venc, data, l.valor_centavos, l.parcela);
      const item: ItemPrevia = { ...base, data, plano, categoria_id: sugerirCategoria(l.descricao, l.categoria_texto, historico, categorias) };

      // duplicado: compra parcelada já cadastrada (a parcela deste mês já existe) ou à vista igual (mesmo dia e valor)
      const dup = l.parcela
        ? existentes.find((e) => !e.usado && e.parcelas_total === l.parcela!.total && parecidas(e.descricao, l.descricao)
            && Math.abs(Math.round(e.valor / e.parcelas_total) - l.valor_centavos) <= Math.max(2, e.parcelas_total))
        : existentes.find((e) => !e.usado && e.parcelas_total === 1 && e.data === data && e.valor === l.valor_centavos);
      if (dup) {
        dup.usado = true; // duas compras iguais no arquivo e uma no Vida: só uma é duplicada
        return { ...item, status: 'duplicado', motivo: l.parcela ? `Compra já cadastrada (“${dup.descricao}”): a parcela ${l.parcela.atual}/${l.parcela.total} já está nas faturas` : `Já existe “${dup.descricao}” nesse dia com esse valor` };
      }
      if (plano.fora_da_fatura) {
        return { ...item, motivo: `Pelo dia de fechamento cadastrado no cartão (${cartao.dia_fechamento}), cai na fatura de ${plano.competencia.slice(5, 7)}/${plano.competencia.slice(0, 4)}` };
      }
      return item;
    });

    // fatura provável do arquivo: onde caem as compras à vista pelo cadastro do cartão (maioria de ≥ 60%)
    const contagemCiclos = new Map<string, number>();
    for (const i of itens) if (i.plano && !i.parcela) contagemCiclos.set(i.plano.competencia, (contagemCiclos.get(i.plano.competencia) ?? 0) + 1);
    const totalAVista = [...contagemCiclos.values()].reduce((s, n) => s + n, 0);
    const [maisComum, n] = [...contagemCiclos.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const faturaSugerida = maisComum && maisComum !== alvo.competencia && n / totalAVista >= 0.6 ? maisComum.slice(0, 7) : null;

    // conferência: o que a fatura já tem no Vida × o que vai entrar
    const naFatura = Number((await c.query(
      `select coalesce(sum(p.valor_centavos), 0)::bigint as t from parcelas p join faturas f on f.id = p.fatura_id
        where f.cartao_id = $1 and f.competencia = $2`, [cartao.id, alvo.competencia])).rows[0].t);
    const novos = itens.filter((i) => i.status === 'novo');
    const soma = (xs: ItemPrevia[]) => xs.reduce((s, i) => s + i.valor_centavos, 0);
    return {
      formato: leitura.formato,
      sinal_invertido: leitura.sinal_invertido,
      avisos: leitura.avisos,
      cartao: { id: cartao.id, nome: cartao.nome },
      fatura: { ...alvo, total_atual_centavos: naFatura },
      fatura_sugerida: faturaSugerida,
      totais: {
        arquivo_gastos: soma(itens.filter((i) => i.valor_centavos > 0 && i.status !== 'erro')),
        arquivo_creditos: -soma(itens.filter((i) => i.status === 'ignorado' && i.valor_centavos < 0)),
        novos: soma(novos),
        duplicados: soma(itens.filter((i) => i.status === 'duplicado')),
      },
      contagem: {
        novo: novos.length, duplicado: itens.filter((i) => i.status === 'duplicado').length,
        ignorado: itens.filter((i) => i.status === 'ignorado').length, erro: itens.filter((i) => i.status === 'erro').length,
      },
      itens,
    };
  });
}

export type ItemConfirmar = { data: string; descricao: string; valor_centavos: number; parcela: Parcela | null; categoria_id: string | null };

/** Grava um lote: tudo ou nada. O plano é recalculado aqui (não confia no que veio do navegador). */
export async function confirmarImportacao(casaId: string, userId: string, b: {
  cartao_id: string; vencimento: string; arquivo_nome?: string | null; formato: Formato; itens: ItemConfirmar[];
}) {
  if (!b.itens.length) throw badRequest('Nenhum item selecionado');
  return tx(async (c) => {
    const cartao = await cartaoDaCasa(c, casaId, b.cartao_id);
    const venc = mesDe(b.vencimento);
    const alvo = cicloDaFatura(cartao.regra, venc);
    const imp = (await c.query<{ id: string }>(
      `insert into importacoes (casa_id, cartao_id, competencia, arquivo_nome, formato, criado_por) values ($1,$2,$3,$4,$5,$6) returning id`,
      [casaId, cartao.id, alvo.competencia, b.arquivo_nome ?? null, b.formato, userId])).rows[0].id;
    let total = 0;
    for (const i of b.itens) {
      const p = planejarLinha(cartao.regra, venc, i.data, i.valor_centavos, i.parcela);
      const id = await criarLancamento(c, casaId, {
        tipo: 'despesa', descricao: i.descricao, valor_centavos: p.valor_total, data: p.data, meio: 'credito',
        cartao_id: cartao.id, categoria_id: i.categoria_id, parcelas_total: p.parcelas_total, parcelas_pagas_antes: p.parcelas_pagas_antes,
        observacao: `Importado${b.arquivo_nome ? ` de ${b.arquivo_nome}` : ''}${i.parcela ? ` (parcela ${i.parcela.atual}/${i.parcela.total} na fatura importada)` : ''}`,
      });
      await c.query('update lancamentos set importacao_id = $2 where id = $1', [id, imp]);
      total += i.valor_centavos;
    }
    await c.query('update importacoes set qtd = $2, total_centavos = $3 where id = $1', [imp, b.itens.length, total]);
    return { importacao_id: imp, criados: b.itens.length, total_centavos: total, competencia: alvo.competencia };
  });
}

export async function listarImportacoes(c: PoolClient, casaId: string, cartaoId?: string) {
  return (await c.query(
    `select i.*, ca.nome as cartao_nome, u.nome as criado_por_nome,
            (select count(*)::int from lancamentos l where l.importacao_id = i.id) as ainda_existentes
       from importacoes i join cartoes ca on ca.id = i.cartao_id left join usuarios u on u.id = i.criado_por
      where i.casa_id = $1 ${cartaoId ? 'and i.cartao_id = $2' : ''}
      order by i.created_at desc limit 50`, cartaoId ? [casaId, cartaoId] : [casaId])).rows;
}

/** Desfaz o lote inteiro (atômico). Bloqueia se alguma parcela estiver em fatura com pagamento registrado. */
export async function desfazerImportacao(casaId: string, id: string) {
  const chaves = await tx(async (c) => {
    const imp = await c.query('select id from importacoes where id = $1 and casa_id = $2 for update', [id, casaId]);
    if (!imp.rowCount) throw notFound('Importação');
    const ls = (await c.query<{ id: string }>('select id from lancamentos where importacao_id = $1 for update', [id])).rows;
    for (const l of ls) {
      try { await bloquearSeFaturaPaga(c, l.id); } catch {
        throw conflict('Alguma compra desta importação está em fatura com pagamento registrado. Ajuste o pagamento antes de desfazer.');
      }
    }
    const k = await c.query<{ storage_key: string }>('select storage_key from comprovantes where lancamento_id = any($1)', [ls.map((l) => l.id)]);
    await c.query('delete from lancamentos where importacao_id = $1', [id]);
    await c.query('delete from importacoes where id = $1', [id]);
    return { removidos: ls.length, chaves: k.rows.map((x) => x.storage_key) };
  });
  await Promise.all(chaves.chaves.map((k) => storage.remove(k)));
  return { removidos: chaves.removidos };
}

import type { PoolClient } from 'pg';
import { competencia, hojeSP, mesDe } from '../domain/datas.js';
import { descartarPrevistasFuturas } from './recorrencias.js';
import type { Meio } from './lancamentos.js';

export type Origem = 'salario' | 'divida' | 'acordo' | 'decimo1' | 'decimo2';

export type SpecRecorrencia = {
  descricao: string;
  tipo: 'receita' | 'despesa';
  valor_previsto_centavos: number;
  dia_mes: number;
  meio: Meio;
  conta_id: string | null;
  categoria: string;            // nome; criada se não existir
  pessoa_id: string | null;
  inicio: string;               // competência (1º dia do mês)
  fim: string | null;
};

async function categoriaPorNome(c: PoolClient, userId: string, nome: string, tipo: 'receita' | 'despesa') {
  const r = await c.query<{ id: string }>(
    `insert into categorias (user_id, nome, tipo, cor) values ($1, $2, $3, $4)
     on conflict (user_id, nome, tipo) do update set nome = excluded.nome returning id`,
    [userId, nome, tipo, tipo === 'receita' ? '#15803d' : '#7f1d1d'],
  );
  return r.rows[0].id;
}

/**
 * Mantém a recorrência derivada de um salário/dívida/acordo em sincronia com a origem.
 * spec = null → a origem deixou de gerar parcelas (quitada, folha, sem salário): remove a regra
 * e as instâncias PREVISTAS daqui pra frente; o que já foi realizado fica no histórico.
 * Nunca começa antes do mês corrente (evita previstos retroativos).
 */
export async function sincronizarRecorrencia(c: PoolClient, userId: string, origem: Origem, origemId: string, spec: SpecRecorrencia | null) {
  const atual = await c.query(
    'select * from recorrencias where user_id = $1 and origem = $2 and origem_id = $3',
    [userId, origem, origemId],
  );
  const ex = atual.rows[0];
  const existente: string | undefined = ex?.id;
  const mesAtual = competencia(mesDe(hojeSP()));

  if (!spec || (spec.fim && spec.fim < mesAtual)) {
    if (existente) {
      await descartarPrevistasFuturas(c, userId, existente);
      await c.query('delete from recorrencias where id = $1', [existente]);
    }
    return;
  }

  const categoriaId = await categoriaPorNome(c, userId, spec.categoria, spec.tipo);
  // `inicio` só é escolhido na criação ou quando a janela muda (fim diferente, ex.: 13º do ano seguinte).
  // Reaplicar a cada leitura empurraria o início para frente e apagaria previstos ainda não confirmados.
  const inicioNovo = spec.inicio > mesAtual ? spec.inicio : mesAtual;
  const inicio = ex && (ex.fim ?? null) === (spec.fim ?? null) ? ex.inicio : inicioNovo;
  const valores = [
    spec.descricao, spec.tipo, spec.valor_previsto_centavos, spec.dia_mes, spec.meio, categoriaId,
    spec.conta_id, inicio, spec.fim, spec.pessoa_id,
  ];
  if (ex) {
    const igual = ex.descricao === spec.descricao && ex.tipo === spec.tipo && Number(ex.valor_previsto_centavos) === spec.valor_previsto_centavos
      && ex.dia_mes === spec.dia_mes && ex.meio === spec.meio && ex.categoria_id === categoriaId && (ex.conta_id ?? null) === (spec.conta_id ?? null)
      && ex.inicio === inicio && (ex.fim ?? null) === (spec.fim ?? null) && (ex.pessoa_id ?? null) === (spec.pessoa_id ?? null) && ex.ativa;
    if (igual) return; // nada mudou: não regera instâncias (chamado em toda leitura do painel)
    await c.query(
      `update recorrencias set descricao=$2, tipo=$3, valor_previsto_centavos=$4, dia_mes=$5, meio=$6, categoria_id=$7,
              conta_id=$8, inicio=$9, fim=$10, pessoa_id=$11, ativa=true, cartao_id=null where id=$1`,
      [existente, ...valores],
    );
    await descartarPrevistasFuturas(c, userId, existente!); // regeneradas com os valores novos
  } else {
    await c.query(
      `insert into recorrencias (descricao, tipo, valor_previsto_centavos, dia_mes, meio, categoria_id, conta_id, inicio, fim, pessoa_id,
                                 user_id, origem, origem_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [...valores, userId, origem, origemId],
    );
  }
}

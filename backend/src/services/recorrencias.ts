import type { PoolClient } from 'pg';
import { competencia, diaNoMes, hojeSP, mesDe, somarMeses, type Mes } from '../domain/datas.js';
import { HttpError } from '../errors.js';
import { criarLancamento } from './lancamentos.js';
import { liquidoCompetencia } from './salario.js';

type Regra = {
  id: string; descricao: string; tipo: 'receita' | 'despesa'; valor_previsto_centavos: number; dia_mes: number;
  meio: any; categoria_id: string | null; conta_id: string | null; cartao_id: string | null;
  origem: string; origem_id: string | null;
};

/**
 * Materializa as instâncias do mês para todas as regras vigentes. Idempotente:
 * - pula regras que já têm instância na competência (inclusive se o usuário editou/realizou);
 * - o índice único (recorrencia_id, competencia) cobre corrida entre duas requisições.
 * Cada inserção roda num SAVEPOINT para que um conflito não aborte a transação inteira.
 */
export async function materializarMes(c: PoolClient, userId: string, mes: Mes) {
  const comp = competencia(mes);
  const { rows } = await c.query<Regra>(
    `select r.* from recorrencias r
      where r.user_id = $1 and r.ativa and r.inicio <= $2 and (r.fim is null or r.fim >= $2)
        -- nunca gera "previsto" em mês anterior ao cadastro da regra: abrir um mês antigo criaria
        -- contas fantasmas "atrasadas" que derrubariam o disponível. Histórico se lança à mão.
        and $2 >= date_trunc('month', r.created_at at time zone 'America/Sao_Paulo')::date
        and not exists (select 1 from lancamentos l where l.recorrencia_id = r.id and l.competencia = $2)`,
    [userId, comp],
  );
  for (const r of rows) {
    await c.query('savepoint mat');
    try {
      await criarLancamento(c, userId, {
        tipo: r.tipo,
        descricao: r.descricao,
        // salário segue o histórico: aumento com vigência futura entra no mês certo
        valor_centavos: (r.origem === 'salario' && r.origem_id ? await liquidoCompetencia(c, r.origem_id, comp) : null) ?? r.valor_previsto_centavos,
        data: diaNoMes(mes.ano, mes.mes, r.dia_mes),
        meio: r.meio,
        conta_id: r.conta_id,
        cartao_id: r.cartao_id,
        categoria_id: r.categoria_id,
        status: 'previsto',
        recorrencia_id: r.id,
        competencia: comp,
      });
      await c.query('release savepoint mat');
    } catch (e) {
      await c.query('rollback to savepoint mat');
      // 23505 = unique_violation (outra requisição gerou antes); 409 = fatura já paga. Ambos: pular.
      if ((e as any)?.code !== '23505' && !(e instanceof HttpError && e.status === 409)) throw e;
    }
  }
}

export async function materializarJanela(c: PoolClient, userId: string, de: Mes, meses: number) {
  for (let i = 0; i < meses; i++) await materializarMes(c, userId, somarMeses(de, i));
}

/**
 * Ao editar/desativar uma regra, as instâncias ainda PREVISTAS do mês corrente em diante
 * são descartadas e serão regeneradas com os novos valores na próxima leitura.
 * Instâncias realizadas (histórico) nunca são tocadas.
 */
export async function descartarPrevistasFuturas(c: PoolClient, userId: string, recorrenciaId: string) {
  const comp = competencia(mesDe(hojeSP()));
  await c.query(
    `delete from lancamentos l
      where l.user_id = $1 and l.recorrencia_id = $2 and l.status = 'previsto' and l.competencia >= $3
        and not exists (select 1 from parcelas p join faturas f on f.id = p.fatura_id
                         where p.lancamento_id = l.id and f.valor_pago_centavos > 0)`,
    [userId, recorrenciaId, comp],
  );
}

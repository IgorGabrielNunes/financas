import pg from 'pg';
import { env } from './env.js';

// DATE (1082) como string 'YYYY-MM-DD': o padrão do driver é Date em TZ local, que
// desloca um dia em servidores UTC vs. cliente em -03:00. Bug clássico; aqui é cortado na raiz.
pg.types.setTypeParser(1082, (v) => v);
// BIGINT (20) e NUMERIC (1700, resultado de SUM em bigint) como number.
// Seguro até 2^53 centavos (~90 trilhões de reais).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL === 'false' ? undefined : { rejectUnauthorized: env.DATABASE_SSL === 'true' },
  max: 10,
});

export type Db = pg.Pool | pg.PoolClient;

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

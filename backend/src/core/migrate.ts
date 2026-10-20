import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

// Migrations SQL puras, versionadas por nome de arquivo, cada uma em transação.
// Lock advisory evita duas instâncias migrando ao mesmo tempo (deploy com 2 réplicas).
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('select pg_advisory_lock(727001)');
    await c.query(`create table if not exists schema_migrations (
      nome text primary key, aplicada_em timestamptz not null default now())`);
    const { rows } = await c.query<{ nome: string }>('select nome from schema_migrations');
    const feitas = new Set(rows.map((r) => r.nome));
    const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of arquivos) {
      if (feitas.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      await c.query('begin');
      try {
        await c.query(sql);
        await c.query('insert into schema_migrations (nome) values ($1)', [f]);
        await c.query('commit');
        console.log(`migration aplicada: ${f}`);
      } catch (e) {
        await c.query('rollback');
        throw new Error(`Falha na migration ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.query('select pg_advisory_unlock(727001)').catch(() => {});
    c.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

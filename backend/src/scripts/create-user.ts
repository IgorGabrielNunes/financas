// Uso: npm run user:create -- email@x.com "Nome" "senha-forte"
// Não existe cadastro público: o app é pessoal. Este script cria o usuário e as categorias padrão.
import { tx, pool } from '../db.js';
import { hashSenha } from '../auth.js';
import { migrate } from '../migrate.js';

const [email, nome, senha] = process.argv.slice(2);
if (!email || !nome || !senha || senha.length < 10) {
  console.error('Uso: user:create <email> <nome> <senha (mín. 10 caracteres)>');
  process.exit(1);
}

const CATEGORIAS: [string, 'receita' | 'despesa', string][] = [
  ['Salário', 'receita', '#15803d'], ['Extra', 'receita', '#0d9488'],
  ['Moradia', 'despesa', '#b45309'], ['Contas da casa', 'despesa', '#ca8a04'], ['Mercado', 'despesa', '#16a34a'],
  ['Alimentação fora', 'despesa', '#ea580c'], ['Transporte', 'despesa', '#2563eb'], ['Saúde', 'despesa', '#dc2626'],
  ['Educação', 'despesa', '#7c3aed'], ['Lazer', 'despesa', '#db2777'], ['Assinaturas', 'despesa', '#4f46e5'],
  ['Compras', 'despesa', '#0891b2'], ['Outros', 'despesa', '#64748b'],
];

await migrate();
await tx(async (c) => {
  const u = await c.query(
    'insert into usuarios (email, nome, senha_hash) values ($1,$2,$3) returning id',
    [email.toLowerCase(), nome, await hashSenha(senha)],
  );
  const id = u.rows[0].id;
  for (const [n, t, cor] of CATEGORIAS) {
    await c.query('insert into categorias (user_id, nome, tipo, cor) values ($1,$2,$3,$4)', [id, n, t, cor]);
  }
  console.log(`Usuário criado: ${email} (${id})`);
});
await pool.end();

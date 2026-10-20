// Uso: npm run user:create -- email@x.com "Nome" "senha-forte"
// Cria uma CASA nova com o usuário como administrador e as categorias padrão.
// Não existe cadastro público: membros da casa (ex.: cônjuge) são criados pelo admin em Conta → Usuários.
import { tx, pool } from '../core/db.js';
import { hashSenha } from '../core/auth.js';
import { migrate } from '../core/migrate.js';

const [email, nome, senha] = process.argv.slice(2);
if (!email || !nome || !senha || senha.length < 10 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Uso: user:create <email> <nome> <senha (mín. 10 caracteres)>');
  console.error('Exemplo: npm run user:create -- voce@email.com "Seu Nome" "senha-forte-aqui"');
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
  const casa = (await c.query<{ id: string }>('insert into casas (nome) values ($1) returning id', [`Casa de ${nome.split(' ')[0]}`])).rows[0].id;
  const pessoa = (await c.query<{ id: string }>('insert into pessoas (casa_id, nome) values ($1, $2) returning id', [casa, nome.split(' ')[0]])).rows[0].id;
  const u = await c.query(
    `insert into usuarios (casa_id, email, nome, senha_hash, papel, pessoa_id) values ($1,$2,$3,$4,'admin',$5) returning id`,
    [casa, email.toLowerCase(), nome, await hashSenha(senha), pessoa],
  );
  for (const [n, t, cor] of CATEGORIAS) {
    await c.query('insert into categorias (casa_id, nome, tipo, cor) values ($1,$2,$3,$4)', [casa, n, t, cor]);
  }
  console.log(`Usuário criado: ${email} (${u.rows[0].id}), administrador da casa ${casa}`);
});
await pool.end();

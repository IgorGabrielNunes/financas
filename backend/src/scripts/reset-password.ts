// Uso: npm run user:senha -- email@x.com "nova-senha-forte"
// Redefine a senha de um usuário existente (não há "esqueci a senha" no app: ele é pessoal).
import { pool } from '../core/db.js';
import { hashSenha } from '../core/auth.js';

const [email, senha] = process.argv.slice(2);
if (!email || !senha || senha.length < 10) {
  console.error('Uso: user:senha <email> <nova senha (mín. 10 caracteres)>');
  process.exit(1);
}
const r = await pool.query('update usuarios set senha_hash = $2 where email = $1 returning email', [email.trim().toLowerCase(), await hashSenha(senha)]);
if (!r.rowCount) {
  const todos = await pool.query<{ email: string }>('select email from usuarios order by created_at');
  console.error(`Nenhum usuário com o e-mail ${email}. Usuários neste banco: ${todos.rows.map((x) => x.email).join(', ') || '(nenhum — rode user:create)'}`);
  process.exitCode = 1;
} else {
  console.log(`Senha redefinida para ${r.rows[0].email}`);
}
await pool.end();

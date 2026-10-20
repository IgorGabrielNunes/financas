import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, n: number) => Promise<Buffer>;

// scrypt nativo do Node: sem dependência nativa (bcrypt) para quebrar no build do Render.
export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(senha, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function conferirSenha(senha: string, armazenado: string): Promise<boolean> {
  const [alg, s, h] = armazenado.split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const esperado = Buffer.from(h, 'base64');
  const obtido = await scrypt(senha, Buffer.from(s, 'base64'), esperado.length);
  return timingSafeEqual(esperado, obtido);
}

export type Papel = 'admin' | 'membro';
type Usuario = { sub: string; email: string; casa: string; papel: Papel };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; casa: string; papel: Papel };
    user: Usuario;
  }
}

// O token vale 30 dias, mas desativar um usuário ou trocar o papel precisa valer na hora.
// Conferimos o usuário no banco a cada requisição, com cache curto (60 s) para não pesar.
const cache = new Map<string, { ate: number; ativo: boolean; casa: string; papel: Papel }>();
export function esquecerUsuario(id: string) { cache.delete(id); }

export async function autenticar(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ erro: 'Não autenticado' });
  }
  const u = req.user;
  if (!u?.casa) return reply.code(401).send({ erro: 'Sessão antiga. Entre de novo.' });
  let info = cache.get(u.sub);
  if (!info || info.ate < Date.now()) {
    const { pool } = await import('./db.js');
    const r = await pool.query<{ ativo: boolean; casa_id: string; papel: Papel }>(
      'select ativo, casa_id, papel from usuarios where id = $1', [u.sub]);
    const row = r.rows[0];
    info = { ate: Date.now() + 60_000, ativo: !!row?.ativo, casa: row?.casa_id ?? '', papel: row?.papel ?? 'membro' };
    cache.set(u.sub, info);
  }
  if (!info.ativo || info.casa !== u.casa) return reply.code(401).send({ erro: 'Acesso desativado' });
  u.papel = info.papel; // papel sempre o atual do banco, não o do token
}

export async function exigirAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (req.user?.papel !== 'admin') return reply.code(403).send({ erro: 'Só o administrador da casa pode fazer isso' });
}

/** Usuário logado (módulos pessoais: tarefas, notas...). */
export const uid = (req: FastifyRequest) => req.user.sub;
/** Casa do usuário logado (dados compartilhados: finanças). */
export const cid = (req: FastifyRequest) => req.user.casa;

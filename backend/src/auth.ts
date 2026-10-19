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

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

export async function autenticar(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ erro: 'Não autenticado' });
  }
}

export const uid = (req: FastifyRequest) => req.user.sub;

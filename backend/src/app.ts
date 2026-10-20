import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { env } from './core/env.js';
import { pool } from './core/db.js';
import { HttpError } from './core/errors.js';
import { autenticar, conferirSenha } from './core/auth.js';
import { parse } from './core/validacao.js';
import { MODULOS } from './modulos/index.js';
import { comprovantesRoutes } from './modulos/financas/rotas/comprovantes.js';
import { avisosPublico } from './modulos/avisos/rotas.js';

// O navegador manda só protocolo + domínio no Origin. Normalizamos o que vier na variável
// ("https://x.app/", "https://x.app/login", com espaços) para não quebrar o login por um detalhe de digitação.
export function normalizarOrigens(valor: string): string[] {
  return valor.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    try { return new URL(s).origin; } catch { return s.replace(/\/+$/, ''); }
  });
}
const origensPermitidas = normalizarOrigens(env.CORS_ORIGIN);

export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization'] },
    trustProxy: true, // Render fica atrás de proxy: necessário para o rate-limit enxergar o IP real
  });

  await app.register(cors, {
    origin: origensPermitidas,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '30d' } });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ erro: err.message });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ erro: 'Arquivo maior que 10 MB' });
    if (err.statusCode === 429) return reply.code(429).send({ erro: 'Muitas tentativas. Aguarde um minuto.' });
    if (err.validation || err.statusCode === 400) return reply.code(400).send({ erro: err.message });
    // violações de constraint que escaparam da validação viram 409 legível, não 500
    if (err.code === '23514' || err.code === '23503' || err.code === '23505') {
      req.log.warn({ err }, 'constraint');
      return reply.code(409).send({ erro: 'Operação viola uma regra de integridade dos dados' });
    }
    req.log.error({ err }, 'erro não tratado');
    return reply.code(500).send({ erro: 'Erro interno' });
  });

  app.log.info({ cors: origensPermitidas }, 'origens liberadas no CORS');

  app.get('/health', async () => {
    await pool.query('select 1');
    return { ok: true };
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ email: z.string().trim().toLowerCase(), senha: z.string().min(1) }), req.body);
    const r = await pool.query(
      'select id, email, nome, senha_hash, casa_id, papel, ativo, trocar_senha from usuarios where email = $1', [b.email]);
    const u = r.rows[0];
    // mesma mensagem para e-mail inexistente, senha errada ou usuário desativado: não revela quem existe
    if (!u || !u.ativo || !(await conferirSenha(b.senha, u.senha_hash))) {
      return reply.code(401).send({ erro: 'E-mail ou senha inválidos' });
    }
    const token = app.jwt.sign({ sub: u.id, email: u.email, casa: u.casa_id, papel: u.papel });
    return { token, usuario: { id: u.id, email: u.email, nome: u.nome, papel: u.papel, trocar_senha: u.trocar_senha } };
  });

  // comprovantes tem uma rota pública assinada; o restante dele se autentica internamente
  await app.register(comprovantesRoutes);
  // webhook do Telegram e gatilho externo dos avisos: autenticação própria (segredo no cabeçalho)
  await app.register(avisosPublico);

  await app.register(async (priv) => {
    priv.addHook('onRequest', autenticar);
    for (const m of MODULOS) await priv.register(m);
  });

  return app;
}


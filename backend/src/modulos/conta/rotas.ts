import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../../core/db.js';
import { cid, conferirSenha, esquecerUsuario, exigirAdmin, hashSenha, uid } from '../../core/auth.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { idOpt, paramId, parse } from '../../core/validacao.js';

const senhaForte = z.string().min(10, 'A senha precisa de pelo menos 10 caracteres').max(200);
const email = z.string().trim().toLowerCase().email('E-mail inválido').max(120);

const novoUsuario = z.object({
  nome: z.string().trim().min(1).max(60),
  email,
  senha: senhaForte,                 // temporária: o usuário troca no primeiro acesso
  papel: z.enum(['admin', 'membro']).default('membro'),
  pessoa_id: idOpt,                  // perfil existente em Pessoas
  criar_pessoa: z.boolean().default(true), // sem perfil: cria um com o primeiro nome
});

const edicaoUsuario = z.object({
  nome: z.string().trim().min(1).max(60),
  papel: z.enum(['admin', 'membro']),
  pessoa_id: idOpt,
  ativo: z.boolean(),
});

const SELECT_USUARIO = `
  select u.id, u.nome, u.email, u.papel, u.ativo, u.trocar_senha, u.pessoa_id, u.created_at,
         p.nome as pessoa_nome, p.cor as pessoa_cor
    from usuarios u left join pessoas p on p.id = u.pessoa_id`;

async function garantirPessoaDaCasa(c: { query: typeof pool.query }, pessoaId: string | null | undefined, casa: string) {
  if (!pessoaId) return;
  const r = await c.query('select 1 from pessoas where id = $1 and casa_id = $2', [pessoaId, casa]);
  if (!r.rowCount) throw notFound('Pessoa');
}

/** Impede a casa de ficar sem nenhum administrador ativo. */
async function garantirOutroAdmin(c: { query: typeof pool.query }, casa: string, exceto: string) {
  const r = await c.query(
    `select 1 from usuarios where casa_id = $1 and id <> $2 and papel = 'admin' and ativo limit 1`, [casa, exceto]);
  if (!r.rowCount) throw conflict('A casa precisa de pelo menos um administrador ativo');
}

export async function conta(app: FastifyInstance) {
  // ------------------------------------------------------------ minha conta
  app.get('/conta/eu', async (req) => {
    const u = (await pool.query(`${SELECT_USUARIO} where u.id = $1`, [uid(req)])).rows[0];
    const casa = (await pool.query('select id, nome from casas where id = $1', [cid(req)])).rows[0];
    return { ...u, casa };
  });

  app.put('/conta/senha', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ atual: z.string().min(1), nova: senhaForte }), req.body);
    const r = await pool.query<{ senha_hash: string }>('select senha_hash from usuarios where id = $1', [uid(req)]);
    if (!r.rows[0] || !(await conferirSenha(b.atual, r.rows[0].senha_hash))) throw badRequest('Senha atual incorreta');
    if (b.atual === b.nova) throw badRequest('A nova senha precisa ser diferente da atual');
    await pool.query('update usuarios set senha_hash = $2, trocar_senha = false where id = $1', [uid(req), await hashSenha(b.nova)]);
    return { ok: true };
  });

  app.put('/conta/casa', { onRequest: exigirAdmin }, async (req) => {
    const b = parse(z.object({ nome: z.string().trim().min(1).max(60) }), req.body);
    await pool.query('update casas set nome = $2 where id = $1', [cid(req), b.nome]);
    return { ok: true };
  });

  /** Membros ativos da casa (nome e id) — para escolher responsável de tarefa. Visível a todos os membros. */
  app.get('/conta/membros', async (req) =>
    (await pool.query(`select id, nome from usuarios where casa_id = $1 and ativo order by nome`, [cid(req)])).rows);

  // ---------------------------------------------------- usuários (só admin)
  app.get('/conta/usuarios', { onRequest: exigirAdmin }, async (req) =>
    (await pool.query(`${SELECT_USUARIO} where u.casa_id = $1 order by u.created_at`, [cid(req)])).rows);

  app.post('/conta/usuarios', { onRequest: exigirAdmin }, async (req, reply) => {
    const b = parse(novoUsuario, req.body);
    const casa = cid(req);
    const criado = await tx(async (c) => {
      await garantirPessoaDaCasa(c, b.pessoa_id, casa);
      let pessoaId = b.pessoa_id ?? null;
      if (!pessoaId && b.criar_pessoa) {
        const nomePerfil = b.nome.split(' ')[0];
        const existente = await c.query<{ id: string }>(
          'select id from pessoas where casa_id = $1 and lower(nome) = lower($2)', [casa, nomePerfil]);
        pessoaId = existente.rows[0]?.id
          ?? (await c.query<{ id: string }>('insert into pessoas (casa_id, nome) values ($1, $2) returning id', [casa, nomePerfil])).rows[0].id;
      }
      if (pessoaId) {
        const ocupado = await c.query('select 1 from usuarios where pessoa_id = $1', [pessoaId]);
        if (ocupado.rowCount) throw conflict('Esse perfil já está ligado a outro usuário');
      }
      const r = await c.query<{ id: string }>(
        `insert into usuarios (casa_id, nome, email, senha_hash, papel, pessoa_id, trocar_senha)
         values ($1,$2,$3,$4,$5,$6,true) returning id`,
        [casa, b.nome, b.email, await hashSenha(b.senha), b.papel, pessoaId],
      ).catch((e) => { if (e.code === '23505') throw conflict('Já existe um usuário com esse e-mail'); throw e; });
      return r.rows[0].id;
    });
    return reply.code(201).send((await pool.query(`${SELECT_USUARIO} where u.id = $1`, [criado])).rows[0]);
  });

  app.put('/conta/usuarios/:id', { onRequest: exigirAdmin }, async (req) => {
    const alvo = paramId(req);
    const b = parse(edicaoUsuario, req.body);
    const casa = cid(req);
    await tx(async (c) => {
      const atual = (await c.query('select papel, ativo from usuarios where id = $1 and casa_id = $2', [alvo, casa])).rows[0];
      if (!atual) throw notFound('Usuário');
      const perdeAdmin = atual.papel === 'admin' && atual.ativo && (b.papel !== 'admin' || !b.ativo);
      if (perdeAdmin) await garantirOutroAdmin(c, casa, alvo);
      await garantirPessoaDaCasa(c, b.pessoa_id, casa);
      if (b.pessoa_id) {
        const ocupado = await c.query('select 1 from usuarios where pessoa_id = $1 and id <> $2', [b.pessoa_id, alvo]);
        if (ocupado.rowCount) throw conflict('Esse perfil já está ligado a outro usuário');
      }
      await c.query('update usuarios set nome=$2, papel=$3, pessoa_id=$4, ativo=$5 where id=$1',
        [alvo, b.nome, b.papel, b.pessoa_id ?? null, b.ativo]);
    });
    esquecerUsuario(alvo); // desativação/papel valem na próxima requisição, sem esperar o cache
    return (await pool.query(`${SELECT_USUARIO} where u.id = $1`, [alvo])).rows[0];
  });

  /** Admin define uma senha temporária (o usuário é obrigado a trocar no próximo acesso). */
  app.put('/conta/usuarios/:id/senha', { onRequest: exigirAdmin }, async (req) => {
    const alvo = paramId(req);
    const b = parse(z.object({ senha: senhaForte }), req.body);
    const r = await pool.query('update usuarios set senha_hash = $3, trocar_senha = true where id = $1 and casa_id = $2',
      [alvo, cid(req), await hashSenha(b.senha)]);
    if (!r.rowCount) throw notFound('Usuário');
    return { ok: true };
  });
}

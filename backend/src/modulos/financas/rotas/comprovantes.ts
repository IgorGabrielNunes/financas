import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { pool } from '../../../core/db.js';
import { autenticar, cid } from '../../../core/auth.js';
import { badRequest, notFound } from '../../../core/errors.js';
import { localStorageDriver, storage, validarAssinaturaLocal } from '../../../core/storage.js';
import { id, parse } from './schemas.js';

const MIMES = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/heic', 'heic'], ['application/pdf', 'pdf'],
]);

// Confere a assinatura real do arquivo — não confia no Content-Type do cliente.
function mimePorMagicBytes(b: Buffer): string | null {
  if (b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (b.subarray(4, 8).toString() === 'ftyp' && /hei[cx]|mif1/.test(b.subarray(8, 12).toString())) return 'image/heic';
  return null;
}

export async function comprovantesRoutes(app: FastifyInstance) {
  // Rota pública protegida por URL assinada (HMAC + expiração) — só para o driver local.
  app.get('/comprovantes/:id/arquivo', async (req, reply) => {
    const { exp, sig } = req.query as { exp?: string; sig?: string };
    const comprovanteId = parse(id, (req.params as any).id);
    if (!localStorageDriver || !sig || !validarAssinaturaLocal(comprovanteId, Number(exp), sig)) {
      return reply.code(403).send({ erro: 'Link inválido ou expirado' });
    }
    const r = await pool.query('select storage_key, mime, nome_original from comprovantes where id = $1', [comprovanteId]);
    if (!r.rowCount) throw notFound('Comprovante');
    const { storage_key, mime, nome_original } = r.rows[0];
    return reply
      .header('Content-Type', mime)
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(nome_original)}"`)
      .header('Cache-Control', 'private, max-age=300')
      .send(await localStorageDriver.read(storage_key));
  });

  app.register(async (priv) => {
    priv.addHook('onRequest', autenticar);

    priv.get('/lancamentos/:id/comprovantes', async (req) => {
      const r = await pool.query(
        `select cp.id, cp.nome_original, cp.mime, cp.tamanho_bytes, cp.created_at
           from comprovantes cp where cp.lancamento_id = $1 and cp.casa_id = $2 order by cp.created_at`,
        [parse(id, (req.params as any).id), cid(req)],
      );
      return r.rows;
    });

    priv.post('/lancamentos/:id/comprovantes', async (req, reply) => {
      const lancId = parse(id, (req.params as any).id);
      const dono = await pool.query('select 1 from lancamentos where id = $1 and casa_id = $2', [lancId, cid(req)]);
      if (!dono.rowCount) throw notFound('Lançamento');

      const file = await req.file();
      if (!file) throw badRequest('Envie o arquivo no campo "arquivo"');
      const buf = await file.toBuffer(); // limite de tamanho aplicado no registro do multipart
      const mime = mimePorMagicBytes(buf);
      if (!mime || !MIMES.has(mime)) throw badRequest('Formato não suportado (use JPG, PNG, WEBP, HEIC ou PDF)');

      const key = `${cid(req)}/${lancId}/${randomUUID()}.${MIMES.get(mime)}`;
      await storage.put(key, buf, mime);
      try {
        const r = await pool.query(
          `insert into comprovantes (casa_id, lancamento_id, storage_key, nome_original, mime, tamanho_bytes)
           values ($1,$2,$3,$4,$5,$6) returning id, nome_original, mime, tamanho_bytes, created_at`,
          [cid(req), lancId, key, file.filename.slice(0, 200), mime, buf.length],
        );
        return reply.code(201).send(r.rows[0]);
      } catch (e) {
        await storage.remove(key); // não deixa arquivo órfão se o insert falhar
        throw e;
      }
    });

    priv.get('/comprovantes/:id/url', async (req) => {
      const comprovanteId = parse(id, (req.params as any).id);
      const r = await pool.query('select storage_key, nome_original from comprovantes where id = $1 and casa_id = $2', [comprovanteId, cid(req)]);
      if (!r.rowCount) throw notFound('Comprovante');
      return { url: await storage.signedUrl(r.rows[0].storage_key, comprovanteId, r.rows[0].nome_original) };
    });

    priv.delete('/comprovantes/:id', async (req, reply) => {
      const r = await pool.query('delete from comprovantes where id = $1 and casa_id = $2 returning storage_key', [
        parse(id, (req.params as any).id), cid(req),
      ]);
      if (!r.rowCount) throw notFound('Comprovante');
      await storage.remove(r.rows[0].storage_key);
      return reply.code(204).send();
    });
  });
}

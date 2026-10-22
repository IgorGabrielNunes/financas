import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '../../../core/db.js';
import { cid, uid } from '../../../core/auth.js';
import { data, parse, paramId } from '../../../core/validacao.js';
import { confirmarImportacao, desfazerImportacao, listarImportacoes, previaImportacao } from '../importacao/servico.js';

const vencimento = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês da fatura no formato AAAA-MM');
const parcela = z.object({ atual: z.number().int().min(1).max(48), total: z.number().int().min(2).max(48) })
  .refine((p) => p.atual <= p.total, 'Parcela atual maior que o total').nullable();
// o arquivo vem como texto (o navegador decodifica UTF-8 ou Windows-1252, comum em CSV de banco)
const LIMITE = 3 * 1024 * 1024;

export async function importacaoRoutes(app: FastifyInstance) {
  app.post('/importacoes/previa', { bodyLimit: LIMITE, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({
      cartao_id: z.uuid(), vencimento, conteudo: z.string().min(1, 'Arquivo vazio').max(2_000_000, 'Arquivo grande demais (máx. 2 MB)'),
      nome: z.string().max(200).optional(),
    }), req.body);
    return previaImportacao(cid(req), b);
  });

  app.post('/importacoes', { bodyLimit: LIMITE }, async (req, reply) => {
    const b = parse(z.object({
      cartao_id: z.uuid(), vencimento, arquivo_nome: z.string().max(200).nullable().optional(), formato: z.enum(['csv', 'ofx', 'json']),
      itens: z.array(z.object({
        data, descricao: z.string().trim().min(1).max(200), valor_centavos: z.number().int().positive().max(100_000_000),
        parcela, categoria_id: z.uuid().nullable(),
      })).min(1, 'Nenhum item selecionado').max(1000),
    }), req.body);
    return reply.code(201).send(await confirmarImportacao(cid(req), uid(req), b));
  });

  app.get('/importacoes', async (req) => {
    const q = parse(z.object({ cartao_id: z.uuid().optional() }), req.query);
    return tx((c) => listarImportacoes(c, cid(req), q.cartao_id));
  });

  app.delete('/importacoes/:id', async (req) => desfazerImportacao(cid(req), paramId(req)));
}

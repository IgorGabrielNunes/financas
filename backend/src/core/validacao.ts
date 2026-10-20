import { z } from 'zod';
import { badRequest } from './errors.js';

export const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato YYYY-MM-DD');
export const dataOpt = data.nullable().optional();
export const centavos = z.number().int('Valor em centavos (inteiro)');
export const id = z.uuid();
export const idOpt = z.uuid().nullable().optional();
export const cor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const texto = (max: number) => z.string().trim().max(max);
export const textoOpt = (max: number) => z.string().trim().max(max).nullable().optional();
export const url = z.string().trim().max(500).url('URL inválida').nullable().optional().or(z.literal('').transform(() => null));

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const i = r.error.issues[0];
    throw badRequest(`${i.path.join('.') || 'body'}: ${i.message}`);
  }
  return r.data;
}

/** Lê `:id` dos params validado como UUID. */
export const paramId = (req: { params: unknown }, nome = 'id') => parse(id, (req.params as Record<string, unknown>)[nome]);

import { z } from 'zod';
import { centavos, cor, data, id, idOpt, parse } from '../../../core/validacao.js';
export { centavos, cor, data, id, idOpt, parse };

export const meio = z.enum(['debito', 'credito', 'pix', 'dinheiro', 'boleto', 'transferencia']);

export const contaBody = z.object({
  nome: z.string().trim().min(1).max(60),
  tipo: z.enum(['corrente', 'poupanca', 'carteira', 'investimento']),
  saldo_inicial_centavos: centavos.default(0),
  cor: cor.optional(),
  ativa: z.boolean().optional(),
  pessoa_id: idOpt,
  cartao_debito: z.boolean().default(false),
});

export const cartaoBody = z.object({
  nome: z.string().trim().min(1).max(60),
  bandeira: z.string().max(30).nullable().optional(),
  final: z.string().regex(/^\d{4}$/, 'Somente os 4 últimos dígitos').nullable().optional(),
  limite_centavos: centavos.min(0),
  dia_fechamento: z.number().int().min(1).max(31),
  dia_vencimento: z.number().int().min(1).max(31),
  conta_pagamento_id: idOpt,
  cor: cor.optional(),
  ativo: z.boolean().optional(),
  pessoa_id: idOpt,
});

export const categoriaBody = z.object({
  nome: z.string().trim().min(1).max(40),
  tipo: z.enum(['receita', 'despesa']),
  cor: cor.optional(),
});

export const lancamentoBody = z.object({
  tipo: z.enum(['receita', 'despesa']),
  descricao: z.string().trim().min(1).max(120),
  valor_centavos: centavos.positive(),
  data,
  meio,
  conta_id: idOpt,
  cartao_id: idOpt,
  categoria_id: idOpt,
  parcelas_total: z.number().int().min(1).max(48).default(1),
  parcelas_pagas_antes: z.number().int().min(0).max(47).default(0),
  status: z.enum(['previsto', 'realizado']).default('realizado'),
  observacao: z.string().max(500).nullable().optional(),
});
// PATCH sem defaults: campo ausente = "não mexe". (Com .partial() os defaults do body seriam aplicados
// e um PATCH só de descrição "resetaria" parcelas_total/status.)
export const lancamentoPatch = z.object({
  tipo: z.enum(['receita', 'despesa']).optional(),
  descricao: z.string().trim().min(1).max(120).optional(),
  valor_centavos: centavos.positive().optional(),
  data: data.optional(),
  meio: meio.optional(),
  conta_id: idOpt,
  cartao_id: idOpt,
  categoria_id: idOpt,
  parcelas_total: z.number().int().min(1).max(48).optional(),
  parcelas_pagas_antes: z.number().int().min(0).max(47).optional(),
  status: z.enum(['previsto', 'realizado']).optional(),
  observacao: z.string().max(500).nullable().optional(),
});

export const recorrenciaBody = z.object({
  descricao: z.string().trim().min(1).max(120),
  tipo: z.enum(['receita', 'despesa']),
  valor_previsto_centavos: centavos.positive(),
  dia_mes: z.number().int().min(1).max(31),
  meio,
  categoria_id: idOpt,
  conta_id: idOpt,
  cartao_id: idOpt,
  inicio: data,
  fim: data.nullable().optional(),
  ativa: z.boolean().optional(),
});

export const pagamentoBody = z.object({
  valor_pago_centavos: centavos.min(0),
  pago_em: data.nullable(),
  conta_pagamento_id: idOpt,
});


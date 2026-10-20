import type { FastifyInstance } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../../core/db.js';
import { cid, exigirAdmin, uid } from '../../core/auth.js';
import { env } from '../../core/env.js';
import { badRequest } from '../../core/errors.js';
import { parse } from '../../core/validacao.js';
import { avisosCasa, avisosDevidos, agoraSP } from './dominio.js';
import { coletarCasa, coletarDia, type Consultar } from './coleta.js';
import { dispararAvisos } from './disparar.js';
import { destinoDe, enviarMensagem } from './provedor.js';

const hora = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Hora no formato HH:MM');
const consultar: Consultar = async (sql, params) => (await pool.query(sql, params)).rows;
const envio = () => ({
  telegramToken: env.TELEGRAM_BOT_TOKEN,
  email: { brevoKey: env.BREVO_API_KEY, remetente: env.EMAIL_REMETENTE, remetenteNome: env.EMAIL_REMETENTE_NOME, appUrl: env.APP_URL?.replace(/\/+$/, '') },
});
const emailDisponivel = () => !!(env.BREVO_API_KEY && env.EMAIL_REMETENTE);

const configBody = z.object({
  ativo: z.boolean(),
  canal: z.enum(['callmebot', 'telegram', 'grupo', 'email']),
  email_destino: z.string().trim().toLowerCase().email('E-mail inválido').max(120).nullable().optional(),
  telefone: z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Telefone com DDI e DDD, só números (ex.: +5555999998888)').nullable().optional(),
  apikey: z.string().trim().min(3).max(64).optional(),     // ausente = mantém a atual
  discreto: z.boolean().default(false),
  resumo_hora: hora.nullable().optional(),
  antecedencia_min: z.number().int().min(5).max(1440).default(60),
  avisar_treino: z.boolean().default(true), avisar_remedios: z.boolean().default(true),
  avisar_consultas: z.boolean().default(true), avisar_entrevistas: z.boolean().default(true),
  avisar_refeicoes: z.boolean().default(false),
  silencio_inicio: hora.nullable().optional(), silencio_fim: hora.nullable().optional(),
});

const casaBody = z.object({
  ativo: z.boolean(), resumo_hora: hora, avisar_tarefas: z.boolean(), avisar_contas: z.boolean(),
  dias_antes_contas: z.number().int().min(0).max(7), enviar_email: z.boolean().default(false),
});

/** A apikey nunca volta para o navegador: só se existe. */
async function lerConfig(userId: string) {
  const c = (await pool.query('select * from notif_config where user_id = $1', [userId])).rows[0];
  const base = c ?? { ativo: false, canal: 'callmebot', telefone: null, discreto: false, resumo_hora: '07:00', antecedencia_min: 60,
    avisar_treino: true, avisar_remedios: true, avisar_consultas: true, avisar_entrevistas: true, avisar_refeicoes: false,
    silencio_inicio: '22:00', silencio_fim: '07:00', apikey: null, telegram_chat_id: null };
  const { apikey, telegram_chat_id, ...resto } = base;
  const login = (await pool.query('select email from usuarios where id = $1', [userId])).rows[0]?.email ?? null;
  const grupo = (await pool.query(
    `select g.telegram_chat_id is not null as ok from notif_casa g join usuarios u on u.casa_id = g.casa_id where u.id = $1`, [userId])).rows[0];
  return { ...resto, tem_apikey: !!apikey, telegram_vinculado: !!telegram_chat_id, grupo_vinculado: !!grupo?.ok,
    email_login: login, email_disponivel: emailDisponivel(),
    telegram_disponivel: !!env.TELEGRAM_BOT_TOKEN, telegram_robo: env.TELEGRAM_BOT_USERNAME ?? null };
}

/** Prévia: simula o dia de 5 em 5 minutos e lista cada aviso no horário em que sairia. */
function simularDia<T extends { chave: string; hora: string; texto: string; tipo: string }>(calc: (agora: string) => T[]) {
  const vistos = new Map<string, T & { sai_as: string }>();
  for (let m = 0; m < 24 * 60; m += 5) {
    const agora = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    for (const a of calc(agora)) if (!vistos.has(a.chave)) vistos.set(a.chave, { ...a, sai_as: agora });
  }
  return [...vistos.values()].sort((a, b) => a.sai_as.localeCompare(b.sai_as));
}

function iguais(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Rotas autenticadas (dentro do hook `autenticar`). */
export async function avisos(app: FastifyInstance) {
  app.get('/avisos/config', async (req) => lerConfig(uid(req)));

  app.put('/avisos/config', async (req) => {
    const b = parse(configBody, req.body);
    if (b.silencio_inicio && !b.silencio_fim || !b.silencio_inicio && b.silencio_fim) throw badRequest('Informe início e fim do silêncio (ou nenhum)');
    const atual = (await pool.query('select apikey, telegram_chat_id from notif_config where user_id = $1', [uid(req)])).rows[0];
    const apikey = b.apikey ?? atual?.apikey ?? null;
    if (b.ativo && b.canal === 'callmebot' && (!b.telefone || !apikey)) throw badRequest('Para o WhatsApp, informe o telefone e a chave do CallMeBot');
    if (b.ativo && b.canal === 'telegram' && !atual?.telegram_chat_id) throw badRequest('Vincule o Telegram antes de ativar por ele');
    if (b.ativo && b.canal === 'email' && !emailDisponivel()) throw badRequest('O envio de e-mail ainda não foi configurado no servidor');
    if (b.ativo && b.canal === 'grupo') {
      const g = (await pool.query('select telegram_chat_id from notif_casa where casa_id = $1', [cid(req)])).rows[0];
      if (!g?.telegram_chat_id) throw badRequest('O grupo da casa ainda não foi vinculado (o administrador vincula em Avisos)');
    }
    await pool.query(
      `insert into notif_config (user_id, ativo, canal, telefone, apikey, discreto, resumo_hora, antecedencia_min,
         avisar_treino, avisar_remedios, avisar_consultas, avisar_entrevistas, avisar_refeicoes, silencio_inicio, silencio_fim, email_destino, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
       on conflict (user_id) do update set ativo=$2, canal=$3, telefone=$4, apikey=$5, discreto=$6, resumo_hora=$7, antecedencia_min=$8,
         avisar_treino=$9, avisar_remedios=$10, avisar_consultas=$11, avisar_entrevistas=$12, avisar_refeicoes=$13,
         silencio_inicio=$14, silencio_fim=$15, email_destino=$16, updated_at=now()`,
      [uid(req), b.ativo, b.canal, b.telefone ?? null, apikey, b.discreto, b.resumo_hora ?? null, b.antecedencia_min,
        b.avisar_treino, b.avisar_remedios, b.avisar_consultas, b.avisar_entrevistas, b.avisar_refeicoes, b.silencio_inicio ?? null, b.silencio_fim ?? null,
        b.email_destino ?? null]);
    return lerConfig(uid(req));
  });

  app.post('/avisos/teste', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const c = (await pool.query(
      `select c.*, u.nome, u.email as email_login, g.telegram_chat_id as grupo_chat_id from notif_config c join usuarios u on u.id = c.user_id
         left join notif_casa g on g.casa_id = u.casa_id where c.user_id = $1`, [uid(req)])).rows[0];
    const destino = c && destinoDe(c);
    if (!destino) throw badRequest('Salve a configuração do canal antes de testar');
    const quem = c.canal === 'grupo' ? `👤 *${c.nome.split(' ')[0]}*\n` : '';
    await enviarMensagem(destino, `${quem}✅ *Vida*: avisos funcionando por aqui!`, envio(), 'Vida: teste de avisos').catch((e) => { throw badRequest(e.message); });
    return { ok: true };
  });

  app.get('/avisos/previa', async (req) => {
    const u = (await pool.query('select id as user_id, nome, casa_id from usuarios where id = $1', [uid(req)])).rows[0];
    const cfg = { ...(await lerConfig(uid(req))), ...u };
    const { data } = agoraSP();
    const dados = await coletarDia(consultar, { user_id: u.user_id, casa_id: u.casa_id }, data);
    return { data, avisos: simularDia((agora) => avisosDevidos(cfg as any, dados, agora)) };
  });

  // --------------------------------------------------------------- casa
  app.get('/avisos/casa', async (req) => {
    const c = (await pool.query('select * from notif_casa where casa_id = $1', [cid(req)])).rows[0];
    const base = c ?? { ativo: false, resumo_hora: '08:00', avisar_tarefas: true, avisar_contas: true, dias_antes_contas: 1, telegram_chat_id: null, titulo_grupo: null, enviar_email: false };
    const { telegram_chat_id, ...resto } = base;
    const { data } = agoraSP();
    const dados = await coletarCasa(consultar, cid(req), data, base.dias_antes_contas);
    return {
      ...resto, grupo_vinculado: !!telegram_chat_id, telegram_disponivel: !!env.TELEGRAM_BOT_TOKEN, telegram_robo: env.TELEGRAM_BOT_USERNAME ?? null,
      email_disponivel: emailDisponivel(),
      previa: simularDia((agora) => avisosCasa({ casa_id: cid(req), ...base }, dados, agora)),
    };
  });

  app.put('/avisos/casa', { onRequest: exigirAdmin }, async (req) => {
    const b = parse(casaBody, req.body);
    const atual = (await pool.query('select telegram_chat_id from notif_casa where casa_id = $1', [cid(req)])).rows[0];
    if (b.enviar_email && !emailDisponivel()) throw badRequest('O envio de e-mail ainda não foi configurado no servidor');
    if (b.ativo && !atual?.telegram_chat_id && !b.enviar_email) throw badRequest('Vincule o grupo do Telegram ou ligue o envio por e-mail');
    await pool.query(
      `insert into notif_casa (casa_id, ativo, resumo_hora, avisar_tarefas, avisar_contas, dias_antes_contas, enviar_email, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       on conflict (casa_id) do update set ativo=$2, resumo_hora=$3, avisar_tarefas=$4, avisar_contas=$5, dias_antes_contas=$6,
         enviar_email=$7, updated_at=now()`,
      [cid(req), b.ativo, b.resumo_hora, b.avisar_tarefas, b.avisar_contas, b.dias_antes_contas, b.enviar_email]);
    return { ok: true };
  });

  app.post('/avisos/casa/teste', { onRequest: exigirAdmin, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const c = (await pool.query('select telegram_chat_id, enviar_email from notif_casa where casa_id = $1', [cid(req)])).rows[0];
    if (!c?.telegram_chat_id && !c?.enviar_email) throw badRequest('Vincule o grupo do Telegram ou ligue o envio por e-mail primeiro');
    try {
      if (c.telegram_chat_id) await enviarMensagem({ canal: 'telegram', chat_id: c.telegram_chat_id }, '✅ *Vida*: o grupo da casa vai receber os avisos aqui.', envio());
      if (c.enviar_email) {
        const para = (await pool.query('select email, nome from usuarios where casa_id = $1 and ativo', [cid(req)])).rows;
        await enviarMensagem({ canal: 'email', para }, '✅ *Vida*: o resumo da casa vai chegar por este e-mail.', envio(), 'Vida: teste do resumo da casa');
      }
    } catch (e) { throw badRequest((e as Error).message); }
    return { ok: true };
  });

  // ------------------------------------------------------- vínculo Telegram
  /** Código de uso único (30 min). Pessoal: link t.me/robo?start=CODIGO. Grupo: "/vincular CODIGO" no grupo. */
  app.post('/avisos/telegram/codigo', async (req) => {
    const b = parse(z.object({ tipo: z.enum(['pessoal', 'casa']) }), req.body);
    if (!env.TELEGRAM_BOT_TOKEN) throw badRequest('O robô do Telegram ainda não foi configurado no servidor');
    if (b.tipo === 'casa' && req.user.papel !== 'admin') throw badRequest('Só o administrador vincula o grupo da casa');
    const codigo = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8).toUpperCase();
    await pool.query(`insert into notif_vinculos (codigo, user_id, casa_id, expira_em) values ($1,$2,$3, now() + interval '30 minutes')`,
      [codigo, b.tipo === 'pessoal' ? uid(req) : null, b.tipo === 'casa' ? cid(req) : null]);
    const robo = env.TELEGRAM_BOT_USERNAME;
    return {
      codigo,
      link: b.tipo === 'pessoal' && robo ? `https://t.me/${robo}?start=${codigo}` : null,
      link_grupo: b.tipo === 'casa' && robo ? `https://t.me/${robo}?startgroup=${codigo}` : null,
      comando: b.tipo === 'casa' ? `/vincular ${codigo}` : `/start ${codigo}`,
    };
  });

  app.delete('/avisos/telegram', async (req) => {
    await pool.query(`update notif_config set telegram_chat_id = null, ativo = case when canal = 'telegram' then false else ativo end where user_id = $1`, [uid(req)]);
    return { ok: true };
  });
}

/**
 * Rotas públicas (fora do `autenticar`):
 * - webhook do Telegram (autenticado pelo secret_token que o Telegram manda no cabeçalho);
 * - gatilho externo do disparo (Bearer AVISOS_TOKEN), alternativa ao Worker.
 */
export async function avisosPublico(app: FastifyInstance) {
  app.post('/telegram/webhook', async (req, reply) => {
    const segredo = req.headers['x-telegram-bot-api-secret-token'];
    if (!env.TELEGRAM_WEBHOOK_SECRET || typeof segredo !== 'string' || !iguais(segredo, env.TELEGRAM_WEBHOOK_SECRET)) {
      return reply.code(401).send({ erro: 'não autorizado' });
    }
    const upd = req.body as any;
    const msg = upd?.message;
    const texto: string = msg?.text ?? '';
    const chat = msg?.chat;
    // "/start ABC123", "/vincular ABC123" ou "/vincular@MeuRobo ABC123"
    const m = texto.match(/^\/(start|vincular)(?:@\w+)?\s+([A-Za-z0-9]{6,12})\s*$/);
    if (!chat || !m) return { ok: true }; // ignora o resto (sempre 200, senão o Telegram reenvia)
    const responder = (t: string) => enviarMensagem({ canal: 'telegram', chat_id: String(chat.id) }, t, envio()).catch(() => {});

    const v = (await pool.query('delete from notif_vinculos where codigo = $1 and expira_em > now() returning *', [m[2].toUpperCase()])).rows[0];
    if (!v) { await responder('Código inválido ou expirado. Gere um novo no Vida.'); return { ok: true }; }
    const grupo = chat.type === 'group' || chat.type === 'supergroup';
    if (v.user_id) {
      if (grupo) { await responder('Esse código é para chat pessoal: abra uma conversa privada comigo.'); return { ok: true }; }
      await pool.query(
        `insert into notif_config (user_id, canal, telegram_chat_id) values ($1, 'telegram', $2)
         on conflict (user_id) do update set telegram_chat_id = $2, updated_at = now()`, [v.user_id, String(chat.id)]);
      await responder('✅ Pronto! Seus avisos do *Vida* podem chegar por aqui. Escolha o Telegram como canal no app.');
    } else {
      if (!grupo) { await responder('Esse código é do grupo da casa: me adicione no grupo e mande o comando lá.'); return { ok: true }; }
      await pool.query(
        `insert into notif_casa (casa_id, telegram_chat_id, titulo_grupo, ativo) values ($1, $2, $3, true)
         on conflict (casa_id) do update set telegram_chat_id = $2, titulo_grupo = $3, ativo = true, updated_at = now()`,
        [v.casa_id, String(chat.id), chat.title ?? null]);
      await responder('✅ Grupo vinculado! O resumo da casa (tarefas e contas) vai chegar aqui.');
    }
    return { ok: true };
  });

  app.post('/interno/avisos/disparar', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    if (!env.AVISOS_TOKEN || !iguais(auth, `Bearer ${env.AVISOS_TOKEN}`)) return reply.code(401).send({ erro: 'não autorizado' });
    const r = await dispararAvisos(consultar, { envio: envio() });
    return { enviados: r.reduce((s, x) => s + x.enviados.length, 0), erros: r.flatMap((x) => x.erros) };
  });
}

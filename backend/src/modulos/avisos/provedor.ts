// Envio das mensagens. Canais:
// - callmebot: WhatsApp grátis, uso pessoal, SÓ para o número de quem cadastrou a chave (não manda para grupo);
// - telegram: robô oficial (grátis), serve para chat pessoal e para o grupo da casa;
// - email: Brevo (grátis até 300/dia, sem domínio próprio: basta verificar o e-mail remetente).
// Trocar/adicionar provedor = novo canal + um case aqui.

export type Destino =
  | { canal: 'callmebot'; telefone: string; apikey: string }
  | { canal: 'telegram'; chat_id: string }
  | { canal: 'email'; para: { email: string; nome: string }[] };

export type OpcoesEmail = { brevoKey?: string; remetente?: string; remetenteNome?: string; appUrl?: string };
export type OpcoesEnvio = { telegramToken?: string; email?: OpcoesEmail; fetch?: typeof fetch };

const escaparHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Os textos usam *negrito* do WhatsApp; no Telegram vira <b> (HTML exige escapar o resto). */
export const paraTelegramHtml = (s: string) => escaparHtml(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');

/** E-mail: o mesmo texto da mensagem, em HTML simples (escapado; *negrito* vira <b>). */
export function htmlEmail(texto: string, appUrl?: string) {
  const corpo = paraTelegramHtml(texto).replace(/\n/g, '<br>');
  const link = appUrl ? `<p style="margin:24px 0 0"><a href="${escaparHtml(appUrl)}" style="color:#0f4b3a;font-weight:600">Abrir o Vida</a>
    · <a href="${escaparHtml(appUrl)}/conta/avisos" style="color:#6b7280">configurar avisos</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f1;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;color:#1c1917;font-size:15px;line-height:1.6">
<div style="font-weight:800;color:#0f4b3a;margin-bottom:12px">Vida</div>${corpo}${link}</div></body></html>`;
}

export async function enviarMensagem(d: Destino, texto: string, o: OpcoesEnvio = {}, assunto = 'Vida'): Promise<void> {
  const f = o.fetch ?? fetch;
  if (d.canal === 'email') {
    const e = o.email;
    if (!e?.brevoKey || !e.remetente) throw new Error('E-mail não configurado no servidor (BREVO_API_KEY e EMAIL_REMETENTE)');
    if (!d.para.length) return;
    const r = await f('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': e.brevoKey },
      body: JSON.stringify({
        sender: { email: e.remetente, name: e.remetenteNome ?? 'Vida' },
        to: d.para.map((p) => ({ email: p.email, name: p.nome })),
        subject: assunto.slice(0, 150),
        htmlContent: htmlEmail(texto, e.appUrl),
        textContent: texto.replace(/\*([^*\n]+)\*/g, '$1'),
      }),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      throw new Error(`E-mail (Brevo) recusou (${r.status}): ${j.message ?? 'erro desconhecido'}`);
    }
    return;
  }
  if (d.canal === 'callmebot') {
    const url = new URL('https://api.callmebot.com/whatsapp.php');
    url.searchParams.set('phone', d.telefone.startsWith('+') ? d.telefone : `+${d.telefone}`);
    url.searchParams.set('text', texto.slice(0, 3500)); // URL longa demais é recusada
    url.searchParams.set('apikey', d.apikey);
    const r = await f(url, { signal: AbortSignal.timeout(15000) });
    const corpo = (await r.text()).slice(0, 2000);
    // o CallMeBot às vezes responde 200 com a mensagem de erro no HTML
    const pareceErro = /apikey is invalid|error|not valid|blocked|exceed/i.test(corpo) && !/message queued|sent/i.test(corpo);
    if (!r.ok || pareceErro) {
      // nunca incluir a URL no erro: ela carrega a apikey
      throw new Error(`WhatsApp (CallMeBot) recusou (${r.status}): ${corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}`);
    }
    return;
  }
  if (d.canal === 'telegram') {
    if (!o.telegramToken) throw new Error('Robô do Telegram não configurado (TELEGRAM_BOT_TOKEN)');
    const r = await f(`https://api.telegram.org/bot${o.telegramToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ chat_id: d.chat_id, text: paraTelegramHtml(texto.slice(0, 4000)), parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { description?: string };
      throw new Error(`Telegram recusou (${r.status}): ${j.description ?? 'erro desconhecido'}`);
    }
    return;
  }
  throw new Error(`Canal não suportado: ${(d as { canal: string }).canal}`);
}

/** Monta o destino a partir da configuração; null = configuração incompleta. */
export function destinoDe(c: {
  canal: string; telefone: string | null; apikey: string | null; telegram_chat_id: string | null; grupo_chat_id?: string | null;
  email_destino?: string | null; email_login?: string | null; nome?: string;
}): Destino | null {
  if (c.canal === 'callmebot') return c.telefone && c.apikey ? { canal: 'callmebot', telefone: c.telefone, apikey: c.apikey } : null;
  if (c.canal === 'telegram') return c.telegram_chat_id ? { canal: 'telegram', chat_id: c.telegram_chat_id } : null;
  // avisos pessoais no grupo da casa (o mesmo robô; a mensagem leva o nome de quem é o aviso)
  if (c.canal === 'grupo') return c.grupo_chat_id ? { canal: 'telegram', chat_id: c.grupo_chat_id } : null;
  if (c.canal === 'email') {
    const email = c.email_destino || c.email_login;
    return email ? { canal: 'email', para: [{ email, nome: c.nome ?? '' }] } : null;
  }
  return null;
}

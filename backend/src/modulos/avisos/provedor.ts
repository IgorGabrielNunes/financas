// Envio das mensagens. Canais:
// - callmebot: WhatsApp grátis, uso pessoal, SÓ para o número de quem cadastrou a chave (não manda para grupo);
// - telegram: robô oficial (grátis), serve para chat pessoal e para o grupo da casa.
// Trocar/adicionar provedor = novo canal + um case aqui.

export type Destino =
  | { canal: 'callmebot'; telefone: string; apikey: string }
  | { canal: 'telegram'; chat_id: string };

export type OpcoesEnvio = { telegramToken?: string; fetch?: typeof fetch };

const escaparHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Os textos usam *negrito* do WhatsApp; no Telegram vira <b> (HTML exige escapar o resto). */
export const paraTelegramHtml = (s: string) => escaparHtml(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');

export async function enviarMensagem(d: Destino, texto: string, o: OpcoesEnvio = {}): Promise<void> {
  const f = o.fetch ?? fetch;
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
export function destinoDe(c: { canal: string; telefone: string | null; apikey: string | null; telegram_chat_id: string | null }): Destino | null {
  if (c.canal === 'callmebot') return c.telefone && c.apikey ? { canal: 'callmebot', telefone: c.telefone, apikey: c.apikey } : null;
  if (c.canal === 'telegram') return c.telegram_chat_id ? { canal: 'telegram', chat_id: c.telegram_chat_id } : null;
  return null;
}

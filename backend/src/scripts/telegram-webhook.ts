// Registra o webhook do robô do Telegram apontando para a API (rodar uma vez, e de novo se mudar a URL).
// Uso: npm run telegram:webhook   (lê TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET e PUBLIC_API_URL do ambiente/.env)
import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN;
const segredo = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = (process.env.PUBLIC_API_URL ?? '').replace(/\/+$/, '');
if (!token || !segredo || !base.startsWith('https://')) {
  console.error('Defina TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (16+ caracteres) e PUBLIC_API_URL (https) antes.');
  process.exit(1);
}
const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: `${base}/telegram/webhook`, secret_token: segredo, allowed_updates: ['message'], drop_pending_updates: true }),
});
const j = (await r.json()) as { ok: boolean; description?: string };
console.log(j.ok ? `Webhook registrado: ${base}/telegram/webhook` : `Falhou: ${j.description}`);
process.exit(j.ok ? 0 : 1);

// Cron da Cloudflare → dispara os avisos. A regra é a MESMA da API (importada do backend):
// testada lá com Postgres real; aqui só troca o driver e a origem do "agora".
//
// Driver: Pool do Neon via WebSocket = UMA conexão (um subrequest) por execução. O modo HTTP faria
// um subrequest por consulta e estouraria o limite do plano grátis (50 por execução) com poucos usuários.
import { Pool } from '@neondatabase/serverless';
import { dispararAvisos } from '../../../backend/src/modulos/avisos/disparar.js';
import type { Consultar } from '../../../backend/src/modulos/avisos/coleta.js';

export interface Env {
  DATABASE_URL: string;
  TELEGRAM_BOT_TOKEN?: string;
}

export async function executar(env: Env, agora: Date) {
  // pool criado e fechado dentro da execução (Workers não reaproveitam sockets entre requisições)
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const consultar: Consultar = async (texto, params = []) => (await pool.query(texto, params)).rows;
  try {
    const r = await dispararAvisos(consultar, { agora, envio: { telegramToken: env.TELEGRAM_BOT_TOKEN } });
    const enviados = r.reduce((s, x) => s + x.enviados.length, 0);
    const erros = r.flatMap((x) => x.erros.map((e) => `${x.tipo}:${x.dono.slice(0, 8)} ${e}`));
    // aparece em Workers → vida-avisos → Logs (observability)
    console.log(JSON.stringify({ enviados, erros }));
    return { enviados, erros };
  } finally {
    await pool.end();
  }
}

export default {
  async scheduled(evento: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(executar(env, new Date(evento.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;

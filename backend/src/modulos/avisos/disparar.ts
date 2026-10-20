// Disparo dos avisos: coleta, calcula, deduplica e envia. Usado pelo Worker (cron) e pela API.
import { avisosCasa, avisosDevidos, agoraSP, type Aviso, type ConfigAvisos, type ConfigCasa } from './dominio.js';
import { coletarCasa, coletarDia, SELECT_CASAS, SELECT_CONFIG, type Consultar } from './coleta.js';
import { destinoDe, enviarMensagem, type Destino, type OpcoesEnvio } from './provedor.js';

export type Enviar = (destino: Destino, texto: string) => Promise<void>;
export type Resultado = { dono: string; tipo: 'pessoal' | 'casa'; enviados: string[]; erros: string[] };

/** Pior caso de um ciclo travado: o próximo não fica preso esperando. */
const MAX_AVISOS_POR_DONO = 20;

/**
 * Deduplica e envia. A chave é gravada ANTES do envio (`on conflict do nothing returning`):
 * duas execuções simultâneas não mandam duas vezes. Se o envio falhar, as chaves são apagadas
 * e o aviso volta no próximo ciclo (enquanto estiver na janela).
 */
async function entregar(q: Consultar, enviar: Enviar, dono: string, destino: Destino, avisos: Aviso[], r: Resultado) {
  const novos: Aviso[] = [];
  for (const a of avisos.slice(0, MAX_AVISOS_POR_DONO)) {
    const ok = await q('insert into notif_enviadas (dono, chave) values ($1, $2) on conflict do nothing returning chave', [dono, a.chave]);
    if (ok.length) novos.push(a);
  }
  if (!novos.length) return;
  // tudo que venceu no mesmo ciclo vai numa mensagem só (menos notificações, menos limite de API)
  const texto = novos
    .sort((x, y) => (x.tipo === 'resumo' ? -1 : y.tipo === 'resumo' ? 1 : x.hora.localeCompare(y.hora)))
    .map((a) => a.texto).join('\n\n');
  try {
    await enviar(destino, texto);
    r.enviados.push(...novos.map((a) => a.chave));
  } catch (e) {
    r.erros.push((e as Error).message.slice(0, 300));
    await q('delete from notif_enviadas where dono = $1 and chave = any($2)', [dono, novos.map((a) => a.chave)]);
  }
}

export async function dispararAvisos(q: Consultar, opts: { agora?: Date; enviar?: Enviar; envio?: OpcoesEnvio } = {}): Promise<Resultado[]> {
  const { data, hora } = agoraSP(opts.agora);
  const enviar: Enviar = opts.enviar ?? ((d, t) => enviarMensagem(d, t, opts.envio));
  const resultados: Resultado[] = [];

  // ------------------------------------------------------------ pessoais
  const configs = await q<ConfigAvisos & { casa_id: string; canal: string; telefone: string | null; apikey: string | null; telegram_chat_id: string | null }>(SELECT_CONFIG);
  for (const cfg of configs) {
    const destino = destinoDe(cfg);
    if (!destino) continue;
    const r: Resultado = { dono: cfg.user_id, tipo: 'pessoal', enviados: [], erros: [] };
    resultados.push(r);
    try {
      await entregar(q, enviar, cfg.user_id, destino, avisosDevidos(cfg, await coletarDia(q, cfg, data), hora), r);
    } catch (e) {
      r.erros.push((e as Error).message.slice(0, 300)); // um usuário com problema não derruba os outros
    }
  }

  // ---------------------------------------------------------- grupo da casa
  const casas = await q<ConfigCasa & { telegram_chat_id: string }>(SELECT_CASAS);
  for (const c of casas) {
    const r: Resultado = { dono: c.casa_id, tipo: 'casa', enviados: [], erros: [] };
    resultados.push(r);
    try {
      const avisos = avisosCasa(c, await coletarCasa(q, c.casa_id, data, c.dias_antes_contas), hora);
      await entregar(q, enviar, c.casa_id, { canal: 'telegram', chat_id: c.telegram_chat_id }, avisos, r);
    } catch (e) {
      r.erros.push((e as Error).message.slice(0, 300));
    }
  }

  // limpeza: chaves antigas não servem depois do dia
  await q(`delete from notif_enviadas where enviada_em < now() - interval '3 days'`);
  await q(`delete from notif_vinculos where expira_em < now()`);
  return resultados;
}

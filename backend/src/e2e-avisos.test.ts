// E2E de academia, dieta e avisos (Postgres real; envio de mensagens simulado).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// env é lido na importação: o robô do Telegram precisa existir antes de carregar o app
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'teste:token';
  process.env.TELEGRAM_BOT_USERNAME = 'VidaTesteBot';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'segredo-do-webhook-de-teste';
});

import { buildApp } from './app.js';
import { pool } from './core/db.js';
import { migrate } from './core/migrate.js';
import { hashSenha } from './core/auth.js';
import { hojeSP, somarDias } from './core/datas.js';
import { diaSemana } from './modulos/tarefas/dominio.js';
import { dispararAvisos } from './modulos/avisos/disparar.js';
import type { Consultar } from './modulos/avisos/coleta.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let casaId: string, igorId: string;
const hoje = hojeSP();
const sufixo = Date.now();
type Cliente = (method: string, url: string, payload?: unknown) => Promise<{ status: number; body: any }>;
let igor: Cliente, laura: Cliente;
const consultar: Consultar = async (sql, p) => (await pool.query(sql, p)).rows;
/** "agora" num horário de São Paulo de hoje */
const as = (hhmm: string) => new Date(`${hoje}T${hhmm}:00-03:00`);

async function cliente(email: string): Promise<Cliente> {
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha: 'senha-de-teste-123' } });
  const h = { authorization: `Bearer ${JSON.parse(login.body).token}` };
  return async (method, url, payload) => {
    const r = await app.inject({ method: method as any, url, payload: payload as any, headers: h });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await migrate();
  casaId = (await pool.query('insert into casas (nome) values ($1) returning id', ['Casa avisos'])).rows[0].id;
  const senha = await hashSenha('senha-de-teste-123');
  for (const [nome, papel] of [['Igor Gabriel', 'admin'], ['Laura', 'membro']]) {
    const r = await pool.query('insert into usuarios (casa_id, email, nome, senha_hash, papel) values ($1,$2,$3,$4,$5) returning id',
      [casaId, `${nome.split(' ')[0].toLowerCase()}-av-${sufixo}@teste.local`, nome, senha, papel]);
    if (papel === 'admin') igorId = r.rows[0].id;
  }
  app = await buildApp();
  igor = await cliente(`igor-av-${sufixo}@teste.local`);
  laura = await cliente(`laura-av-${sufixo}@teste.local`);
});

afterAll(async () => {
  await pool.query('delete from casas where id = $1', [casaId]);
  await app.close();
  await pool.end();
});

describe('academia', () => {
  let fichaA: string, fichaB: string, supino: string, triceps: string;

  it('fichas com exercícios em ordem; A fixa hoje, B no rodízio', async () => {
    fichaA = (await igor('POST', '/academia/fichas', { nome: 'Treino A', foco: 'Peito e tríceps', dias_semana: [diaSemana(hoje), diaSemana(hoje)], horario: '18:30' })).body.id;
    fichaB = (await igor('POST', '/academia/fichas', { nome: 'Treino B', foco: 'Costas' })).body.id;
    supino = (await igor('POST', '/academia/exercicios', { ficha_id: fichaA, nome: 'Supino reto', grupo: 'peito', series: 4, repeticoes: '8-10', carga_kg: 40 })).body.id;
    triceps = (await igor('POST', '/academia/exercicios', { ficha_id: fichaA, nome: 'Tríceps corda', grupo: 'triceps', series: 3, repeticoes: '12' })).body.id;
    const fichas = (await igor('GET', '/academia/fichas')).body;
    expect(fichas[0]).toMatchObject({ nome: 'Treino A', dias_semana: [diaSemana(hoje)] }); // dias sem repetição
    expect(fichas[0].exercicios.map((e: any) => [e.nome, e.ordem])).toEqual([['Supino reto', 0], ['Tríceps corda', 1]]);
    // a Laura não vê nem usa a ficha do Igor
    expect((await laura('GET', '/academia/fichas')).body).toEqual([]);
    expect((await laura('POST', '/academia/exercicios', { ficha_id: fichaA, nome: 'x' })).status).toBe(404);
  });

  it('treino de hoje: fixa + próxima do rodízio', async () => {
    const h = (await igor('GET', '/academia/hoje')).body;
    expect(h.fixas.map((f: any) => f.nome)).toEqual(['Treino A']);
    expect(h.rodizio.nome).toBe('Treino B');
    expect(h.dia_de_treino).toBe(true);
  });

  it('concluir registra cargas, entra em saúde e atualiza a ficha (progressão)', async () => {
    const r = await igor('POST', `/academia/fichas/${fichaA}/concluir`, {
      duracao_min: 55, intensidade: 4,
      registros: [
        { exercicio_id: supino, series_feitas: 4, repeticoes: '10', carga_kg: 42.5 },
        { exercicio_id: triceps, series_feitas: 2, concluido: false },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ tipo: 'musculacao', ficha_id: fichaA, observacoes: 'Treino A · Peito e tríceps' });
    const ficha = (await igor('GET', '/academia/fichas')).body.find((f: any) => f.id === fichaA);
    expect(Number(ficha.exercicios[0].carga_kg)).toBe(42.5);
    expect(ficha.exercicios[0].ultimo).toMatchObject({ repeticoes: '10' });
    expect((await igor('GET', `/academia/exercicios/${supino}/evolucao`)).body.map((x: any) => Number(x.carga_kg))).toEqual([42.5]);
    expect((await igor('GET', '/academia/hoje')).body.feitos.map((f: any) => f.nome)).toEqual(['Treino A']);
    // exercício de outra ficha é recusado
    const outro = (await igor('POST', '/academia/exercicios', { ficha_id: fichaB, nome: 'Remada' })).body.id;
    expect((await igor('POST', `/academia/fichas/${fichaA}/concluir`, { duracao_min: 10, registros: [{ exercicio_id: outro }] })).status).toBe(400);
  });

  it('reordenar exercícios', async () => {
    await igor('PUT', `/academia/fichas/${fichaA}/ordem`, { ids: [triceps, supino] });
    const ficha = (await igor('GET', '/academia/fichas')).body.find((f: any) => f.id === fichaA);
    expect(ficha.exercicios.map((e: any) => e.nome)).toEqual(['Tríceps corda', 'Supino reto']);
  });
});

describe('dieta', () => {
  let cafe: string;
  it('plano do dia de treino com refeições, itens e totais; marcar refeição feita', async () => {
    const todos = (await igor('POST', '/dieta/planos', { nome: 'Base', aplica_em: 'todos', kcal_meta: 2200 })).body.id;
    const treino = (await igor('POST', '/dieta/planos', { nome: 'Dia de treino', aplica_em: 'treino', kcal_meta: 2600, proteina_g: 160 })).body.id;
    cafe = (await igor('POST', '/dieta/refeicoes', { plano_id: treino, nome: 'Café da manhã', horario: '07:00', lembrar: true })).body.id;
    await igor('POST', '/dieta/refeicoes', { plano_id: treino, nome: 'Almoço', horario: '12:00' });
    await igor('POST', '/dieta/itens', { refeicao_id: cafe, alimento: 'Ovos', quantidade: '3 unidades', kcal: 210, proteina_g: 18 });
    await igor('POST', '/dieta/itens', { refeicao_id: cafe, alimento: 'Pão integral', quantidade: '2 fatias', kcal: 140, carbo_g: 24 });
    expect(todos).toBeTruthy();

    const h = (await igor('GET', '/dieta/hoje')).body;
    expect(h.dia_de_treino).toBe(true); // tem ficha fixa hoje
    expect(h.plano.nome).toBe('Dia de treino');
    expect(h.plano.refeicoes.map((r: any) => r.nome)).toEqual(['Café da manhã', 'Almoço']);
    expect(h.plano.refeicoes[0].totais).toEqual({ kcal: 350, proteina_g: 18, carbo_g: 24, gordura_g: null });
    expect(h.plano.totais.kcal).toBe(350);
    // override manual: dia de descanso cai no plano "todos"
    expect((await igor('GET', '/dieta/hoje?tipo=descanso')).body.plano.nome).toBe('Base');

    await igor('POST', `/dieta/refeicoes/${cafe}/feita`, {});
    expect((await igor('GET', '/dieta/hoje')).body.plano.refeicoes[0].feita).toBe(true);
    await igor('DELETE', `/dieta/refeicoes/${cafe}/feita`);
    expect((await igor('GET', '/dieta/hoje')).body.plano.refeicoes[0].feita).toBe(false);
  });
});

describe('avisos pessoais', () => {
  it('configuração: apikey nunca volta; WhatsApp exige telefone e chave', async () => {
    expect((await igor('PUT', '/avisos/config', { ativo: true, canal: 'callmebot', telefone: '+5555999990000' })).status).toBe(400);
    const r = await igor('PUT', '/avisos/config', {
      ativo: true, canal: 'callmebot', telefone: '+5555999990000', apikey: '123456', resumo_hora: '07:00',
      silencio_inicio: '23:00', silencio_fim: '06:00', avisar_refeicoes: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.tem_apikey).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('123456');
    // salvar de novo sem apikey mantém a chave
    expect((await igor('PUT', '/avisos/config', { ...r.body, apikey: undefined, ativo: true })).body.tem_apikey).toBe(true);
    // Telegram só depois de vincular
    expect((await laura('PUT', '/avisos/config', { ativo: true, canal: 'telegram' })).status).toBe(400);
  });

  it('prévia lista o que vai sair hoje e em que horário', async () => {
    await pool.query(`insert into saude_remedios (user_id, nome, horarios) values ($1, 'Vitamina D', '{08:00}')`, [igorId]);
    const p = (await igor('GET', '/avisos/previa')).body;
    const tipos = p.avisos.map((a: any) => `${a.sai_as} ${a.tipo}`);
    expect(tipos).toEqual(expect.arrayContaining(['07:00 resumo', '07:00 refeicao', '08:00 remedios']));
    expect(tipos.some((t: string) => t.endsWith('treino'))).toBe(false); // Treino A já foi feito hoje
  });

  it('disparo: envia uma mensagem agrupada, não repete e reenvia se falhar', async () => {
    const enviados: { destino: any; texto: string }[] = [];
    const ok = async (destino: any, texto: string) => { enviados.push({ destino, texto }); };
    const r1 = await dispararAvisos(consultar, { agora: as('07:05'), enviar: ok });
    const meu = r1.find((x) => x.dono === igorId)!;
    expect(meu.enviados.sort()).toEqual([`refeicao:${(await pool.query("select id from dieta_refeicoes where nome = 'Café da manhã' and user_id = $1", [igorId])).rows[0].id}:${hoje}`, `resumo:${hoje}`].sort());
    const msg = enviados.find((e) => e.destino.telefone === '+5555999990000')!;
    expect(msg.destino).toEqual({ canal: 'callmebot', telefone: '+5555999990000', apikey: '123456' });
    expect(msg.texto.startsWith('☀️ Bom dia, Igor!')).toBe(true); // resumo primeiro, depois a refeição
    expect(msg.texto).toContain('🍽️ 07:00 — Café da manhã');

    // mesmo ciclo de novo (cron duplicado/atrasado): nada
    const antes = enviados.length;
    await dispararAvisos(consultar, { agora: as('07:10'), enviar: ok });
    expect(enviados.length).toBe(antes);

    // falha no envio das 08:00 → chave apagada → sai no ciclo seguinte
    const falha = async () => { throw new Error('CallMeBot fora do ar'); };
    const r2 = await dispararAvisos(consultar, { agora: as('08:00'), enviar: falha });
    expect(r2.find((x) => x.dono === igorId)!.erros).toEqual(['CallMeBot fora do ar']);
    const r3 = await dispararAvisos(consultar, { agora: as('08:05'), enviar: ok });
    expect(r3.find((x) => x.dono === igorId)!.enviados[0]).toMatch(/^doses:/);

    // silêncio: nada sai
    await pool.query(`insert into saude_remedios (user_id, nome, horarios) values ($1, 'Melatonina', '{23:30}')`, [igorId]);
    const r4 = await dispararAvisos(consultar, { agora: as('23:30'), enviar: ok });
    expect(r4.find((x) => x.dono === igorId)!.enviados).toEqual([]);
  });
});

describe('Telegram e grupo da casa', () => {
  const chamadas: { url: string; body: any }[] = [];
  beforeAll(() => {
    vi.stubGlobal('fetch', async (url: string, init?: any) => {
      chamadas.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
  });

  const webhook = (texto: string, chat: any, segredo = 'segredo-do-webhook-de-teste') => app.inject({
    method: 'POST', url: '/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': segredo },
    payload: { update_id: 1, message: { message_id: 1, text: texto, chat } },
  });

  it('webhook sem o segredo é recusado', async () => {
    expect((await webhook('/start ABC', { id: 1, type: 'private' }, 'errado')).statusCode).toBe(401);
  });

  it('vincula o chat pessoal da Laura com código de uso único', async () => {
    const c = (await laura('POST', '/avisos/telegram/codigo', { tipo: 'pessoal' })).body;
    expect(c.link).toBe(`https://t.me/VidaTesteBot?start=${c.codigo}`);
    expect((await webhook(`/start ${c.codigo}`, { id: 777, type: 'private' })).statusCode).toBe(200);
    expect(chamadas.at(-1)!.body).toMatchObject({ chat_id: '777', parse_mode: 'HTML' });
    expect((await laura('GET', '/avisos/config')).body.telegram_vinculado).toBe(true);
    expect((await laura('PUT', '/avisos/config', { ativo: true, canal: 'telegram', resumo_hora: '06:00' })).status).toBe(200);
    // código já usado
    await webhook(`/start ${c.codigo}`, { id: 777, type: 'private' });
    expect(chamadas.at(-1)!.body.text).toContain('Código inválido');
  });

  it('só o admin vincula o grupo; código de grupo não funciona em chat privado', async () => {
    expect((await laura('POST', '/avisos/telegram/codigo', { tipo: 'casa' })).status).toBe(400);
    const c = (await igor('POST', '/avisos/telegram/codigo', { tipo: 'casa' })).body;
    expect(c.comando).toBe(`/vincular ${c.codigo}`);
    await webhook(`/vincular@VidaTesteBot ${c.codigo}`, { id: -100123, type: 'supergroup', title: 'Casa' });
    const casa = (await igor('GET', '/avisos/casa')).body;
    expect(casa).toMatchObject({ grupo_vinculado: true, titulo_grupo: 'Casa', ativo: true });
    expect(JSON.stringify(casa)).not.toContain('-100123');
  });

  it('resumo da casa: tarefas compartilhadas e contas vencendo (inclusive fixo ainda não gerado)', async () => {
    await laura('POST', '/tarefas', { titulo: 'Tirar o lixo', compartilhada: true, data: hoje, responsavel_id: igorId });
    await igor('POST', '/tarefas', { titulo: 'Privada do Igor', data: hoje });
    const amanha = somarDias(hoje, 1);
    await pool.query(
      `insert into recorrencias (casa_id, descricao, tipo, valor_previsto_centavos, dia_mes, meio, inicio)
       values ($1, 'Conta de luz', 'despesa', 21000, $2, 'boleto', $3)`, [casaId, Number(amanha.slice(8, 10)), `${amanha.slice(0, 7)}-01`]);
    await igor('PUT', '/avisos/casa', { ativo: true, resumo_hora: '08:00', avisar_tarefas: true, avisar_contas: true, dias_antes_contas: 1 });

    const enviados: { destino: any; texto: string }[] = [];
    const r = await dispararAvisos(consultar, { agora: as('08:00'), enviar: async (destino, texto) => { enviados.push({ destino, texto }); } });
    expect(r.find((x) => x.dono === casaId)!.enviados).toEqual([`casa:resumo:${hoje}`]);
    const grupo = enviados.find((e) => e.destino.chat_id === '-100123')!;
    expect(grupo.texto).toContain('• Tirar o lixo — Igor');
    expect(grupo.texto).not.toContain('Privada do Igor');
    expect(grupo.texto).toMatch(/Conta de luz — R\$\s?210,00 \(amanhã\)/);
    // a Laura recebe o resumo pessoal dela no Telegram (06:00 + 3h de janela ainda vale às 08:00)
    expect(enviados.find((e) => e.destino.chat_id === '777')?.texto).toContain('Bom dia, Laura!');
  });

  it('avisos pessoais no grupo da casa levam o nome de quem é', async () => {
    const lauraId = (await pool.query('select id from usuarios where casa_id = $1 and papel = $2', [casaId, 'membro'])).rows[0].id;
    await pool.query(`insert into saude_remedios (user_id, nome, horarios) values ($1, 'Anticoncepcional', '{09:00}')`, [lauraId]);
    const r = await laura('PUT', '/avisos/config', { ativo: true, canal: 'grupo', resumo_hora: null, discreto: true });
    expect(r.status).toBe(200);
    expect(r.body.grupo_vinculado).toBe(true);
    const enviados: { destino: any; texto: string }[] = [];
    await dispararAvisos(consultar, { agora: as('09:00'), enviar: async (destino, texto) => { enviados.push({ destino, texto }); } });
    const msg = enviados.find((e) => e.destino.chat_id === '-100123' && e.texto.startsWith('👤 *Laura*'))!;
    expect(msg.texto).toBe('👤 *Laura*\n💊 09:00 — hora de 1 remédio.'); // discreto: o grupo não vê o nome do remédio
  });

  it('canal grupo exige o grupo vinculado', async () => {
    await pool.query('update notif_casa set telegram_chat_id = null where casa_id = $1', [casaId]);
    expect((await laura('PUT', '/avisos/config', { ativo: true, canal: 'grupo' })).status).toBe(400);
  });

  it('gatilho externo exige o token', async () => {
    expect((await app.inject({ method: 'POST', url: '/interno/avisos/disparar' })).statusCode).toBe(401);
  });
});

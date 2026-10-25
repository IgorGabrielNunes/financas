// E2E de metas e investimentos (Postgres real): dinheiro aplicado/guardado sai do saldo das contas sem virar
// despesa, resgates voltam, metas somam investimentos vinculados, simulador e taxas de referência.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { pool } from './core/db.js';
import { migrate } from './core/migrate.js';
import { hashSenha } from './core/auth.js';
import { hojeSP, somarMesesData } from './core/datas.js';
import { atualizarTaxasSeVelhas } from './modulos/financas/servicos/investimentos.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let casaId: string, outraCasa: string;
const sufixo = Date.now();
type Cliente = (method: string, url: string, payload?: unknown) => Promise<{ status: number; body: any }>;
let igor: Cliente, intruso: Cliente;
let corrente: string, nubank: string, reserva: string, cdb: string, viagem: string, contaIntruso: string;
const hoje = hojeSP();

async function cliente(email: string): Promise<Cliente> {
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha: 'senha-de-teste-123' } });
  const h = { authorization: `Bearer ${JSON.parse(login.body).token}` };
  return async (method, url, payload) => {
    const r = await app.inject({ method: method as any, url, payload: payload as any, headers: h });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
}
const saldo = async (id: string) => (await igor('GET', '/contas')).body.find((c: any) => c.id === id);
const disponivel = async () => (await igor('GET', '/dashboard')).body.disponivel.saldo_contas_centavos;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await migrate();
  const senha = await hashSenha('senha-de-teste-123');
  casaId = (await pool.query('insert into casas (nome) values ($1) returning id', ['Casa investimentos'])).rows[0].id;
  outraCasa = (await pool.query('insert into casas (nome) values ($1) returning id', ['Outra casa'])).rows[0].id;
  await pool.query('insert into usuarios (casa_id, email, nome, senha_hash, papel) values ($1,$2,$3,$4,$5)', [casaId, `igor-inv-${sufixo}@teste.local`, 'Igor', senha, 'admin']);
  await pool.query('insert into usuarios (casa_id, email, nome, senha_hash, papel) values ($1,$2,$3,$4,$5)', [outraCasa, `intruso-inv-${sufixo}@teste.local`, 'Intruso', senha, 'admin']);
  app = await buildApp();
  igor = await cliente(`igor-inv-${sufixo}@teste.local`);
  intruso = await cliente(`intruso-inv-${sufixo}@teste.local`);
  corrente = (await igor('POST', '/contas', { nome: 'Corrente', tipo: 'corrente', saldo_inicial_centavos: 1_000_000 })).body.id;
  nubank = (await igor('POST', '/contas', { nome: 'Nubank', tipo: 'corrente', saldo_inicial_centavos: 0 })).body.id;
  contaIntruso = (await intruso('POST', '/contas', { nome: 'Dele', tipo: 'corrente', saldo_inicial_centavos: 0 })).body.id;
});

afterAll(async () => {
  await pool.query('delete from casas where id = any($1)', [[casaId, outraCasa]]);
  await app.close();
  await pool.end();
});

describe('investimentos', () => {
  it('cadastra o que já estava aplicado: não mexe em conta, saldo informado vira a posição', async () => {
    const antes = await disponivel();
    const r = await igor('POST', '/investimentos', {
      nome: 'CDB Nubank', tipo: 'cdb', indexador: 'cdi', taxa: 102, conta_id: nubank,
      inicial: { valor_centavos: 500_000, data: '2026-01-05', conta_origem_id: null, saldo_atual_centavos: 540_000 },
    });
    expect(r.status).toBe(201);
    cdb = r.body.id;
    expect(await disponivel()).toBe(antes);
    const lista = (await igor('GET', '/investimentos')).body;
    const p = lista.itens[0].posicao;
    expect(p.saldo_bruto_centavos).toBe(540_000);
    expect(p.investido_centavos).toBe(500_000);
    expect(p.rendimento_bruto_centavos).toBe(40_000);
    expect(p.origem).toBe('informado');
    expect(p.ir_centavos).toBe(8_000); // aplicado em janeiro: menos de 360 dias → 20% sobre R$ 400
    expect(lista.por_conta).toEqual([expect.objectContaining({ conta_id: nubank, saldo_centavos: 540_000 })]);
    // conta mostra o investido à parte, sem somar no saldo
    const nb = await saldo(nubank);
    expect(nb.saldo_centavos).toBe(0);
    expect(nb.investido_centavos).toBe(540_000);
  });

  it('aporte sai da conta de origem sem virar despesa; resgate volta', async () => {
    const antes = await disponivel();
    expect((await igor('POST', `/investimentos/${cdb}/movimentos`, { tipo: 'aporte', data: hoje, valor_centavos: 100_000, conta_id: corrente })).status).toBe(201);
    expect((await saldo(corrente)).saldo_centavos).toBe(900_000);
    expect(await disponivel()).toBe(antes - 100_000);
    const [ano, mes] = hoje.split('-');
    const vm = (await igor('GET', `/mes/${ano}/${+mes}`)).body;
    expect(vm.totais.despesas_centavos).toBe(0);

    const res = await igor('POST', `/investimentos/${cdb}/movimentos`, { tipo: 'resgate', data: hoje, valor_centavos: 30_000, conta_id: corrente });
    expect(res.status).toBe(201);
    expect((await saldo(corrente)).saldo_centavos).toBe(930_000);
    const det = (await igor('GET', `/investimentos/${cdb}`)).body;
    expect(det.movimentos).toHaveLength(3);
    expect(det.posicao.aportado_centavos).toBe(600_000);
    expect(det.posicao.resgatado_centavos).toBe(30_000);
    expect(det.evolucao.length).toBeGreaterThan(5);
    expect(det.evolucao.at(-1).data).toBe(hoje);

    // apagar o resgate devolve o efeito
    expect((await igor('DELETE', `/investimentos/${cdb}/movimentos/${res.body.id}`)).status).toBe(204);
    expect((await saldo(corrente)).saldo_centavos).toBe(900_000);
  });

  it('conta do tipo investimento fica fora do disponível e aparece no patrimônio', async () => {
    const antes = await disponivel();
    reserva = (await igor('POST', '/contas', { nome: 'Reserva', tipo: 'investimento', saldo_inicial_centavos: 200_000 })).body.id;
    const d = (await igor('GET', '/dashboard')).body;
    expect(d.disponivel.saldo_contas_centavos).toBe(antes);
    expect(d.patrimonio.contas_reserva_centavos).toBe(200_000);
    expect(d.patrimonio.investimentos.saldo_bruto_centavos).toBeGreaterThanOrEqual(640_000);
    expect(d.patrimonio.investimentos.rendimento_mes_centavos).toBeGreaterThan(0);
  });

  it('valida vínculos: conta obrigatória e da própria casa; investimento de outra casa é invisível', async () => {
    expect((await igor('POST', '/investimentos', { nome: 'X', tipo: 'cdb', indexador: 'cdi' })).status).toBe(400);
    expect((await igor('POST', '/investimentos', { nome: 'X', tipo: 'cdb', indexador: 'cdi', conta_id: contaIntruso })).status).toBe(404);
    expect((await intruso('GET', `/investimentos/${cdb}`)).status).toBe(404);
    expect((await intruso('POST', `/investimentos/${cdb}/movimentos`, { tipo: 'aporte', data: hoje, valor_centavos: 1 })).status).toBe(404);
    expect((await intruso('DELETE', `/investimentos/${cdb}`)).status).toBe(404);
    // conta com investimento não pode ser excluída (o dinheiro sumiria)
    expect((await igor('DELETE', `/contas/${nubank}`)).status).toBe(409);
  });

  it('saldo informado é atualizado no mesmo dia (upsert)', async () => {
    await igor('POST', `/investimentos/${cdb}/saldos`, { data: hoje, valor_centavos: 650_000 });
    const det = (await igor('GET', `/investimentos/${cdb}`)).body;
    expect(det.saldos.filter((s: any) => s.data === hoje)).toHaveLength(1);
    expect(det.posicao.saldo_bruto_centavos).toBe(650_000);
  });
});

describe('metas', () => {
  it('cria meta com valor já guardado vindo de uma conta: sai do saldo', async () => {
    const r = await igor('POST', '/metas', {
      nome: 'Viagem pro Chile', tipo: 'viagem', icone: '✈️', valor_alvo_centavos: 800_000,
      data_alvo: somarMesesData(hoje, 10), guardado_inicial_centavos: 50_000, conta_origem_id: corrente,
    });
    expect(r.status).toBe(201);
    viagem = r.body.id;
    expect((await saldo(corrente)).saldo_centavos).toBe(850_000);
    expect((await saldo(corrente)).guardado_metas_centavos).toBe(50_000);
    const m = (await igor('GET', '/metas')).body[0];
    expect(m.guardado_centavos).toBe(50_000);
    expect(m.falta_centavos).toBe(750_000);
    expect(m.pct).toBe(6.3);
    expect(m.meses_restantes).toBe(10);
    expect(m.mensal_necessario_centavos).toBe(75_000);
    expect(m.mensal_com_rendimento_centavos).toBeNull();
  });

  it('guardar e retirar; não retira mais do que foi guardado direto', async () => {
    expect((await igor('POST', `/metas/${viagem}/movimentos`, { tipo: 'guardar', valor_centavos: 20_000, conta_id: corrente })).status).toBe(201);
    expect((await saldo(corrente)).saldo_centavos).toBe(830_000);
    const demais = await igor('POST', `/metas/${viagem}/movimentos`, { tipo: 'retirar', valor_centavos: 100_000, conta_id: corrente });
    expect(demais.status).toBe(409);
    expect((await igor('POST', `/metas/${viagem}/movimentos`, { tipo: 'retirar', valor_centavos: 10_000, conta_id: corrente })).status).toBe(201);
    expect((await saldo(corrente)).saldo_centavos).toBe(840_000);
    const det = (await igor('GET', `/metas/${viagem}`)).body;
    expect(det.guardado_centavos).toBe(60_000);
    expect(det.movimentos).toHaveLength(3);
  });

  it('investimento vinculado conta no progresso e reduz o que precisa guardar por mês', async () => {
    const inv = (await igor('GET', `/investimentos/${cdb}`)).body;
    await igor('PUT', `/investimentos/${cdb}`, { ...inv, meta_id: viagem, vencimento: null, observacao: null, usuario_id: null });
    const m = (await igor('GET', '/metas')).body.find((x: any) => x.id === viagem);
    expect(m.em_investimentos_centavos).toBe(650_000);
    expect(m.guardado_centavos).toBe(710_000);
    expect(m.investimentos).toEqual([expect.objectContaining({ id: cdb, nome: 'CDB Nubank' })]);
    expect(m.mensal_com_rendimento_centavos).toBeLessThan(m.mensal_necessario_centavos);
    // excluir a meta: o guardado direto volta para a conta, o investimento continua (desvinculado)
    expect((await igor('DELETE', `/metas/${viagem}`)).status).toBe(204);
    expect((await saldo(corrente)).saldo_centavos).toBe(900_000);
    expect((await igor('GET', `/investimentos/${cdb}`)).body.meta_id).toBeNull();
  });

  it('membros da casa (para escolher o dono) só da própria casa', async () => {
    expect((await igor('GET', '/membros')).body).toEqual([expect.objectContaining({ nome: 'Igor' })]);
    expect((await intruso('GET', '/membros')).body.map((u: any) => u.nome)).toEqual(['Intruso']);
  });

  it('meta de outra casa é invisível', async () => {
    const m = (await igor('POST', '/metas', { nome: 'Cofrinho', tipo: 'cofrinho', valor_alvo_centavos: 100 })).body;
    expect((await intruso('GET', `/metas/${m.id}`)).status).toBe(404);
    expect((await intruso('POST', `/metas/${m.id}/movimentos`, { tipo: 'guardar', valor_centavos: 1 })).status).toBe(404);
    expect((await intruso('GET', '/metas')).body).toEqual([]);
  });
});

describe('simulador e taxas', () => {
  it('compara as opções padrão, ordenadas por resultado líquido, com o modelo atual à parte', async () => {
    const r = (await igor('POST', '/investimentos/simular', { inicial_centavos: 1_000_000, mensal_centavos: 50_000, meses: 24, atual_id: cdb })).body;
    expect(r.resultados).toHaveLength(8);
    for (let i = 1; i < r.resultados.length; i++) expect(r.resultados[i - 1].liquido_centavos).toBeGreaterThanOrEqual(r.resultados[i].liquido_centavos);
    expect(r.atual.nome).toBe('CDB Nubank');
    expect(r.atual.investido_centavos).toBe(1_000_000 + 50_000 * 24);
    expect(r.atual.serie).toHaveLength(24);
    expect((await igor('POST', '/investimentos/simular', { inicial_centavos: 0, mensal_centavos: 0, meses: 12 })).body.resultados).toEqual([]);
    expect((await intruso('POST', '/investimentos/simular', { inicial_centavos: 1, mensal_centavos: 0, meses: 12, atual_id: cdb })).status).toBe(404);
  });

  it('taxas manuais valem para a casa toda; atualização do BC usa o SGS', async () => {
    const t = (await igor('PUT', '/investimentos/taxas', { selic_aa: 10, cdi_aa: 10, ipca_aa: 4, tr_am: 0 })).body;
    expect(t.fonte).toBe('manual');
    const r = (await igor('POST', '/investimentos/simular', {
      inicial_centavos: 100_000, mensal_centavos: 0, meses: 12,
      opcoes: [{ chave: 'x', nome: 'CDI', modelo: { indexador: 'cdi', taxa: 100, isento_ir: false } }],
    })).body;
    expect(r.resultados[0].taxa_aa_pct).toBe(10);
    expect((await intruso('GET', '/investimentos/taxas')).body.cdi_aa).not.toBe(10);

    const valores: Record<string, string> = { 432: '13.75', 4389: '13.65', 13522: '4.9', 226: '0.1712' };
    const falso = (async (url: string) => {
      const serie = /sgs\.(\d+)/.exec(url)![1];
      return new Response(JSON.stringify([{ data: '24/10/2026', valor: valores[serie] }]), { status: 200 });
    }) as unknown as typeof fetch;
    const at = await atualizarTaxasSeVelhas(casaId, true, falso);
    expect(at.atualizou).toBe(true);
    expect(at.taxas).toMatchObject({ selic_aa: 13.75, cdi_aa: 13.65, ipca_aa: 4.9, tr_am: 0.1712, fonte: 'bcb' });
    // BC fora do ar: mantém o que tinha
    const fora = await atualizarTaxasSeVelhas(casaId, true, (async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(fora.atualizou).toBe(false);
    expect(fora.taxas.fonte).toBe('bcb');
  });
});

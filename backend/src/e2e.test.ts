// Teste ponta a ponta contra Postgres real (usa DATABASE_URL do .env).
// Rodar: npm run test:e2e   — cria um usuário descartável e limpa ao final.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { pool } from './core/db.js';
import { migrate } from './core/migrate.js';
import { hashSenha } from './core/auth.js';
import { hojeSP } from './core/datas.js';

const email = `e2e-${Date.now()}@teste.local`;
let app: Awaited<ReturnType<typeof buildApp>>;
let auth: Record<string, string>;
let casaId: string;
const call = async (method: string, url: string, payload?: unknown) => {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: auth });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await migrate();
  casaId = (await pool.query('insert into casas (nome) values ($1) returning id', ['Casa E2E'])).rows[0].id;
  await pool.query(`insert into usuarios (casa_id, email, nome, senha_hash, papel) values ($1, $2, $3, $4, 'admin')`,
    [casaId, email, 'E2E', await hashSenha('senha-de-teste-123')]);
  app = await buildApp();
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha: 'senha-de-teste-123' } });
  auth = { authorization: `Bearer ${JSON.parse(login.body).token}` };
});

afterAll(async () => {
  await pool.query('delete from casas where id = $1', [casaId]); // cascata: usuários e todos os dados
  await app.close();
  await pool.end();
});

describe('fluxo completo', () => {
  const hoje = hojeSP();
  let contaId: string, cartaoId: string, compraId: string;

  it('bloqueia sem token', async () => {
    const r = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(r.statusCode).toBe(401);
  });

  it('cadastra conta e cartão', async () => {
    const conta = await call('POST', '/contas', { nome: 'Corrente', tipo: 'corrente', saldo_inicial_centavos: 200000 });
    expect(conta.status).toBe(201);
    contaId = conta.body.id;
    const cartao = await call('POST', '/cartoes', {
      nome: 'Roxinho', limite_centavos: 500000, dia_fechamento: 3, dia_vencimento: 10, conta_pagamento_id: contaId,
    });
    expect(cartao.status).toBe(201);
    cartaoId = cartao.body.id;
  });

  it('compra parcelada consome o limite inteiro e gera faturas futuras', async () => {
    const sim = await call('GET', `/cartoes/${cartaoId}/simular?data=${hoje}&valor=30001&parcelas=3`);
    expect(sim.body.map((p: any) => p.valorCentavos)).toEqual([10001, 10000, 10000]);

    const r = await call('POST', '/lancamentos', {
      tipo: 'despesa', descricao: 'Notebook', valor_centavos: 30001, data: hoje, meio: 'credito', cartao_id: cartaoId, parcelas_total: 3,
    });
    expect(r.status).toBe(201);
    compraId = r.body.id;

    const cartoes = await call('GET', '/cartoes');
    const c = cartoes.body.find((x: any) => x.id === cartaoId);
    expect(c.usado_centavos).toBe(30001);
    expect(c.livre_centavos).toBe(500000 - 30001);

    const det = await call('GET', `/lancamentos/${compraId}`);
    expect(det.body.parcelas).toHaveLength(3);
  });

  it('compra antiga em andamento: parcelas já pagas não entram em fatura nem no limite', async () => {
    const r = await call('POST', '/lancamentos', {
      tipo: 'despesa', descricao: 'Geladeira', valor_centavos: 120000, data: '2026-01-15', meio: 'credito',
      cartao_id: cartaoId, parcelas_total: 12, parcelas_pagas_antes: 9,
    });
    expect(r.status).toBe(201);
    const det = await call('GET', `/lancamentos/${r.body.id}`);
    expect(det.body.parcelas.map((p: any) => p.numero)).toEqual([10, 11, 12]);
    const c = (await call('GET', '/cartoes')).body.find((x: any) => x.id === cartaoId);
    expect(c.usado_centavos).toBe(30001 + 30000);
    expect((await call('POST', '/lancamentos', {
      tipo: 'despesa', descricao: 'x', valor_centavos: 100, data: hoje, meio: 'credito', cartao_id: cartaoId, parcelas_total: 2, parcelas_pagas_antes: 2,
    })).status).toBe(400);
    expect((await call('DELETE', `/lancamentos/${r.body.id}`)).status).toBe(204);
  });

  it('rejeita parcelamento fora do crédito', async () => {
    const r = await call('POST', '/lancamentos', {
      tipo: 'despesa', descricao: 'x', valor_centavos: 100, data: hoje, meio: 'debito', conta_id: contaId, parcelas_total: 2,
    });
    expect(r.status).toBe(400);
  });

  it('débito realizado baixa o saldo da conta', async () => {
    await call('POST', '/lancamentos', { tipo: 'despesa', descricao: 'Mercado', valor_centavos: 15000, data: hoje, meio: 'debito', conta_id: contaId });
    const contas = await call('GET', '/contas');
    expect(contas.body.find((x: any) => x.id === contaId).saldo_centavos).toBe(185000);
  });

  it('recorrências materializam de forma idempotente', async () => {
    const ini = hoje.slice(0, 8) + '01';
    const sal = await call('POST', '/recorrencias', {
      descricao: 'Salário', tipo: 'receita', valor_previsto_centavos: 500000, dia_mes: 28, meio: 'transferencia', conta_id: contaId, inicio: ini,
    });
    expect(sal.status).toBe(201);
    await call('POST', '/recorrencias', {
      descricao: 'Aluguel', tipo: 'despesa', valor_previsto_centavos: 120000, dia_mes: 27, meio: 'pix', conta_id: contaId, inicio: ini,
    });
    const [a, m] = hoje.split('-');
    const m1 = await call('GET', `/mes/${a}/${+m}`);
    const m2 = await call('GET', `/mes/${a}/${+m}`);
    expect(m1.body.receitas.filter((l: any) => l.recorrencia_id)).toHaveLength(1);
    expect(m2.body.receitas.filter((l: any) => l.recorrencia_id)).toHaveLength(1);
    expect(m2.body.despesas.some((l: any) => l.descricao === 'Aluguel' && l.status === 'previsto')).toBe(true);

    // editar a regra regenera as previstas com o novo valor
    await call('PUT', `/recorrencias/${sal.body.id}`, {
      descricao: 'Salário', tipo: 'receita', valor_previsto_centavos: 550000, dia_mes: 28, meio: 'transferencia', conta_id: contaId, inicio: ini,
    });
    const m3 = await call('GET', `/mes/${a}/${+m}`);
    expect(m3.body.receitas.find((l: any) => l.recorrencia_id).valor_centavos).toBe(550000);
  });

  it('receita prevista com data passada não infla o disponível; vira pendência', async () => {
    if (hoje.endsWith('-01')) return; // sem "dia passado" no mês para testar
    const antes = (await call('GET', '/dashboard')).body.disponivel.disponivel_centavos;
    const r = await call('POST', '/lancamentos', {
      tipo: 'receita', descricao: 'Freela atrasado', valor_centavos: 90000, data: hoje.slice(0, 8) + '01', meio: 'pix', conta_id: contaId, status: 'previsto',
    });
    const d = (await call('GET', '/dashboard')).body;
    expect(d.disponivel.disponivel_centavos).toBe(antes);
    expect(d.receitas_a_confirmar.map((x: any) => x.id)).toContain(r.body.id);
    await call('DELETE', `/lancamentos/${r.body.id}`);
  });

  it('dashboard calcula disponível real', async () => {
    const d = await call('GET', '/dashboard');
    expect(d.status).toBe(200);
    const x = d.body.disponivel;
    expect(x.disponivel_centavos).toBe(
      x.saldo_contas_centavos + x.receitas_previstas_centavos - x.despesas_previstas_centavos - x.faturas_a_pagar_centavos,
    );
    expect(d.body.projecao).toHaveLength(6);
    const c = d.body.cartoes.find((y: any) => y.id === cartaoId);
    expect(c.gasto_seguro_centavos).toBeLessThanOrEqual(c.livre_centavos);
  });

  it('pagamento de fatura bloqueia edição da compra e debita a conta', async () => {
    const det = await call('GET', `/lancamentos/${compraId}`);
    const fatId = det.body.parcelas[0].fatura_id;
    const antes = (await call('GET', '/contas')).body.find((x: any) => x.id === contaId).saldo_centavos;
    const pg = await call('PUT', `/faturas/${fatId}/pagamento`, { valor_pago_centavos: 10001, pago_em: hoje, conta_pagamento_id: contaId });
    expect(pg.status).toBe(200);
    const depois = (await call('GET', '/contas')).body.find((x: any) => x.id === contaId).saldo_centavos;
    expect(antes - depois).toBe(10001);

    const fat = await call('GET', `/faturas/${fatId}`);
    expect(fat.body.status).toBe('paga');
    expect(fat.body.itens[0].descricao).toBe('Notebook');

    const edit = await call('PATCH', `/lancamentos/${compraId}`, { valor_centavos: 50000 });
    expect(edit.status).toBe(409);
    // editar descrição não mexe em parcelas: liberado
    expect((await call('PATCH', `/lancamentos/${compraId}`, { descricao: 'Notebook Dell' })).status).toBe(200);
  });

  it('comprovante: upload, link assinado, download e exclusão', async () => {
    const lanc = await call('POST', '/lancamentos', { tipo: 'despesa', descricao: 'Farmácia', valor_centavos: 4590, data: hoje, meio: 'pix', conta_id: contaId });
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const boundary = '----x';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="recibo.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({
      method: 'POST', url: `/lancamentos/${lanc.body.id}/comprovantes`, payload: body,
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(up.statusCode).toBe(201);
    const cid = JSON.parse(up.body).id;

    const { body: u } = await call('GET', `/comprovantes/${cid}/url`);
    const path = new URL(u.url).pathname + new URL(u.url).search;
    const dl = await app.inject({ method: 'GET', url: path });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    const forjado = await app.inject({ method: 'GET', url: path.replace(/sig=[^&]+/, 'sig=abc') });
    expect(forjado.statusCode).toBe(403);

    // arquivo que finge ser PNG é recusado pelos magic bytes
    const fake = await app.inject({
      method: 'POST', url: `/lancamentos/${lanc.body.id}/comprovantes`,
      payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n<script>\r\n--${boundary}--\r\n`),
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(fake.statusCode).toBe(400);

    expect((await call('DELETE', `/lancamentos/${lanc.body.id}`)).status).toBe(204);
  });

  it('pessoas: salário do perfil vira fixo vinculado; titular alimenta estatísticas', async () => {
    const p = await call('POST', '/pessoas', { nome: 'Laura', cargo: 'Assistente de RH', salario_centavos: 320000, dia_salario: 30, conta_salario_id: contaId });
    expect(p.status).toBe(201);
    await call('PUT', `/contas/${contaId}`, { nome: 'Corrente', tipo: 'corrente', saldo_inicial_centavos: 200000, pessoa_id: p.body.id, cartao_debito: true });
    await call('POST', '/cartoes', { nome: 'C6', limite_centavos: 800000, dia_fechamento: 1, dia_vencimento: 8, pessoa_id: p.body.id });
    await call('POST', '/cartoes', { nome: 'Itaú', limite_centavos: 300000, dia_fechamento: 1, dia_vencimento: 8, pessoa_id: p.body.id });

    const pes = (await call('GET', '/pessoas')).body.find((x: any) => x.id === p.body.id);
    expect(pes.qtd_cartoes_credito).toBe(2);
    expect(pes.qtd_cartoes_debito).toBe(1);
    expect(pes.maior_limite_centavos).toBe(800000);
    expect(pes.soma_limites_centavos).toBe(1100000);

    const [a, m] = hoje.split('-');
    const mes = await call('GET', `/mes/${a}/${+m}`);
    const sal = mes.body.receitas.find((l: any) => l.descricao === 'Salário (Laura)');
    expect(sal.valor_centavos).toBe(320000);

    // fixo vinculado não se edita pela tela de fixos
    const rec = (await call('GET', '/recorrencias')).body.find((r: any) => r.origem === 'salario');
    const bloqueio = await call('PUT', `/recorrencias/${rec.id}`, { descricao: 'x', tipo: 'receita', valor_previsto_centavos: 1, dia_mes: 1, meio: 'pix', inicio: hoje });
    expect(bloqueio.status).toBe(409);

    // aumento de salário atualiza a previsão
    await call('PUT', `/pessoas/${p.body.id}`, { nome: 'Laura', cargo: 'Analista de RH', salario_centavos: 360000, dia_salario: 30, conta_salario_id: contaId });
    const mes2 = await call('GET', `/mes/${a}/${+m}`);
    expect(mes2.body.receitas.find((l: any) => l.descricao === 'Salário (Laura)').valor_centavos).toBe(360000);
  });

  it('dívidas: boleto gera parcelas restantes como fixo; folha não sai do caixa', async () => {
    const pessoas = (await call('GET', '/pessoas')).body;
    const laura = pessoas.find((x: any) => x.nome === 'Laura');
    const emp = await call('POST', '/dividas', {
      pessoa_id: laura.id, tipo: 'emprestimo', credor: 'Banco X', parcelas_total: 24, valor_parcela_centavos: 45000,
      primeira_parcela: '2025-06-25', forma_pagamento: 'debito', conta_id: contaId, taxa_mensal_pct: 3.5,
    });
    expect(emp.status).toBe(201);
    expect(emp.body.parcelas_restantes).toBeGreaterThan(0);
    expect(emp.body.valor_quitacao_estimado_centavos).toBeLessThan(emp.body.saldo_nominal_centavos);

    const cons = await call('POST', '/dividas', {
      pessoa_id: laura.id, tipo: 'consignado', credor: 'Banco Y', parcelas_total: 48, valor_parcela_centavos: 30000,
      primeira_parcela: '2026-01-05', forma_pagamento: 'folha',
    });
    expect(cons.status).toBe(201);

    const recs = (await call('GET', '/recorrencias')).body.filter((r: any) => r.origem === 'divida');
    expect(recs).toHaveLength(1);
    expect(recs[0].fim).toBe('2027-05-01'); // 24ª parcela: mai/27

    const pes = (await call('GET', '/pessoas')).body.find((x: any) => x.id === laura.id);
    expect(pes.desconto_folha_centavos).toBe(30000);
    expect(pes.parcelas_mensais_centavos).toBe(45000);

    // quitar remove o fixo
    await call('PUT', `/dividas/${emp.body.id}`, {
      pessoa_id: laura.id, tipo: 'emprestimo', credor: 'Banco X', parcelas_total: 24, valor_parcela_centavos: 45000,
      primeira_parcela: '2025-06-25', forma_pagamento: 'debito', conta_id: contaId, quitada_em: hoje,
    });
    expect((await call('GET', '/recorrencias')).body.filter((r: any) => r.origem === 'divida')).toHaveLength(0);
  });

  it('inadimplência: acordo gera parcelas; desconto e prazo de negativação calculados', async () => {
    const i = await call('POST', '/inadimplencias', {
      credor: 'Faculdade Z', origem: 'faculdade', motivo: 'Perdi o emprego no meio do semestre',
      valor_original_centavos: 600000, valor_atual_centavos: 980000, desde: '2022-03-10', negativado: true, status: 'em_aberto',
    });
    expect(i.status).toBe(201);
    expect(i.body.limite_negativacao).toBe('2027-03-10');
    expect(i.body.em_aberto_centavos).toBe(980000);

    const sem = await call('PUT', `/inadimplencias/${i.body.id}`, { ...i.body, status: 'acordo' });
    expect(sem.status).toBe(400);

    const ac = await call('PUT', `/inadimplencias/${i.body.id}`, {
      credor: 'Faculdade Z', origem: 'faculdade', motivo: 'Perdi o emprego no meio do semestre', valor_original_centavos: 600000,
      valor_atual_centavos: 980000, desde: '2022-03-10', negativado: true, status: 'acordo',
      acordo_parcelas: 10, acordo_valor_parcela_centavos: 40000, acordo_primeira_parcela: '2099-01-15', acordo_forma_pagamento: 'boleto',
    });
    expect(ac.status).toBe(200);
    expect(ac.body.acordo_desconto_centavos).toBe(980000 - 400000);
    expect((await call('GET', '/recorrencias')).body.filter((r: any) => r.origem === 'acordo')).toHaveLength(1);

    const d = (await call('GET', '/dashboard')).body;
    expect(d.dividas.inadimplencias_qtd).toBe(1);
    expect(d.dividas.renda_mensal_centavos).toBe(360000);

    expect((await call('DELETE', `/inadimplencias/${i.body.id}`)).status).toBe(204);
    expect((await call('GET', '/recorrencias')).body.filter((r: any) => r.origem === 'acordo')).toHaveLength(0);
  });

  it('trabalho: histórico de salário define o líquido; aumento futuro entra no mês certo; 13º vira fixo', async () => {
    const laura = (await call('GET', '/pessoas')).body.find((x: any) => x.nome === 'Laura');
    const cfg = await call('PUT', `/pessoas/${laura.id}/trabalho`, {
      data_admissao: '2023-02-01', dependentes_ir: 0, outros_descontos_centavos: 0, paga_mes_seguinte: false,
      ferias_quitadas_ate: '2025-01-31', saque_aniversario: false, saldo_fgts_centavos: 1000000, saldo_fgts_em: '2026-09-30', gerar_decimo: true,
    });
    expect(cfg.status).toBe(200);
    const s1 = await call('POST', `/pessoas/${laura.id}/salarios`, { vigencia: '2026-01-01', bruto_centavos: 400000, cargo: 'Analista de RH' });
    expect(s1.status).toBe(201);
    expect((await call('POST', `/pessoas/${laura.id}/salarios`, { vigencia: '2026-01-01', bruto_centavos: 1 })).status).toBe(409);

    const t = (await call('GET', `/pessoas/${laura.id}/trabalho`)).body;
    // 4.000 bruto − INSS 368,60 − IR 0 (redutor) − consignado em folha 300,00
    expect(t.resumo.liquidoAtual.liquido).toBe(400000 - 36860 - 30000);
    expect(t.resumo.liquidoAtual.consignado).toBe(30000);
    expect((await call('GET', '/pessoas')).body.find((x: any) => x.id === laura.id).salario_centavos).toBe(333140);
    expect(t.pessoa.cargo).toBe('Analista de RH');

    // aumento no mês que vem
    const [a, m] = hoje.split('-').map(Number);
    const prox = m === 12 ? { a: a + 1, m: 1 } : { a, m: m + 1 };
    const vig = `${prox.a}-${String(prox.m).padStart(2, '0')}-01`;
    await call('POST', `/pessoas/${laura.id}/salarios`, { vigencia: vig, bruto_centavos: 500000 });
    const mesProx = (await call('GET', `/mes/${prox.a}/${prox.m}`)).body;
    expect(mesProx.receitas.find((l: any) => l.descricao === 'Salário (Laura)').valor_centavos).toBe(500000 - 50151 - 0 - 30000);
    const mesAtual = (await call('GET', `/mes/${a}/${m}`)).body;
    const salAtual = mesAtual.receitas.find((l: any) => l.descricao === 'Salário (Laura)');
    if (salAtual) expect(salAtual.valor_centavos).toBe(333140);

    // 13º como fixo vinculado, bloqueado para edição direta
    const recs = (await call('GET', '/recorrencias')).body.filter((r: any) => r.origem === 'decimo1' || r.origem === 'decimo2');
    if (hoje <= `${a}-12-20`) {
      expect(recs).toHaveLength(hoje <= `${a}-11-30` ? 2 : 1);
      const d = (await call('GET', `/pessoas/${laura.id}/trabalho`)).body.resumo.decimo;
      expect(d.primeira).toBe(Math.round(Math.round((d.salarioBase * d.avos) / 12) / 2));
      const bloq = await call('PUT', `/recorrencias/${recs[0].id}`, { descricao: 'x', tipo: 'receita', valor_previsto_centavos: 1, dia_mes: 1, meio: 'pix', inicio: hoje });
      expect(bloq.status).toBe(409);
    }
  });

  it('trabalho: férias registradas, simulação e rescisões', async () => {
    const laura = (await call('GET', '/pessoas')).body.find((x: any) => x.nome === 'Laura');
    expect((await call('POST', `/pessoas/${laura.id}/ferias`, { inicio: '2026-03-02', dias: 25, abono_dias: 10 })).status).toBe(400);
    const f = await call('POST', `/pessoas/${laura.id}/ferias`, { inicio: '2026-03-02', dias: 20, abono_dias: 10 });
    expect(f.status).toBe(201);

    const t = (await call('GET', `/pessoas/${laura.id}/trabalho`)).body;
    const p2025 = t.resumo.ferias.periodos.find((p: any) => p.inicio === '2025-02-01');
    expect(p2025.diasUsados).toBe(30);
    expect(p2025.diasSaldo).toBe(0);

    const sim = await call('GET', `/pessoas/${laura.id}/simular-ferias?dias=20&abono=10&inicio=2026-03-02`);
    expect(sim.body.abono).toBe(Math.round((400000 / 30) * 10));

    const sj = await call('GET', `/pessoas/${laura.id}/rescisao?tipo=sem_justa_causa&data=2026-10-19`);
    expect(sj.status).toBe(200);
    expect(sj.body.diasAviso).toBe(39);
    expect(sj.body.fgts.multa40).toBeGreaterThan(0);
    // período 2025-02 já gozado → sem férias vencidas
    expect(sj.body.verbas.some((v: any) => v.codigo === 'ferias_venc')).toBe(false);

    const pd = await call('GET', `/pessoas/${laura.id}/rescisao?tipo=pedido_demissao&data=2026-10-19`);
    expect(pd.body.dataSaida).toBe('2026-11-18');
    expect(pd.body.fgts.sacavel).toBe(0);

    expect((await call('DELETE', `/pessoas/${laura.id}/ferias/${f.body.id}`)).status).toBe(204);
    expect((await call('GET', `/pessoas/${laura.id}/rescisao?tipo=justa_causa&data=2020-01-01`)).status).toBe(400);
  });

  it('isolamento entre casas: outra casa não enxerga nada desta', async () => {
    const outraCasa = (await pool.query('insert into casas (nome) values ($1) returning id', ['Outra'])).rows[0].id;
    const outroEmail = `outro-${Date.now()}@teste.local`;
    await pool.query(`insert into usuarios (casa_id, email, nome, senha_hash) values ($1,$2,'Outro',$3)`,
      [outraCasa, outroEmail, await hashSenha('senha-de-teste-123')]);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: outroEmail, senha: 'senha-de-teste-123' } });
    const h = { authorization: `Bearer ${JSON.parse(login.body).token}` };
    expect((await app.inject({ method: 'GET', url: `/lancamentos/${compraId}`, headers: h })).statusCode).toBe(404);
    expect(JSON.parse((await app.inject({ method: 'GET', url: '/contas', headers: h })).body)).toEqual([]);
    expect(JSON.parse((await app.inject({ method: 'GET', url: '/pessoas', headers: h })).body)).toEqual([]);
    await pool.query('delete from casas where id = $1', [outraCasa]);
  });

  it('token sem casa (sessão antiga) é recusado', async () => {
    const velho = app.jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', email: 'x' } as any);
    expect((await app.inject({ method: 'GET', url: '/contas', headers: { authorization: `Bearer ${velho}` } })).statusCode).toBe(401);
  });
});

describe('casa e usuários', () => {
  const emailLaura = `laura-${Date.now()}@teste.local`;
  let laura: { id: string; pessoa_id: string };
  let hLaura: Record<string, string>;
  const comoLaura = async (method: string, url: string, payload?: unknown) => {
    const r = await app.inject({ method: method as any, url, payload: payload as any, headers: hLaura });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };

  it('admin cria a Laura ligada ao perfil existente; ela entra e precisa trocar a senha', async () => {
    const perfil = (await call('GET', '/pessoas')).body.find((p: any) => p.nome === 'Laura');
    const r = await call('POST', '/conta/usuarios', { nome: 'Laura Pâmela', email: emailLaura, senha: 'temporaria-123', pessoa_id: perfil.id });
    expect(r.status).toBe(201);
    expect(r.body.pessoa_nome).toBe('Laura');
    laura = r.body;
    expect((await call('POST', '/conta/usuarios', { nome: 'X', email: emailLaura, senha: 'temporaria-123' })).status).toBe(409);

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: emailLaura, senha: 'temporaria-123' } });
    expect(JSON.parse(login.body).usuario.trocar_senha).toBe(true);
    hLaura = { authorization: `Bearer ${JSON.parse(login.body).token}` };
    expect((await comoLaura('PUT', '/conta/senha', { atual: 'errada', nova: 'nova-senha-123' })).status).toBe(400);
    expect((await comoLaura('PUT', '/conta/senha', { atual: 'temporaria-123', nova: 'nova-senha-da-laura' })).status).toBe(200);
    expect((await comoLaura('GET', '/conta/eu')).body.trocar_senha).toBe(false);
  });

  it('Laura vê as finanças da casa e edita o próprio salário; não gerencia usuários', async () => {
    const contasAdmin = (await call('GET', '/contas')).body.map((c: any) => c.id).sort();
    const contasLaura = (await comoLaura('GET', '/contas')).body.map((c: any) => c.id).sort();
    expect(contasLaura).toEqual(contasAdmin);

    const eu = (await comoLaura('GET', '/conta/eu')).body;
    const sal = await comoLaura('POST', `/pessoas/${eu.pessoa_id}/salarios`, { vigencia: '2026-08-01', bruto_centavos: 310000 });
    expect(sal.status).toBe(201);

    expect((await comoLaura('GET', '/conta/usuarios')).status).toBe(403);
    expect((await comoLaura('POST', '/conta/usuarios', { nome: 'Y', email: 'y@y.com', senha: 'temporaria-123' })).status).toBe(403);
  });

  it('não deixa a casa sem admin; desativar corta o acesso na hora', async () => {
    const eu = (await call('GET', '/conta/eu')).body;
    const rebaixar = await call('PUT', `/conta/usuarios/${eu.id}`, { nome: eu.nome, papel: 'membro', pessoa_id: eu.pessoa_id, ativo: true });
    expect(rebaixar.status).toBe(409);

    const d = await call('PUT', `/conta/usuarios/${laura.id}`, { nome: 'Laura Pâmela', papel: 'membro', pessoa_id: laura.pessoa_id, ativo: false });
    expect(d.status).toBe(200);
    expect((await comoLaura('GET', '/contas')).status).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: emailLaura, senha: 'nova-senha-da-laura' } });
    expect(login.statusCode).toBe(401);

    // reativa com senha temporária definida pelo admin
    await call('PUT', `/conta/usuarios/${laura.id}`, { nome: 'Laura Pâmela', papel: 'membro', pessoa_id: laura.pessoa_id, ativo: true });
    expect((await call('PUT', `/conta/usuarios/${laura.id}/senha`, { senha: 'outra-temporaria' })).status).toBe(200);
    const l2 = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: emailLaura, senha: 'outra-temporaria' } });
    expect(JSON.parse(l2.body).usuario.trocar_senha).toBe(true);
  });
});

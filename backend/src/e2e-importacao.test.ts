// E2E da importação de fatura (Postgres real): prévia, duplicados, parcelas, confirmação, idempotência e desfazer.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { pool } from './core/db.js';
import { migrate } from './core/migrate.js';
import { hashSenha } from './core/auth.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let casaId: string, outraCasa: string;
const sufixo = Date.now();
type Cliente = (method: string, url: string, payload?: unknown) => Promise<{ status: number; body: any }>;
let igor: Cliente, intruso: Cliente;
let nubank: string, contaId: string, mercado: string, assinaturas: string, compras: string;

async function cliente(email: string): Promise<Cliente> {
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha: 'senha-de-teste-123' } });
  const h = { authorization: `Bearer ${JSON.parse(login.body).token}` };
  return async (method, url, payload) => {
    const r = await app.inject({ method: method as any, url, payload: payload as any, headers: h });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
}

// fatura de novembro/2026 do Nubank (fecha 3, vence 10): compras de 03/10 a 02/11
const CSV_NOV = `date,title,amount
2026-10-05,Supermercado Zaffari,387.45
2026-10-06,NETFLIX.COM,55.90
2026-10-07,Smart TV - Parcela 1/10,250.00
2026-07-15,Geladeira - Parcela 4/12,299.90
2026-10-08,Pagamento recebido,-1500.00
xx,Linha quebrada,10.00
2026-10-09,Padaria do Zé,12.50
2026-10-09,Padaria do Zé,12.50
`;

const faturaTotal = async (venc: string) =>
  Number((await pool.query(`select coalesce(sum(p.valor_centavos),0)::bigint t from parcelas p join faturas f on f.id = p.fatura_id
     where f.cartao_id = $1 and f.competencia = $2`, [nubank, `${venc}-01`])).rows[0].t);

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await migrate();
  const senha = await hashSenha('senha-de-teste-123');
  casaId = (await pool.query('insert into casas (nome) values ($1) returning id', ['Casa importação'])).rows[0].id;
  outraCasa = (await pool.query('insert into casas (nome) values ($1) returning id', ['Outra casa'])).rows[0].id;
  await pool.query('insert into usuarios (casa_id, email, nome, senha_hash, papel) values ($1,$2,$3,$4,$5)', [casaId, `igor-imp-${sufixo}@teste.local`, 'Igor', senha, 'admin']);
  await pool.query('insert into usuarios (casa_id, email, nome, senha_hash, papel) values ($1,$2,$3,$4,$5)', [outraCasa, `intruso-imp-${sufixo}@teste.local`, 'Intruso', senha, 'admin']);
  for (const [n, t] of [['Mercado', 'despesa'], ['Assinaturas', 'despesa'], ['Compras', 'despesa'], ['Salário', 'receita']]) {
    await pool.query('insert into categorias (casa_id, nome, tipo) values ($1,$2,$3)', [casaId, n, t]);
  }
  app = await buildApp();
  igor = await cliente(`igor-imp-${sufixo}@teste.local`);
  intruso = await cliente(`intruso-imp-${sufixo}@teste.local`);
  const cats = (await igor('GET', '/categorias')).body;
  mercado = cats.find((c: any) => c.nome === 'Mercado').id;
  assinaturas = cats.find((c: any) => c.nome === 'Assinaturas').id;
  compras = cats.find((c: any) => c.nome === 'Compras').id;
  contaId = (await igor('POST', '/contas', { nome: 'Corrente', tipo: 'corrente', saldo_inicial_centavos: 0 })).body.id;
  nubank = (await igor('POST', '/cartoes', { nome: 'Nubank', limite_centavos: 1000000, dia_fechamento: 3, dia_vencimento: 10, conta_pagamento_id: contaId })).body.id;
  // geladeira já cadastrada à mão (12x de 299,90 desde julho): a parcela 4/12 do arquivo é duplicada
  await igor('POST', '/lancamentos', { tipo: 'despesa', descricao: 'Geladeira', valor_centavos: 359880, data: '2026-07-15', meio: 'credito', cartao_id: nubank, parcelas_total: 12 });
  // padaria do dia 09 já lançada uma vez: no arquivo aparecem duas iguais → uma duplicada, uma nova
  await igor('POST', '/lancamentos', { tipo: 'despesa', descricao: 'Padaria', valor_centavos: 1250, data: '2026-10-09', meio: 'credito', cartao_id: nubank, categoria_id: mercado });
});

afterAll(async () => {
  await pool.query('delete from casas where id = any($1)', [[casaId, outraCasa]]);
  await app.close();
  await pool.end();
});

describe('importação de fatura', () => {
  let previa: any;
  let importacaoId: string;

  it('prévia: classifica cada linha e sugere categoria', async () => {
    const r = await igor('POST', '/importacoes/previa', { cartao_id: nubank, vencimento: '2026-11', conteudo: CSV_NOV, nome: 'nubank-nov.csv' });
    expect(r.status).toBe(200);
    previa = r.body;
    expect(previa.formato).toBe('csv');
    expect(previa.fatura).toMatchObject({ competencia: '2026-11-01', dataFechamento: '2026-11-03', dataVencimento: '2026-11-10' });
    const por = (d: string) => previa.itens.filter((i: any) => i.descricao === d);
    expect(por('Supermercado Zaffari')[0]).toMatchObject({ status: 'novo', categoria_id: mercado, valor_centavos: 38745 });
    expect(por('NETFLIX.COM')[0]).toMatchObject({ status: 'novo', categoria_id: assinaturas });
    expect(por('Smart TV')[0]).toMatchObject({ status: 'novo', parcela: { atual: 1, total: 10 }, plano: { valor_total: 250000, parcelas_total: 10, parcelas_pagas_antes: 0 } });
    expect(por('Geladeira')[0]).toMatchObject({ status: 'duplicado' });
    expect(por('Geladeira')[0].motivo).toMatch(/parcela 4\/12 já está nas faturas/);
    expect(por('Pagamento recebido')[0]).toMatchObject({ status: 'ignorado' });
    expect(por('Linha quebrada')[0]).toMatchObject({ status: 'erro' });
    expect(por('Padaria do Zé').map((i: any) => i.status)).toEqual(['duplicado', 'novo']);
    // histórico: "Padaria" foi lançada em Mercado → sugestão segue o que você usou
    expect(previa.contagem).toEqual({ novo: 4, duplicado: 2, ignorado: 1, erro: 1 });
    expect(previa.totais).toMatchObject({ novos: 38745 + 5590 + 25000 + 1250, arquivo_creditos: 150000 });
    // a fatura de novembro já tem a geladeira (4/12 = 29990) e a padaria (1250)
    expect(previa.fatura.total_atual_centavos).toBe(29990 + 1250);
  });

  it('fatura errada escolhida: sugere a do arquivo', async () => {
    const r = await igor('POST', '/importacoes/previa', { cartao_id: nubank, vencimento: '2026-10', conteudo: CSV_NOV });
    expect(r.body.fatura_sugerida).toBe('2026-11');
    expect(previa.fatura_sugerida).toBeNull(); // na certa, nada a sugerir
  });

  it('nada é gravado na prévia', async () => {
    expect((await pool.query('select count(*)::int n from lancamentos where casa_id = $1', [casaId])).rows[0].n).toBe(2);
  });

  it('confirmar grava tudo na fatura certa, parcelas futuras inclusive', async () => {
    const itens = previa.itens.filter((i: any) => i.status === 'novo')
      .map((i: any) => ({ data: i.data, descricao: i.descricao, valor_centavos: i.valor_centavos, parcela: i.parcela, categoria_id: i.categoria_id ?? compras }));
    const r = await igor('POST', '/importacoes', { cartao_id: nubank, vencimento: '2026-11', arquivo_nome: 'nubank-nov.csv', formato: 'csv', itens });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ criados: 4, competencia: '2026-11-01', total_centavos: 38745 + 5590 + 25000 + 1250 });
    importacaoId = r.body.importacao_id;
    expect(await faturaTotal('2026-11')).toBe(29990 + 1250 + 38745 + 5590 + 25000 + 1250);
    expect(await faturaTotal('2026-12')).toBe(29990 + 25000); // geladeira 5/12 + TV 2/10
    const tv = (await pool.query(`select parcelas_total, parcelas_pagas_antes, observacao, importacao_id from lancamentos where descricao = 'Smart TV' and casa_id = $1`, [casaId])).rows[0];
    expect(tv).toMatchObject({ parcelas_total: 10, parcelas_pagas_antes: 0, importacao_id: importacaoId });
    expect(tv.observacao).toMatch(/Importado de nubank-nov\.csv/);
  });

  it('importar o mesmo arquivo de novo não duplica nada', async () => {
    const r = await igor('POST', '/importacoes/previa', { cartao_id: nubank, vencimento: '2026-11', conteudo: CSV_NOV });
    expect(r.body.contagem.novo).toBe(0);
    expect(r.body.contagem.duplicado).toBe(6);
  });

  it('mês seguinte: "Parcela 2/10" da TV já existe; parcela de compra antiga vira compra com parcelas anteriores pagas', async () => {
    const dez = `data;descricao;valor\n07/11/2026;Smart TV - Parcela 2/10;250,00\n10/11/2026;Notebook Dell 3/6;500,00\n12/11/2026;Uber *Trip;23,40\n`;
    const r = await igor('POST', '/importacoes/previa', { cartao_id: nubank, vencimento: '2026-12', conteudo: dez });
    const st = Object.fromEntries(r.body.itens.map((i: any) => [i.descricao, i.status]));
    expect(st).toEqual({ 'Smart TV': 'duplicado', 'Notebook Dell': 'novo', 'Uber *Trip': 'novo' });
    const note = r.body.itens.find((i: any) => i.descricao === 'Notebook Dell');
    expect(note.plano).toMatchObject({ valor_total: 300000, parcelas_total: 6, parcelas_pagas_antes: 2, fora_da_fatura: false });
    await igor('POST', '/importacoes', {
      cartao_id: nubank, vencimento: '2026-12', formato: 'csv',
      itens: [{ data: note.data, descricao: note.descricao, valor_centavos: note.valor_centavos, parcela: note.parcela, categoria_id: compras }],
    });
    // parcela 3/6 em dezembro; 1 e 2 "pagas antes" não entram em fatura nenhuma; 4..6 nos meses seguintes
    const ps = (await pool.query(
      `select p.numero, f.competencia::text c from parcelas p join faturas f on f.id = p.fatura_id join lancamentos l on l.id = p.lancamento_id
        where l.descricao = 'Notebook Dell' and l.casa_id = $1 order by p.numero`, [casaId])).rows;
    expect(ps).toEqual([{ numero: 3, c: '2026-12-01' }, { numero: 4, c: '2027-01-01' }, { numero: 5, c: '2027-02-01' }, { numero: 6, c: '2027-03-01' }]);
  });

  it('OFX e JSON pela mesma rota', async () => {
    const ofx = `OFXHEADER:100\n<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20261015<TRNAMT>-89.90<MEMO>DROGARIA X</BANKTRANLIST></OFX>`;
    const a = await igor('POST', '/importacoes/previa', { cartao_id: nubank, vencimento: '2026-11', conteudo: ofx, nome: 'fatura.ofx' });
    expect(a.body).toMatchObject({ formato: 'ofx', contagem: { novo: 1 } });
    expect(a.body.itens[0]).toMatchObject({ descricao: 'DROGARIA X', valor_centavos: 8990 });
    const j = await igor('POST', '/importacoes/previa', { cartao_id: nubank, vencimento: '2026-11', conteudo: '[{"data":"2026-10-20","descricao":"Livraria","valor":"45,00"}]' });
    expect(j.body).toMatchObject({ formato: 'json', contagem: { novo: 1 } });
  });

  it('erros legíveis e isolamento entre casas', async () => {
    const e = await igor('POST', '/importacoes/previa', { cartao_id: nubank, vencimento: '2026-11', conteudo: 'foo;bar\n1;2' });
    expect(e.status).toBe(400);
    expect(e.body.erro).toMatch(/Não reconheci as colunas/);
    expect((await intruso('POST', '/importacoes/previa', { cartao_id: nubank, vencimento: '2026-11', conteudo: CSV_NOV })).status).toBe(404);
    expect((await intruso('DELETE', `/importacoes/${importacaoId}`)).status).toBe(404);
    expect((await igor('POST', '/importacoes', { cartao_id: nubank, vencimento: '2026-11', formato: 'csv', itens: [] })).status).toBe(400);
  });

  it('histórico lista os lotes', async () => {
    const h = (await igor('GET', `/importacoes?cartao_id=${nubank}`)).body;
    expect(h.length).toBe(2);
    expect(h.find((x: any) => x.id === importacaoId)).toMatchObject({ qtd: 4, ainda_existentes: 4, arquivo_nome: 'nubank-nov.csv', cartao_nome: 'Nubank', criado_por_nome: 'Igor' });
  });

  it('desfazer remove o lote inteiro; com fatura paga, bloqueia', async () => {
    // paga a fatura de dezembro (onde cai a TV 2/10): desfazer o lote de novembro precisa ser bloqueado
    const fatDez = (await pool.query(`select id from faturas where cartao_id = $1 and competencia = '2026-12-01'`, [nubank])).rows[0].id;
    await igor('PUT', `/faturas/${fatDez}/pagamento`, { valor_pago_centavos: 1000, pago_em: '2026-12-10', conta_pagamento_id: contaId });
    const bloq = await igor('DELETE', `/importacoes/${importacaoId}`);
    expect(bloq.status).toBe(409);
    expect((await pool.query('select count(*)::int n from lancamentos where importacao_id = $1', [importacaoId])).rows[0].n).toBe(4); // nada saiu
    await igor('PUT', `/faturas/${fatDez}/pagamento`, { valor_pago_centavos: 0, pago_em: null });

    const ok = await igor('DELETE', `/importacoes/${importacaoId}`);
    expect(ok.body).toEqual({ removidos: 4 });
    expect(await faturaTotal('2026-11')).toBe(29990 + 1250); // volta ao que era antes
    expect((await igor('GET', '/importacoes')).body.some((x: any) => x.id === importacaoId)).toBe(false);
  });
});

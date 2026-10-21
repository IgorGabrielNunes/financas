import { describe, expect, it } from 'vitest';
import { extrairParcela, lerArquivo, lerData, lerValor } from './leitor.js';

describe('valores', () => {
  it.each([
    ['1.234,56', 123456], ['1234.56', 123456], ['1,234.56', 123456], ['R$ -50,00', -5000], ['(50,00)', -5000],
    ['-R$ 12,30', -1230], ['50,00-', -5000], ['12.5', 1250], ['1.234', 123400], ['0,99', 99], ['+3,00', 300], [12.5, 1250],
  ])('%s → %i', (v, c) => expect(lerValor(v)).toBe(c));
  it('lixo vira null', () => { expect(lerValor('abc')).toBeNull(); expect(lerValor('')).toBeNull(); });
});

describe('datas', () => {
  it.each([
    ['2026-10-15', { dia: 15, mes: 10, ano: 2026 }], ['15/10/2026', { dia: 15, mes: 10, ano: 2026 }], ['15/10/26', { dia: 15, mes: 10, ano: 2026 }],
    ['5-1-2026', { dia: 5, mes: 1, ano: 2026 }], ['20261015000000[-3:BRT]', { dia: 15, mes: 10, ano: 2026 }],
    ['15/10', { dia: 15, mes: 10, ano: null }], ['15 OUT', { dia: 15, mes: 10, ano: null }], ['03 de dez. de 2025', { dia: 3, mes: 12, ano: 2025 }],
  ])('%s', (v, d) => expect(lerData(v)).toEqual(d));
  it('inválidas', () => { expect(lerData('32/10/2026')).toBeNull(); expect(lerData('ontem')).toBeNull(); });
});

describe('parcela na descrição', () => {
  it.each([
    ['Geladeira Brastemp - Parcela 3/12', 'Geladeira Brastemp', { atual: 3, total: 12 }],
    ['MAGALU PARC 03/10', 'MAGALU', { atual: 3, total: 10 }],
    ['Loja X (2/6)', 'Loja X', { atual: 2, total: 6 }],
    ['NETSHOES 01/03', 'NETSHOES', { atual: 1, total: 3 }],
    ['Curso 4 de 12', 'Curso', { atual: 4, total: 12 }],
  ])('%s', (d, limpa, p) => expect(extrairParcela(d)).toEqual({ descricao: limpa, parcela: p }));
  it('não confunde com outras barras', () => {
    expect(extrairParcela('Posto 24/7').parcela).toBeNull();      // 24 > 7
    expect(extrairParcela('Uber *Trip').parcela).toBeNull();
    expect(extrairParcela('Compra 5/60').parcela).toBeNull();     // total > 48
  });
});

describe('CSV', () => {
  it('Nubank (date,title,amount): pagamento negativo continua negativo', () => {
    const r = lerArquivo('date,title,amount\n2026-10-02,Supermercado Zaffari,387.45\n2026-10-05,Geladeira - Parcela 3/12,299.90\n2026-10-08,Pagamento recebido,-1500.00\n');
    expect(r.formato).toBe('csv');
    expect(r.sinal_invertido).toBe(false);
    expect(r.linhas.map((l) => [l.descricao, l.valor_centavos, l.parcela])).toEqual([
      ['Supermercado Zaffari', 38745, null], ['Geladeira', 29990, { atual: 3, total: 12 }], ['Pagamento recebido', -150000, null],
    ]);
    expect(r.linhas[0].data).toEqual({ dia: 2, mes: 10, ano: 2026 });
  });

  it('Nubank antigo com categoria', () => {
    const r = lerArquivo('date,category,title,amount\n2026-10-02,supermercado,Zaffari,100.00\n');
    expect(r.linhas[0]).toMatchObject({ descricao: 'Zaffari', categoria_texto: 'supermercado', valor_centavos: 10000 });
  });

  it('C6 (;) com valor em US$ e em R$, coluna de parcela e aspas', () => {
    const csv = 'Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)\n'
      + '15/09/2026;IGOR;1234;Eletrônico;"KABUM; LOJA";2/5;0;0;"1.199,80"\n'
      + '20/10/2026;IGOR;1234;Serviços;NETFLIX;Única;0;0;55,90\n';
    const r = lerArquivo(csv);
    expect(r.linhas.map((l) => [l.descricao, l.valor_centavos, l.parcela, l.categoria_texto])).toEqual([
      ['KABUM; LOJA', 119980, { atual: 2, total: 5 }, 'Eletrônico'], ['NETFLIX', 5590, null, 'Serviços'],
    ]);
  });

  it('Inter: "Lançamento", "R$ ..." e acentos/latin1 já decodificado', () => {
    const r = lerArquivo('"Data","Lançamento","Categoria","Tipo","Valor"\n"01/10/2026","IFOOD *RESTAURANTE","RESTAURANTES","Compra à vista","R$ 45,90"\n');
    expect(r.linhas[0]).toMatchObject({ descricao: 'IFOOD *RESTAURANTE', valor_centavos: 4590, categoria_texto: 'RESTAURANTES' });
  });

  it('compras negativas (maioria) invertem o sinal', () => {
    const r = lerArquivo('data;descricao;valor\n01/10/2026;Mercado;-100,00\n02/10/2026;Posto;-200,00\n03/10/2026;Pagamento;300,00\n');
    expect(r.sinal_invertido).toBe(true);
    expect(r.linhas.map((l) => l.valor_centavos)).toEqual([10000, 20000, -30000]);
  });

  it('sem cabeçalho', () => {
    const r = lerArquivo('15/10/2026,Padaria,12,50\n16/10/2026,Posto,"200,00"\n');
    expect(r.avisos[0]).toMatch(/sem cabeçalho/);
    // vírgula separa colunas E decimais: "12,50" sem aspas é reconstruído
    expect(r.linhas.map((l) => [l.descricao, l.valor_centavos])).toEqual([['Padaria', 1250], ['Posto', 20000]]);
  });

  it('cabeçalho com vírgula e valor decimal com vírgula sem aspas', () => {
    const r = lerArquivo('data,descricao,valor\n15/10/2026,Padaria,12,50\n15/10/2026,Mercado,100\n');
    expect(r.linhas.map((l) => l.valor_centavos)).toEqual([1250, 10000]);
  });

  it('linha inválida não derruba o arquivo', () => {
    const r = lerArquivo('data;descricao;valor\nxx;Mercado;10,00\n01/10/2026;Posto;abc\n01/10/2026;Ok;5,00\n');
    expect(r.linhas.map((l) => l.erro)).toEqual(['Data inválida: "xx"', 'Valor inválido: "abc"', null]);
  });

  it('cabeçalho desconhecido explica o que falta', () => {
    expect(() => lerArquivo('foo;bar\n1;2\n')).toThrow(/Não reconheci as colunas/);
  });
});

describe('OFX', () => {
  it('cartão: compras negativas viram gasto; pagamento vira crédito', () => {
    const ofx = `OFXHEADER:100
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003120000[-3:BRT]<TRNAMT>-89.90<FITID>1<MEMO>DROGARIA SAO JOAO
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005<TRNAMT>-150.00<FITID>2<MEMO>MAGAZINE LUIZA PARC 02/04
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261010<TRNAMT>1000.00<FITID>3<NAME>PAGAMENTO EFETUADO
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    const r = lerArquivo(ofx);
    expect(r.formato).toBe('ofx');
    expect(r.linhas.map((l) => [l.descricao, l.valor_centavos, l.parcela])).toEqual([
      ['DROGARIA SAO JOAO', 8990, null], ['MAGAZINE LUIZA', 15000, { atual: 2, total: 4 }], ['PAGAMENTO EFETUADO', -100000, null],
    ]);
  });
});

describe('JSON', () => {
  it('lista simples, objeto com "itens", parcela explícita e valor em centavos', () => {
    const a = lerArquivo('[{"data":"2026-10-01","descricao":"Mercado","valor":"123,45"},{"date":"02/10/2026","title":"TV","amount":250,"parcela":"2/10"}]');
    expect(a.linhas.map((l) => [l.descricao, l.valor_centavos, l.parcela])).toEqual([['Mercado', 12345, null], ['TV', 25000, { atual: 2, total: 10 }]]);
    const b = lerArquivo('{"itens":[{"data":"2026-10-01","descricao":"Sofá","valor_centavos":50000,"parcela_atual":1,"parcelas_total":5}]}');
    expect(b.linhas[0]).toMatchObject({ valor_centavos: 50000, parcela: { atual: 1, total: 5 } });
  });
  it('JSON inválido explica', () => expect(() => lerArquivo('{"itens": 3}')).toThrow(/lista de compras/));
});

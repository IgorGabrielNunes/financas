import { describe, expect, it } from 'vitest';
import { agoraSP, avisosCasa, avisosDevidos, emSilencio, type ConfigAvisos, type DadosDoDia } from './dominio.js';
import { paraTelegramHtml } from './provedor.js';

const cfg = (o: Partial<ConfigAvisos> = {}): ConfigAvisos => ({
  user_id: 'u1', nome: 'Igor Gabriel', discreto: false, resumo_hora: '07:00', antecedencia_min: 60,
  avisar_treino: true, avisar_remedios: true, avisar_consultas: true, avisar_entrevistas: true, avisar_refeicoes: true,
  silencio_inicio: '22:30', silencio_fim: '06:30', ...o,
});
const dados = (o: Partial<DadosDoDia> = {}): DadosDoDia => ({
  data: '2026-10-20', tarefas: [], doses: [], consultas: [], entrevistas: [], treinos: [], refeicoes: [], ...o,
});
const chaves = (xs: { chave: string }[]) => xs.map((x) => x.chave);

describe('silêncio', () => {
  it('atravessa a meia-noite', () => {
    expect(emSilencio('23:00', '22:00', '07:00')).toBe(true);
    expect(emSilencio('06:59', '22:00', '07:00')).toBe(true);
    expect(emSilencio('07:00', '22:00', '07:00')).toBe(false);
    expect(emSilencio('13:00', '12:00', '14:00')).toBe(true);
    expect(emSilencio('13:00', null, null)).toBe(false);
  });
  it('nada sai durante o silêncio', () => {
    const d = dados({ doses: [{ remedio_id: 'r', nome: 'Vitamina D', dosagem: null, horario: '23:00', tomada: false }] });
    expect(avisosDevidos(cfg(), d, '23:05')).toEqual([]);
  });
});

describe('resumo do dia', () => {
  const d = dados({
    tarefas: [{ titulo: 'Pagar boleto', atrasada: true }, { titulo: 'Lavar louça', atrasada: false }],
    treinos: [{ ficha_id: 'f', nome: 'Treino A', foco: 'Peito', horario: '18:30', exercicios: 6, feito: false, rodizio: false }],
    doses: [{ remedio_id: 'r', nome: 'Vitamina D', dosagem: '1 cápsula', horario: '08:00', tomada: false }],
    consultas: [{ id: 'c', titulo: 'Cardiologista', tipo: 'consulta', data: '2026-10-20', hora: '14:30', local: null }],
  });
  it('sai no horário e até 3h depois (cron atrasado), não antes', () => {
    expect(avisosDevidos(cfg(), d, '06:55').some((a) => a.tipo === 'resumo')).toBe(false);
    expect(avisosDevidos(cfg(), d, '07:00').find((a) => a.tipo === 'resumo')?.chave).toBe('resumo:2026-10-20');
    expect(avisosDevidos(cfg(), d, '09:55').some((a) => a.tipo === 'resumo')).toBe(true);
    expect(avisosDevidos(cfg(), d, '10:00').some((a) => a.tipo === 'resumo')).toBe(false);
  });
  it('lista treino, tarefas, remédios e compromissos', () => {
    const t = avisosDevidos(cfg(), d, '07:00').find((a) => a.tipo === 'resumo')!.texto;
    expect(t).toContain('Bom dia, Igor!');
    expect(t).toContain('Treino A (Peito) às 18:30');
    expect(t).toContain('2 tarefas (1 atrasada): Pagar boleto, Lavar louça');
    expect(t).toContain('Vitamina D 08:00');
    expect(t).toContain('14:30 Cardiologista');
  });
  it('modo discreto esconde nomes (consultas e remédios são dados de saúde)', () => {
    const t = avisosDevidos(cfg({ discreto: true }), d, '07:00').find((a) => a.tipo === 'resumo')!.texto;
    expect(t).not.toMatch(/Cardiologista|Vitamina|Pagar boleto/);
    expect(t).toContain('1 dose de remédio');
  });
  it('sem resumo configurado, não sai', () => {
    expect(avisosDevidos(cfg({ resumo_hora: null }), d, '07:00').some((a) => a.tipo === 'resumo')).toBe(false);
  });
});

describe('avisos na hora', () => {
  it('treino no horário da ficha, não se já foi feito', () => {
    const t = { ficha_id: 'f', nome: 'Treino B', foco: 'Costas', horario: '18:30', exercicios: 5, feito: false, rodizio: false };
    expect(chaves(avisosDevidos(cfg({ resumo_hora: null }), dados({ treinos: [t] }), '18:30'))).toEqual(['treino:f:2026-10-20']);
    expect(avisosDevidos(cfg({ resumo_hora: null }), dados({ treinos: [t] }), '18:35')[0].texto).toContain('*Treino B* (Costas) — 5 exercícios');
    expect(avisosDevidos(cfg(), dados({ treinos: [{ ...t, feito: true }] }), '18:30')).toEqual([]);
    expect(avisosDevidos(cfg({ avisar_treino: false }), dados({ treinos: [t] }), '18:30')).toEqual([]);
    expect(avisosDevidos(cfg(), dados({ treinos: [t] }), '18:50')).toEqual([]); // passou a janela
  });

  it('doses do mesmo horário viram um aviso; tomada não avisa', () => {
    const ds = [
      { remedio_id: 'b', nome: 'Ômega 3', dosagem: '2 cápsulas', horario: '12:30', tomada: false },
      { remedio_id: 'a', nome: 'Vitamina C', dosagem: null, horario: '12:30', tomada: false },
      { remedio_id: 'c', nome: 'Outro', dosagem: null, horario: '12:30', tomada: true },
    ];
    const r = avisosDevidos(cfg(), dados({ doses: ds }), '12:35');
    expect(chaves(r)).toEqual(['doses:2026-10-20:12:30:a,b']);
    expect(r[0].texto).toBe('💊 12:30 — Ômega 3 (2 cápsulas), Vitamina C');
  });

  it('consulta e entrevista com antecedência, só no dia e antes do horário', () => {
    const d = dados({
      consultas: [{ id: 'c1', titulo: 'Dentista', tipo: 'odonto', data: '2026-10-20', hora: '15:00', local: 'Centro' }],
      entrevistas: [{ id: 'e1', empresa: 'Fintech X', etapa: 'tecnica', data: '2026-10-20', hora: '10:00', link: 'https://meet' }],
    });
    expect(chaves(avisosDevidos(cfg({ resumo_hora: null }), d, '09:00'))).toEqual(['entrevista:e1:2026-10-20']);
    expect(avisosDevidos(cfg({ resumo_hora: null }), d, '09:00')[0].texto).toContain('entrevista técnica com *Fintech X*\nhttps://meet');
    expect(chaves(avisosDevidos(cfg({ resumo_hora: null }), d, '14:10'))).toEqual(['consulta:c1:2026-10-20']);
    expect(avisosDevidos(cfg({ resumo_hora: null }), d, '15:00')).toEqual([]); // já começou
    expect(avisosDevidos(cfg({ resumo_hora: null, antecedencia_min: 30 }), d, '14:10')).toEqual([]);
  });

  it('refeição só com "lembrar" e não feita', () => {
    const rs = [
      { id: 'r1', nome: 'Almoço', horario: '12:00', lembrar: true, feita: false },
      { id: 'r2', nome: 'Lanche', horario: '12:00', lembrar: false, feita: false },
    ];
    expect(chaves(avisosDevidos(cfg({ resumo_hora: null }), dados({ refeicoes: rs }), '12:00'))).toEqual(['refeicao:r1:2026-10-20']);
    expect(avisosDevidos(cfg({ avisar_refeicoes: false }), dados({ refeicoes: rs }), '12:00')).toEqual([]);
  });
});

describe('grupo da casa', () => {
  const base = { casa_id: 'c', resumo_hora: '08:00', avisar_tarefas: true, avisar_contas: true, dias_antes_contas: 1 };
  it('só sai se houver algo e no horário', () => {
    expect(avisosCasa(base, { data: '2026-10-20', tarefas: [], contas: [] }, '08:00')).toEqual([]);
    const d = {
      data: '2026-10-20',
      tarefas: [{ titulo: 'Lavar louça', responsavel: 'Laura Pâmela', atrasada: false }],
      contas: [
        { descricao: 'Luz', valor_centavos: 21000, vencimento: '2026-10-21', tipo: 'conta' as const },
        { descricao: 'Nubank', valor_centavos: 45050, vencimento: '2026-10-20', tipo: 'fatura' as const },
      ],
    };
    expect(avisosCasa(base, d, '07:55')).toEqual([]);
    const [a] = avisosCasa(base, d, '08:05');
    expect(a.chave).toBe('casa:resumo:2026-10-20');
    expect(a.texto).toContain('• Lavar louça — Laura');
    expect(a.texto.indexOf('Fatura Nubank')).toBeLessThan(a.texto.indexOf('Luz')); // por vencimento
    expect(a.texto).toMatch(/Fatura Nubank — R\$\s?450,50 \(hoje\)/);
    expect(a.texto).toMatch(/Luz — R\$\s?210,00 \(amanhã\)/);
    expect(a.texto).toMatch(/Total: \*R\$\s?660,50\*/);
  });
});

describe('utilitários', () => {
  it('agora em São Paulo a partir de UTC', () => {
    expect(agoraSP(new Date('2026-10-20T02:30:00Z'))).toEqual({ data: '2026-10-19', hora: '23:30' });
  });
  it('negrito do WhatsApp vira HTML no Telegram, escapando o resto', () => {
    expect(paraTelegramHtml('Às *14:30* <script> & ok')).toBe('Às <b>14:30</b> &lt;script&gt; &amp; ok');
  });
});

// E2E dos módulos pessoais (Postgres real). Cria uma casa com dois usuários e limpa ao final.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { pool } from './core/db.js';
import { migrate } from './core/migrate.js';
import { hashSenha } from './core/auth.js';
import { diaSemana } from './modulos/tarefas/dominio.js';
import { hojeSP, somarDias } from './core/datas.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let casaId: string;
const hoje = hojeSP();
const sufixo = Date.now();
type Cliente = (method: string, url: string, payload?: unknown) => Promise<{ status: number; body: any }>;
let igor: Cliente, laura: Cliente;

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
  casaId = (await pool.query('insert into casas (nome) values ($1) returning id', ['Casa módulos'])).rows[0].id;
  const senha = await hashSenha('senha-de-teste-123');
  for (const [nome, papel] of [['Igor', 'admin'], ['Laura', 'membro']]) {
    await pool.query('insert into usuarios (casa_id, email, nome, senha_hash, papel) values ($1,$2,$3,$4,$5)',
      [casaId, `${nome.toLowerCase()}-${sufixo}@teste.local`, nome, senha, papel]);
  }
  app = await buildApp();
  igor = await cliente(`igor-${sufixo}@teste.local`);
  laura = await cliente(`laura-${sufixo}@teste.local`);
});

afterAll(async () => {
  await pool.query('delete from casas where id = $1', [casaId]);
  await app.close();
  await pool.end();
});

describe('tarefas', () => {
  let limpeza: string, avulsa: string, diaria: string;

  it('cria as áreas padrão no primeiro acesso', async () => {
    const r = await igor('GET', '/tarefas/areas');
    expect(r.body.map((a: any) => a.nome)).toEqual(['Casa', 'Limpeza', 'Estudar', 'Programar', 'Saúde', 'Trabalho', 'Pessoal']);
    limpeza = r.body.find((a: any) => a.nome === 'Limpeza').id;
  });

  it('tarefa privada não aparece para a Laura; compartilhada aparece', async () => {
    avulsa = (await igor('POST', '/tarefas', { titulo: 'Estudar Vue', data: hoje })).body.id;
    const casa = await igor('POST', '/tarefas', { titulo: 'Limpar banheiro', area_id: limpeza, compartilhada: true, data: hoje });
    expect(casa.status).toBe(201);
    const agendaLaura = (await laura('GET', `/tarefas/agenda?de=${hoje}&ate=${hoje}`)).body.map((t: any) => t.titulo);
    expect(agendaLaura).toContain('Limpar banheiro');
    expect(agendaLaura).not.toContain('Estudar Vue');
    expect((await laura('GET', `/tarefas/${avulsa}`)).status).toBe(404);
    // Laura não pode usar a área do Igor
    expect((await laura('POST', '/tarefas', { titulo: 'x', area_id: limpeza })).status).toBe(404);
    // Laura conclui a compartilhada; Igor vê como feita por ela
    expect((await laura('POST', `/tarefas/${casa.body.id}/concluir`, {})).status).toBe(200);
    const itemIgor = (await igor('GET', `/tarefas/agenda?de=${hoje}&ate=${hoje}`)).body.find((t: any) => t.id === casa.body.id);
    expect(itemIgor.feita).toBe(true);
    // Laura não exclui tarefa que não criou
    expect((await laura('DELETE', `/tarefas/${casa.body.id}`)).status).toBe(400);
  });

  it('repetida: ocorrências, conclusão por data, sequência e validação de dia', async () => {
    const r = await igor('POST', '/tarefas', { titulo: 'Programar 1h', repeticao: 'diaria', data: somarDias(hoje, -3) });
    diaria = r.body.id;
    for (const d of [-3, -2, -1]) {
      expect((await igor('POST', `/tarefas/${diaria}/concluir`, { data: somarDias(hoje, d) })).status).toBe(200);
    }
    const lista = (await igor('GET', '/tarefas')).body.find((t: any) => t.id === diaria);
    expect(lista.sequencia).toBe(3);
    expect(lista.descricao_repeticao).toBe('Todo dia');
    const semana = (await igor('GET', `/tarefas/agenda?de=${somarDias(hoje, -3)}&ate=${somarDias(hoje, 3)}`)).body.filter((t: any) => t.id === diaria);
    expect(semana).toHaveLength(7);
    expect(semana.filter((t: any) => t.feita)).toHaveLength(3);

    const outroDia = (diaSemana(hoje) + 1) % 7;
    const sem = await igor('POST', '/tarefas', { titulo: 'Academia', repeticao: 'semanal', dias_semana: [outroDia], data: hoje });
    expect((await igor('POST', `/tarefas/${sem.body.id}/concluir`, { data: hoje })).status).toBe(400);
    expect((await igor('POST', '/tarefas', { titulo: 'x', repeticao: 'semanal', dias_semana: [] })).status).toBe(400);
  });

  it('avulsa atrasada aparece hoje até ser feita; histórico conta por área', async () => {
    const atrasada = (await igor('POST', '/tarefas', { titulo: 'Pagar boleto', data: somarDias(hoje, -2), area_id: (await igor('GET', '/tarefas/areas')).body[0].id })).body.id;
    let item = (await igor('GET', `/tarefas/agenda?de=${hoje}&ate=${hoje}`)).body.find((t: any) => t.id === atrasada);
    expect(item.atrasada).toBe(true);
    await igor('POST', `/tarefas/${atrasada}/concluir`, {});
    item = (await igor('GET', `/tarefas/agenda?de=${hoje}&ate=${hoje}`)).body.find((t: any) => t.id === atrasada);
    expect(item.feita).toBe(true);
    const hist = (await igor('GET', '/tarefas/historico')).body;
    expect(hist.total).toBeGreaterThanOrEqual(5); // 3 da diária + boleto + banheiro (compartilhada)
    expect(hist.por_area.find((a: any) => a.area === 'Casa').qtd).toBe(1);
  });
});

describe('notas', () => {
  it('etiquetas, busca, fixada primeiro e privacidade', async () => {
    await igor('POST', '/notas', { titulo: 'Ideias Pulse', conteudo: 'alertas por e-mail', etiquetas: ['Pulse', 'pulse', 'ideias'] });
    const fixa = await igor('POST', '/notas', { titulo: 'Senha do wifi', conteudo: 'na geladeira', fixada: true });
    const lista = (await igor('GET', '/notas')).body;
    expect(lista[0].id).toBe(fixa.body.id);
    expect(lista.find((n: any) => n.titulo === 'Ideias Pulse').etiquetas).toEqual(['pulse', 'ideias']);
    expect((await igor('GET', '/notas?q=e-mail')).body).toHaveLength(1);
    expect((await igor('GET', '/notas?etiqueta=ideias')).body).toHaveLength(1);
    expect((await igor('GET', '/notas-etiquetas')).body[0]).toEqual({ etiqueta: 'ideias', qtd: 1 });
    expect((await laura('GET', '/notas')).body).toEqual([]);
    expect((await laura('GET', `/notas/${fixa.body.id}`)).status).toBe(404);
    expect((await laura('PATCH', `/notas/${fixa.body.id}`, { titulo: 'hack' })).status).toBe(404);
  });
});

describe('estudos', () => {
  it('média ponderada, quanto falta e horas', async () => {
    const curso = (await igor('POST', '/estudos/cursos', { tipo: 'faculdade', nome: 'ADS', instituicao: 'Uninter', media_aprovacao: 7 })).body;
    const disc = (await igor('POST', '/estudos/disciplinas', { curso_id: curso.id, nome: 'Banco de Dados', periodo: '2026/2' })).body;
    await igor('POST', '/estudos/avaliacoes', { disciplina_id: disc.id, tipo: 'apol', titulo: 'APOL 1', peso: 1, nota: 80, nota_maxima: 100 });
    await igor('POST', '/estudos/avaliacoes', { disciplina_id: disc.id, tipo: 'prova', titulo: 'Prova objetiva', peso: 2, data: somarDias(hoje, 5) });
    expect((await igor('POST', '/estudos/avaliacoes', { disciplina_id: disc.id, titulo: 'x', nota: 11 })).status).toBe(400);
    await igor('POST', '/estudos/sessoes', { data: hoje, minutos: 90, disciplina_id: disc.id });
    await igor('POST', '/estudos/sessoes', { data: somarDias(hoje, -10), minutos: 30 });

    const r = (await igor('GET', '/estudos/resumo')).body;
    const bd = r.disciplinas.find((d: any) => d.id === disc.id);
    expect(bd.media).toBe(8);
    expect(bd.situacao).toBe('cursando');
    expect(bd.precisa_nas_restantes).toBe(6.5); // (7×3 − 8) / 2
    expect(r.minutos.semana).toBe(90);
    expect(r.proximas_avaliacoes[0].titulo).toBe('Prova objetiva');
    // Laura não consegue lançar avaliação na disciplina do Igor
    expect((await laura('POST', '/estudos/avaliacoes', { disciplina_id: disc.id, titulo: 'x' })).status).toBe(404);
  });
});

describe('saúde', () => {
  it('doses do dia, IMC e variação de peso, consultas', async () => {
    const rem = (await igor('POST', '/saude/remedios', { nome: 'Vitamina D', dosagem: '1 cápsula', horarios: ['20:00', '08:00', '08:00'] })).body;
    expect(rem.horarios).toEqual(['08:00', '20:00']);
    expect((await igor('POST', `/saude/remedios/${rem.id}/doses`, { horario: '12:00' })).status).toBe(400);
    await igor('POST', `/saude/remedios/${rem.id}/doses`, { horario: '08:00' });
    await igor('POST', '/saude/medidas', { data: somarDias(hoje, -40), peso_kg: 82, altura_cm: 178 });
    await igor('POST', '/saude/medidas', { data: hoje, peso_kg: 80 });
    await igor('POST', '/saude/consultas', { titulo: 'Clínico geral', data: somarDias(hoje, 3), hora: '14:30' });
    await igor('POST', '/saude/treinos', { data: hoje, tipo: 'corrida', duracao_min: 30, distancia_km: 5 });

    const r = (await igor('GET', '/saude/resumo')).body;
    expect(r.doses_hoje.map((d: any) => [d.horario, d.tomada])).toEqual([['08:00', true], ['20:00', false]]);
    expect(r.peso.atual).toBe(80);
    expect(r.peso.variacao_30d).toBe(-2);
    expect(r.peso.imc).toEqual({ valor: 25.2, faixa: 'sobrepeso' });
    expect(r.proximas_consultas[0].titulo).toBe('Clínico geral');
    expect(r.treinos_semana[0]).toMatchObject({ tipo: 'corrida', minutos: 30 });
    expect((await laura('GET', '/saude/resumo')).body.doses_hoje).toEqual([]);
  });
});

describe('projetos', () => {
  it('quadro, mover card com ordem fracionária, marcos e colunas por tipo', async () => {
    const p = (await igor('POST', '/projetos', { nome: 'Pulse', tipo: 'software', status: 'andamento', stack: ['Vue', 'Node'], repo_url: 'https://github.com/x/pulse' })).body;
    const m = (await igor('POST', '/projetos-marcos', { projeto_id: p.id, nome: 'v1.0 MVP', data_alvo: somarDias(hoje, 10) })).body;
    const a = (await igor('POST', '/projetos-cards', { projeto_id: p.id, titulo: 'Login', tipo: 'funcionalidade', estimativa_pontos: 3, marco_id: m.id })).body;
    const b = (await igor('POST', '/projetos-cards', { projeto_id: p.id, titulo: 'Crash no dashboard', tipo: 'bug', prioridade: 1 })).body;
    const c = (await igor('POST', '/projetos-cards', { projeto_id: p.id, titulo: 'Alertas', tipo: 'funcionalidade', estimativa_pontos: 5 })).body;
    expect([a.ordem, b.ordem, c.ordem]).toEqual([1, 2, 3]);
    expect((await igor('POST', '/projetos-cards', { projeto_id: p.id, titulo: 'x', estimativa_pontos: 4 })).status).toBe(400);

    // c vai para antes de b na mesma coluna
    const movido = (await igor('PATCH', `/projetos-cards/${c.id}/mover`, { status: 'a_fazer', antes_de: b.id })).body;
    expect(movido.ordem).toBeGreaterThan(1);
    expect(movido.ordem).toBeLessThan(2);
    await igor('PATCH', `/projetos-cards/${a.id}/mover`, { status: 'feito' });

    const q = (await igor('GET', `/projetos/${p.id}/quadro`)).body;
    expect(q.colunas).toEqual(['backlog', 'a_fazer', 'fazendo', 'revisao', 'feito']);
    expect(q.cards.filter((x: any) => x.status === 'a_fazer').map((x: any) => x.titulo)).toEqual(['Alertas', 'Crash no dashboard']);
    expect(q.pontos).toEqual({ total: 8, feitos: 3 });
    expect(q.marcos[0]).toMatchObject({ nome: 'v1.0 MVP', cards_total: 1, cards_feitos: 1 });
    // editar um card (PUT completo) não pode mandá-lo para o fim da coluna nem reescrever a data de conclusão
    const alertas = q.cards.find((x: any) => x.titulo === 'Alertas');
    const editado = (await igor('PUT', `/projetos-cards/${alertas.id}`, { projeto_id: p.id, titulo: 'Alertas por e-mail', status: 'a_fazer', tipo: 'funcionalidade', estimativa_pontos: 5 })).body;
    expect(Number(editado.ordem)).toBe(Number(alertas.ordem));
    const feitoAntes = q.cards.find((x: any) => x.id === a.id);
    const feitoDepois = (await igor('PUT', `/projetos-cards/${a.id}`, { projeto_id: p.id, titulo: 'Login', status: 'feito', tipo: 'funcionalidade', estimativa_pontos: 3, marco_id: m.id })).body;
    expect(feitoDepois.concluido_em).toBe(feitoAntes.concluido_em);
    const lista = (await igor('GET', '/projetos')).body.find((x: any) => x.id === p.id);
    expect(lista).toMatchObject({ cards_total: 3, cards_feitos: 1, bugs_abertos: 1 });

    const pessoal = (await igor('POST', '/projetos', { nome: 'Organizar garagem' })).body;
    expect((await igor('GET', `/projetos/${pessoal.id}/quadro`)).body.colunas).toEqual(['a_fazer', 'fazendo', 'feito']);
    // marco de outro projeto não pode ser usado
    expect((await igor('POST', '/projetos-cards', { projeto_id: pessoal.id, titulo: 'x', marco_id: m.id })).status).toBe(400);
    expect((await laura('GET', `/projetos/${p.id}/quadro`)).status).toBe(404);
  });
});

describe('profissional e agenda', () => {
  it('entrevista move a vaga para em processo; currículo junta perfil, experiências e formação', async () => {
    await igor('POST', '/profissional/experiencias', { empresa: 'Aliare', cargo: 'Dev GeneXus', inicio: '2024-03-11', tecnologias: ['GeneXus 17'] });
    expect((await igor('POST', '/profissional/experiencias', { empresa: 'X', cargo: 'Y', inicio: '2024-01-01', fim: '2023-01-01' })).status).toBe(400);
    await igor('POST', '/profissional/habilidades', { nome: 'Vue.js', nivel: 5 });
    const vaga = (await igor('POST', '/profissional/vagas', { empresa: 'Acme', cargo: 'Fullstack Pleno', status: 'aplicada' })).body;
    expect(vaga.aplicada_em).toBe(hoje);
    await igor('POST', '/profissional/entrevistas', { vaga_id: vaga.id, data: somarDias(hoje, 2), hora: '10:00', etapa: 'tecnica' });
    expect((await igor('GET', `/profissional/vagas/${vaga.id}`)).body).toMatchObject({ status: 'em_processo', qtd_entrevistas: 1 });

    const cv = (await igor('GET', '/profissional/curriculo')).body;
    expect(cv.perfil.nome).toBe('Igor');
    expect(cv.experiencias[0].empresa).toBe('Aliare');
    expect(cv.formacao[0]).toMatchObject({ nome: 'ADS', instituicao: 'Uninter' });

    const agenda = (await igor('GET', '/hoje/agenda')).body.map((x: any) => x.tipo);
    expect(agenda).toEqual(expect.arrayContaining(['entrevista', 'consulta', 'avaliacao', 'marco']));
    expect((await laura('GET', '/hoje/agenda')).body).toEqual([]);
  });
});

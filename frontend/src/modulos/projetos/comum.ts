import { opcoes, type Campo } from '../../ui/campos';

export const TIPO_PROJETO = { pessoal: 'Pessoal', software: 'Software', produto: 'Produto', profissional: 'Profissional' };
export const STATUS_PROJETO = { ideia: 'Ideia', planejamento: 'Planejamento', andamento: 'Em andamento', pausado: 'Pausado', lancado: 'Lançado', concluido: 'Concluído', arquivado: 'Arquivado' };
export const COLUNA = { backlog: 'Backlog', a_fazer: 'A fazer', fazendo: 'Fazendo', revisao: 'Em revisão', feito: 'Feito' };
export const TIPO_CARD = { tarefa: 'Tarefa', funcionalidade: 'Funcionalidade', bug: 'Bug', melhoria: 'Melhoria', debito_tecnico: 'Débito técnico', pesquisa: 'Pesquisa', documentacao: 'Documentação' };
export const COR_CARD: Record<string, string> = {
  tarefa: '#64748b', funcionalidade: '#4f46e5', bug: '#dc2626', melhoria: '#0891b2', debito_tecnico: '#b45309', pesquisa: '#7c3aed', documentacao: '#13805a',
};
export const COBRANCA = { gratuito: 'Gratuito', unico: 'Pagamento único', mensal: 'Assinatura mensal', anual: 'Assinatura anual', freemium: 'Freemium', sob_consulta: 'Sob consulta' };

const tecnico = (m: Record<string, any>) => m.tipo !== 'pessoal';

export const camposProjeto: Campo[] = [
  { k: 'nome', r: 'Nome', obrig: true },
  { k: 'tipo', r: 'Tipo', t: 'sel', op: opcoes(TIPO_PROJETO), meia: true, dica: 'Software, produto e profissional ganham backlog, revisão, bugs e links' },
  { k: 'status', r: 'Situação', t: 'sel', op: opcoes(STATUS_PROJETO), meia: true },
  { k: 'descricao', r: 'Descrição', t: 'area', linhas: 3 },
  { k: 'inicio', r: 'Início', t: 'data', meia: true },
  { k: 'prazo', r: 'Prazo', t: 'data', meia: true },
  { k: 'cor', r: 'Cor', t: 'cor', meia: true },
  { k: 'versao_atual', r: 'Versão atual', meia: true, ph: '1.0.0', se: tecnico },
  { k: 'stack', r: 'Stack', t: 'tags', ph: 'Vue, Node, Postgres', se: tecnico },
  { k: 'repo_url', r: 'Repositório', t: 'url', ph: 'https://github.com/…', se: tecnico },
  { k: 'producao_url', r: 'Produção', t: 'url', meia: true, se: tecnico },
  { k: 'homologacao_url', r: 'Homologação', t: 'url', meia: true, se: tecnico },
  { k: 'publico_alvo', r: 'Público-alvo', t: 'area', linhas: 2, se: (m) => m.tipo === 'produto' },
  { k: 'proposta_valor', r: 'Proposta de valor', t: 'area', linhas: 3, ph: 'Que problema resolve e por que pagariam', se: (m) => m.tipo === 'produto' },
  { k: 'modelo_cobranca', r: 'Modelo de cobrança', t: 'sel', op: opcoes(COBRANCA), vazio: 'Ainda não definido', meia: true, se: (m) => m.tipo === 'produto' },
  { k: 'preco_centavos', r: 'Preço', t: 'dinheiro', meia: true, se: (m) => m.tipo === 'produto' && m.modelo_cobranca && m.modelo_cobranca !== 'gratuito' },
];

export function camposCard(tipoProjeto: string, colunas: string[], marcos: { id: string; nome: string }[]): Campo[] {
  const tec = tipoProjeto !== 'pessoal';
  return [
    { k: 'titulo', r: 'Título', obrig: true },
    { k: 'tipo', r: 'Tipo', t: 'sel', op: opcoes(tec ? TIPO_CARD : { tarefa: 'Tarefa', pesquisa: 'Pesquisa', melhoria: 'Melhoria' }), meia: true },
    { k: 'status', r: 'Coluna', t: 'sel', op: colunas.map((c) => ({ v: c, r: COLUNA[c as keyof typeof COLUNA] })), meia: true },
    { k: 'prioridade', r: 'Prioridade', t: 'sel', op: [{ v: 1, r: 'Alta' }, { v: 2, r: 'Normal' }, { v: 3, r: 'Baixa' }], meia: true },
    ...(tec ? [{ k: 'estimativa_pontos', r: 'Estimativa (pontos)', t: 'sel', op: [1, 2, 3, 5, 8, 13, 21].map((v) => ({ v, r: String(v) })), vazio: '—', meia: true, dica: 'Fibonacci: esforço relativo, não horas' } as Campo] : []),
    ...(marcos.length ? [{ k: 'marco_id', r: 'Marco / versão', t: 'sel', op: marcos.map((m) => ({ v: m.id, r: m.nome })), vazio: 'Nenhum', meia: true } as Campo] : []),
    { k: 'prazo', r: 'Prazo', t: 'data', meia: true },
    ...(tec ? [
      { k: 'branch', r: 'Branch', meia: true, ph: 'feature/login' } as Campo,
      { k: 'pr_url', r: 'Pull request', t: 'url', meia: true } as Campo,
    ] : []),
    { k: 'descricao', r: tec ? 'Descrição / critérios de aceite' : 'Descrição', t: 'area', linhas: 6, ph: tec ? 'Contexto, passos para reproduzir (bug), critérios de aceite…' : '' },
  ];
}

export const camposMarco: Campo[] = [
  { k: 'nome', r: 'Nome', obrig: true, ph: 'Ex.: MVP, v1.1, Lançamento' },
  { k: 'data_alvo', r: 'Data-alvo', t: 'data', meia: true },
  { k: 'concluido_em', r: 'Concluído em', t: 'data', meia: true },
  { k: 'descricao', r: 'Descrição', t: 'area', linhas: 3 },
];

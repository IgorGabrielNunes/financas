import { opcoes, type Campo } from '../../ui/campos';

export const STATUS_VAGA = {
  interesse: 'Interesse', aplicada: 'Aplicada', em_processo: 'Em processo', proposta: 'Proposta',
  aceita: 'Aceita', recusada: 'Recusei', reprovado: 'Não passei', desisti: 'Desisti',
};
export const ETAPA = { triagem: 'Triagem', rh: 'RH', tecnica: 'Técnica', case: 'Case / teste', gestor: 'Gestor', cultura: 'Cultura', proposta: 'Proposta' };
export const RESULTADO = { agendada: 'Agendada', aguardando: 'Aguardando retorno', aprovado: 'Passei', reprovado: 'Não passei', cancelada: 'Cancelada' };
export const VINCULO = { clt: 'CLT', pj: 'PJ', estagio: 'Estágio', freelance: 'Freelance', temporario: 'Temporário', voluntario: 'Voluntário' };
export const MODALIDADE = { presencial: 'Presencial', hibrido: 'Híbrido', remoto: 'Remoto' };

export const CAMPOS_VAGA: Campo[] = [
  { k: 'cargo', r: 'Cargo', obrig: true, meia: true },
  { k: 'empresa', r: 'Empresa', obrig: true, meia: true },
  { k: 'status', r: 'Situação', t: 'sel', op: opcoes(STATUS_VAGA), meia: true },
  { k: 'aplicada_em', r: 'Aplicou em', t: 'data', meia: true, dica: 'Preenchido sozinho ao marcar Aplicada' },
  { k: 'vinculo', r: 'Vínculo', t: 'sel', op: opcoes({ clt: 'CLT', pj: 'PJ', estagio: 'Estágio', freelance: 'Freelance', temporario: 'Temporário' }), vazio: '—', meia: true },
  { k: 'modalidade', r: 'Modalidade', t: 'sel', op: opcoes(MODALIDADE), vazio: '—', meia: true },
  { k: 'salario_min_centavos', r: 'Salário de', t: 'dinheiro', meia: true },
  { k: 'salario_max_centavos', r: 'Salário até', t: 'dinheiro', meia: true },
  { k: 'fonte', r: 'Onde viu', meia: true, ph: 'LinkedIn, indicação…' },
  { k: 'local', r: 'Cidade', meia: true },
  { k: 'url', r: 'Link da vaga', t: 'url' },
  { k: 'contato', r: 'Contato (recrutador)' },
  { k: 'observacoes', r: 'Observações', t: 'area', linhas: 4 },
];

export const CAMPOS_ENTREVISTA: Campo[] = [
  { k: 'etapa', r: 'Etapa', t: 'sel', op: opcoes(ETAPA), meia: true },
  { k: 'resultado', r: 'Resultado', t: 'sel', op: opcoes(RESULTADO), meia: true },
  { k: 'data', r: 'Data', t: 'data', obrig: true, meia: true },
  { k: 'hora', r: 'Hora', t: 'hora', meia: true },
  { k: 'entrevistador', r: 'Com quem', meia: true },
  { k: 'link', r: 'Link da reunião', t: 'url', meia: true },
  { k: 'anotacoes', r: 'Anotações (perguntas, impressões)', t: 'area', linhas: 5 },
];

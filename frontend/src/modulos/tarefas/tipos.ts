import { reactive } from 'vue';
import { api } from '../../core/api';

export type Area = { id: string; nome: string; cor: string; ordem: number; qtd?: number };
export type Repeticao = 'nenhuma' | 'diaria' | 'semanal' | 'mensal';
export type Tarefa = {
  id: string; user_id: string; titulo: string; notas: string | null; area_id: string | null; area_nome: string | null; area_cor: string | null;
  responsavel_id: string | null; responsavel_nome: string | null; criador_nome: string; compartilhada: boolean;
  prioridade: 1 | 2 | 3; data: string | null; repeticao: Repeticao; dias_semana: number[] | null; fim: string | null;
  concluida_em: string | null; arquivada: boolean; descricao_repeticao?: string;
  // agenda
  ocorrencia?: string | null; feita?: boolean; atrasada?: boolean; feita_por_nome?: string | null;
  // listagem completa
  proxima?: string | null; sequencia?: number;
};

export const tarefasEstado = reactive({ areas: [] as Area[], membros: [] as { id: string; nome: string }[] });
export async function carregarApoio() {
  const [areas, membros] = await Promise.all([api.get<Area[]>('/tarefas/areas'), api.get<{ id: string; nome: string }[]>('/conta/membros')]);
  Object.assign(tarefasEstado, { areas, membros });
}

export async function alternarFeita(t: Tarefa) {
  const q = t.repeticao !== 'nenhuma' && t.ocorrencia ? `?data=${t.ocorrencia}` : '';
  if (t.feita) await api.del(`/tarefas/${t.id}/concluir${q}`);
  else await api.post(`/tarefas/${t.id}/concluir`, { data: t.repeticao !== 'nenhuma' ? t.ocorrencia : undefined });
}

export const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

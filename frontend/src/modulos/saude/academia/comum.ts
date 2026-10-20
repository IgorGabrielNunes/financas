import { opcoes, type Campo } from '../../../ui/campos';

export const GRUPO: Record<string, string> = {
  peito: 'Peito', costas: 'Costas', pernas: 'Pernas', gluteos: 'Glúteos', ombros: 'Ombros', biceps: 'Bíceps', triceps: 'Tríceps',
  abdomen: 'Abdômen', cardio: 'Cardio', mobilidade: 'Mobilidade', outro: 'Outro',
};
export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export type Exercicio = {
  id: string; ficha_id: string; nome: string; grupo: string; series: number | null; repeticoes: string | null;
  carga_kg: string | number | null; descanso_seg: number | null; video_url: string | null; observacoes: string | null; ordem: number;
  ultimo: { data: string; carga_kg: string | null; repeticoes: string | null; series_feitas: number | null } | null;
};
export type Ficha = {
  id: string; nome: string; foco: string | null; dias_semana: number[]; horario: string | null; ordem: number; ativa: boolean;
  cor: string; observacoes: string | null; ultimo_treino: string | null; exercicios: Exercicio[];
};

export const camposFicha: Campo[] = [
  { k: 'nome', r: 'Nome', obrig: true, meia: true, ph: 'Treino A' },
  { k: 'foco', r: 'Foco', meia: true, ph: 'Peito e tríceps' },
  { k: 'horario', r: 'Horário do treino', t: 'hora', meia: true, dica: 'Usado no aviso do WhatsApp/Telegram' },
  { k: 'cor', r: 'Cor', t: 'cor', meia: true },
  { k: 'observacoes', r: 'Observações', t: 'area', linhas: 2 },
];

export const camposExercicio: Campo[] = [
  { k: 'nome', r: 'Exercício', obrig: true, ph: 'Supino reto com barra' },
  { k: 'grupo', r: 'Grupo muscular', t: 'sel', op: opcoes(GRUPO), meia: true },
  { k: 'series', r: 'Séries', t: 'num', min: 1, max: 20, passo: 1, meia: true },
  { k: 'repeticoes', r: 'Repetições', meia: true, ph: '8-12, 15, 30s' },
  { k: 'carga_kg', r: 'Carga (kg)', t: 'num', min: 0, passo: 0.5, meia: true },
  { k: 'descanso_seg', r: 'Descanso (segundos)', t: 'num', min: 0, max: 900, passo: 15, meia: true },
  { k: 'video_url', r: 'Vídeo de referência', t: 'url', meia: true },
  { k: 'observacoes', r: 'Dicas de execução', t: 'area', linhas: 2 },
];

export const kg = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
export function prescricao(e: Pick<Exercicio, 'series' | 'repeticoes' | 'carga_kg' | 'descanso_seg'>) {
  const p = [e.series && e.repeticoes ? `${e.series}×${e.repeticoes}` : e.series ? `${e.series} séries` : e.repeticoes];
  if (e.carga_kg !== null && e.carga_kg !== undefined && e.carga_kg !== '') p.push(`${kg(e.carga_kg)} kg`);
  if (e.descanso_seg) p.push(`descanso ${e.descanso_seg >= 60 ? `${Math.floor(e.descanso_seg / 60)}min${e.descanso_seg % 60 ? e.descanso_seg % 60 : ''}` : `${e.descanso_seg}s`}`);
  return p.filter(Boolean).join(' · ');
}

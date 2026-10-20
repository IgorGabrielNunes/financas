// Regras puras dos avisos: dado o "agora" e os dados do dia, quais mensagens são devidas.
// Sem banco e sem rede — roda igual na API (prévia/teste) e no Worker da Cloudflare (cron).

export type ConfigAvisos = {
  user_id: string;
  nome: string;
  discreto: boolean;
  resumo_hora: string | null;
  antecedencia_min: number;
  avisar_treino: boolean;
  avisar_remedios: boolean;
  avisar_consultas: boolean;
  avisar_entrevistas: boolean;
  avisar_refeicoes: boolean;
  silencio_inicio: string | null;
  silencio_fim: string | null;
};

export type DadosDoDia = {
  data: string;                 // 'YYYY-MM-DD' (São Paulo)
  tarefas: { titulo: string; atrasada: boolean }[];
  doses: { remedio_id: string; nome: string; dosagem: string | null; horario: string; tomada: boolean }[];
  consultas: { id: string; titulo: string; tipo: string; data: string; hora: string | null; local: string | null }[];
  entrevistas: { id: string; empresa: string; etapa: string; data: string; hora: string | null; link: string | null }[];
  treinos: { ficha_id: string; nome: string; foco: string | null; horario: string | null; exercicios: number; feito: boolean; rodizio: boolean }[];
  refeicoes: { id: string; nome: string; horario: string | null; lembrar: boolean; feita: boolean }[];
};

export type Aviso = { chave: string; hora: string; texto: string; tipo: string };

/** Janela de tolerância para avisos "na hora": o cron roda a cada 5 min e pode atrasar. */
export const JANELA_MIN = 20;
/** Resumo do dia ainda sai até 3h depois do horário (Worker fora do ar, deploy, etc.). */
export const JANELA_RESUMO_MIN = 180;

export const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Silêncio pode atravessar a meia-noite (ex.: 22:00 → 07:00). */
export function emSilencio(agora: string, inicio: string | null, fim: string | null) {
  if (!inicio || !fim) return false;
  const a = minutos(agora), i = minutos(inicio), f = minutos(fim);
  return i <= f ? a >= i && a < f : a >= i || a < f;
}

/** O momento `alvo` (HH:MM) já chegou e não passou da janela de tolerância. */
const naJanela = (agora: number, alvo: number, janela = JANELA_MIN) => agora >= alvo && agora < alvo + janela;

const ETAPA: Record<string, string> = { triagem: 'triagem', rh: 'RH', tecnica: 'técnica', case: 'case', gestor: 'gestor', cultura: 'cultura', proposta: 'proposta' };
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

/**
 * Avisos devidos agora. Cada um tem uma chave determinística: o disparador grava a chave
 * antes de enviar, então rodar de novo no mesmo minuto (ou o cron atrasar) não duplica.
 */
export function avisosDevidos(cfg: ConfigAvisos, dados: DadosDoDia, agora: string): Aviso[] {
  if (emSilencio(agora, cfg.silencio_inicio, cfg.silencio_fim)) return [];
  const a = minutos(agora);
  const d = dados.data;
  const out: Aviso[] = [];
  const nome = cfg.nome.split(' ')[0];

  // ------------------------------------------------------------- resumo do dia
  if (cfg.resumo_hora && naJanela(a, minutos(cfg.resumo_hora), JANELA_RESUMO_MIN)) {
    out.push({ chave: `resumo:${d}`, hora: cfg.resumo_hora, tipo: 'resumo', texto: resumoDoDia(cfg, dados, nome) });
  }

  // ------------------------------------------------------------------- treino
  if (cfg.avisar_treino) {
    for (const t of dados.treinos) {
      if (t.feito || !t.horario || !naJanela(a, minutos(t.horario))) continue;
      out.push({
        chave: `treino:${t.ficha_id}:${d}`, hora: t.horario, tipo: 'treino',
        texto: cfg.discreto ? `🏋️ Hora do treino!` : `🏋️ Hora do treino: *${t.nome}*${t.foco ? ` (${t.foco})` : ''} — ${plural(t.exercicios, 'exercício', 'exercícios')}. Bora!`,
      });
    }
  }

  // ----------------------------------------------------------------- remédios
  if (cfg.avisar_remedios) {
    // doses do mesmo horário viram uma mensagem só
    const porHora = new Map<string, DadosDoDia['doses']>();
    for (const x of dados.doses) {
      if (x.tomada || !naJanela(a, minutos(x.horario))) continue;
      porHora.set(x.horario, [...(porHora.get(x.horario) ?? []), x]);
    }
    for (const [h, ds] of porHora) {
      out.push({
        chave: `doses:${d}:${h}:${ds.map((x) => x.remedio_id).sort().join(',')}`, hora: h, tipo: 'remedios',
        texto: cfg.discreto
          ? `💊 ${h} — hora de ${plural(ds.length, 'remédio', 'remédios')}.`
          : `💊 ${h} — ${ds.map((x) => `${x.nome}${x.dosagem ? ` (${x.dosagem})` : ''}`).join(', ')}`,
      });
    }
  }

  // ------------------------------------------------------------- compromissos
  // avisa `antecedencia_min` antes (ou assim que entrar na janela, se o horário estiver mais perto)
  const antes = (data: string, hora: string | null) => {
    if (data !== d || !hora) return false;
    const alvo = minutos(hora);
    return a >= alvo - cfg.antecedencia_min && a < alvo;
  };
  if (cfg.avisar_consultas) {
    for (const c of dados.consultas) {
      if (!antes(c.data, c.hora)) continue;
      out.push({
        chave: `consulta:${c.id}:${d}`, hora: hhmm(minutos(c.hora!) - cfg.antecedencia_min), tipo: 'consulta',
        texto: cfg.discreto ? `📅 Compromisso às ${c.hora}.` : `📅 Às ${c.hora}: *${c.titulo}*${c.local ? ` — ${c.local}` : ''}`,
      });
    }
  }
  if (cfg.avisar_entrevistas) {
    for (const e of dados.entrevistas) {
      if (!antes(e.data, e.hora)) continue;
      out.push({
        chave: `entrevista:${e.id}:${d}`, hora: hhmm(minutos(e.hora!) - cfg.antecedencia_min), tipo: 'entrevista',
        texto: cfg.discreto ? `💼 Compromisso às ${e.hora}.` : `💼 Às ${e.hora}: entrevista ${ETAPA[e.etapa] ?? e.etapa} com *${e.empresa}*${e.link ? `\n${e.link}` : ''}`,
      });
    }
  }

  // ---------------------------------------------------------------- refeições
  if (cfg.avisar_refeicoes) {
    for (const r of dados.refeicoes) {
      if (!r.lembrar || r.feita || !r.horario || !naJanela(a, minutos(r.horario))) continue;
      out.push({ chave: `refeicao:${r.id}:${d}`, hora: r.horario, tipo: 'refeicao', texto: `🍽️ ${r.horario} — ${r.nome}` });
    }
  }
  return out;
}

function resumoDoDia(cfg: ConfigAvisos, dados: DadosDoDia, nome: string) {
  const linhas: string[] = [`☀️ Bom dia, ${nome}! Seu dia:`];
  const treinos = dados.treinos.filter((t) => !t.feito);
  if (treinos.length) {
    linhas.push(cfg.discreto
      ? `🏋️ ${plural(treinos.length, 'treino', 'treinos')}`
      : `🏋️ ${treinos.map((t) => `${t.nome}${t.foco ? ` (${t.foco})` : ''}${t.horario ? ` às ${t.horario}` : ''}${t.rodizio ? ' — próximo do rodízio' : ''}`).join('; ')}`);
  }
  const atrasadas = dados.tarefas.filter((t) => t.atrasada).length;
  if (dados.tarefas.length) {
    linhas.push(`✅ ${plural(dados.tarefas.length, 'tarefa', 'tarefas')}${atrasadas ? ` (${atrasadas} atrasada${atrasadas > 1 ? 's' : ''})` : ''}`
      + (cfg.discreto ? '' : `: ${dados.tarefas.slice(0, 5).map((t) => t.titulo).join(', ')}${dados.tarefas.length > 5 ? '…' : ''}`));
  }
  const doses = dados.doses.filter((x) => !x.tomada);
  if (doses.length) {
    linhas.push(cfg.discreto
      ? `💊 ${plural(doses.length, 'dose', 'doses')} de remédio`
      : `💊 ${doses.map((x) => `${x.nome} ${x.horario}`).join(', ')}`);
  }
  const comp = [
    ...dados.consultas.filter((c) => c.data === dados.data).map((c) => ({ h: c.hora ?? '', t: cfg.discreto ? 'compromisso' : c.titulo })),
    ...dados.entrevistas.filter((e) => e.data === dados.data).map((e) => ({ h: e.hora ?? '', t: cfg.discreto ? 'compromisso' : `entrevista ${e.empresa}` })),
  ].sort((x, y) => x.h.localeCompare(y.h));
  if (comp.length) linhas.push(`📅 ${comp.map((c) => `${c.h ? `${c.h} ` : ''}${c.t}`).join(', ')}`);
  if (linhas.length === 1) linhas.push('Nada agendado. Aproveite! 🙂');
  return linhas.join('\n');
}

/** "Agora" em São Paulo: data civil e HH:MM (o Worker roda em UTC). */
export function agoraSP(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

// ===================================================================== casa (grupo)

export type ConfigCasa = {
  casa_id: string;
  resumo_hora: string;
  avisar_tarefas: boolean;
  avisar_contas: boolean;
  dias_antes_contas: number;
};

export type DadosCasa = {
  data: string;
  tarefas: { titulo: string; responsavel: string | null; atrasada: boolean }[];
  contas: { descricao: string; valor_centavos: number; vencimento: string; tipo: 'conta' | 'fatura' }[];
};

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diaRel = (d: string, hoje: string) => {
  if (d === hoje) return 'hoje';
  if (d < hoje) return `venceu ${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const amanha = new Date(`${hoje}T12:00:00Z`); amanha.setUTCDate(amanha.getUTCDate() + 1);
  return d === amanha.toISOString().slice(0, 10) ? 'amanhã' : `${d.slice(8, 10)}/${d.slice(5, 7)}`;
};

/** Resumo do grupo da casa: só sai se tiver algo a dizer (grupo sem ruído). */
export function avisosCasa(cfg: ConfigCasa, dados: DadosCasa, agora: string): Aviso[] {
  if (!naJanela(minutos(agora), minutos(cfg.resumo_hora), JANELA_RESUMO_MIN)) return [];
  const linhas: string[] = [];
  if (cfg.avisar_tarefas && dados.tarefas.length) {
    linhas.push('🏠 *Tarefas da casa hoje*');
    for (const t of dados.tarefas.slice(0, 15)) {
      linhas.push(`• ${t.titulo}${t.responsavel ? ` — ${t.responsavel.split(' ')[0]}` : ''}${t.atrasada ? ' (atrasada)' : ''}`);
    }
  }
  if (cfg.avisar_contas && dados.contas.length) {
    if (linhas.length) linhas.push('');
    linhas.push('💸 *Contas vencendo*');
    const ordenadas = [...dados.contas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    for (const c of ordenadas) linhas.push(`• ${c.tipo === 'fatura' ? 'Fatura ' : ''}${c.descricao} — ${brl(c.valor_centavos)} (${diaRel(c.vencimento, dados.data)})`);
    const total = ordenadas.reduce((s, c) => s + c.valor_centavos, 0);
    if (ordenadas.length > 1) linhas.push(`Total: *${brl(total)}*`);
  }
  if (!linhas.length) return [];
  return [{ chave: `casa:resumo:${dados.data}`, hora: cfg.resumo_hora, tipo: 'resumo', texto: linhas.join('\n') }];
}

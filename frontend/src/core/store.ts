import { reactive, ref } from 'vue';
import { api, type Cartao, type Categoria, type Conta, type Pessoa } from './api';

// Cadastros usados em vários formulários. Recarregados após qualquer alteração.
export const cadastros = reactive({
  contas: [] as Conta[],
  cartoes: [] as Cartao[],
  categorias: [] as Categoria[],
  pessoas: [] as Pessoa[],
  carregado: false,
});

export async function carregarCadastros() {
  const [contas, cartoes, categorias, pessoas] = await Promise.all([
    api.get<Conta[]>('/contas'),
    api.get<Cartao[]>('/cartoes'),
    api.get<Categoria[]>('/categorias'),
    api.get<Pessoa[]>('/pessoas'),
  ]);
  Object.assign(cadastros, { contas, cartoes, categorias, pessoas, carregado: true });
}

/** Incrementado a cada gravação: as telas observam e recarregam. */
export const versao = ref(0);
export function avisarMudanca() {
  versao.value++;
  carregarCadastros().catch(() => {});
}

// Modal global de lançamento (aberto pelo botão central da navegação)
export const lancamentoModal = reactive<{ aberto: boolean; id: string | null; preset: Record<string, unknown> }>({
  aberto: false, id: null, preset: {},
});
export function abrirLancamento(id: string | null = null, preset: Record<string, unknown> = {}) {
  Object.assign(lancamentoModal, { aberto: true, id, preset });
}

// Usuário logado (papel, perfil vinculado em Pessoas, casa)
export type Eu = {
  id: string; nome: string; email: string; papel: 'admin' | 'membro'; pessoa_id: string | null; pessoa_nome: string | null;
  trocar_senha: boolean; casa: { id: string; nome: string };
};
export const sessao = reactive<{ eu: Eu | null }>({ eu: null });
export async function carregarEu() {
  sessao.eu = await api.get<Eu>('/conta/eu');
  return sessao.eu;
}

// Menu "+": adicionar qualquer coisa de qualquer tela
export const acaoRapida = reactive({ aberta: false });

// Toast simples
export const toast = reactive({ msg: '', tipo: 'ok' as 'ok' | 'erro', t: 0 as any });
export function avisar(msg: string, tipo: 'ok' | 'erro' = 'ok') {
  clearTimeout(toast.t);
  Object.assign(toast, { msg, tipo, t: setTimeout(() => (toast.msg = ''), 3500) });
}

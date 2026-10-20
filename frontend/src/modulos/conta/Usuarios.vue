<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../../core/api';
import { avisar, avisarMudanca, cadastros, sessao, versao } from '../../core/store';
import EntidadeModal from '../../ui/EntidadeModal.vue';
import Modal from '../../ui/Modal.vue';
import type { Campo } from '../../ui/campos';

type Usuario = { id: string; nome: string; email: string; papel: 'admin' | 'membro'; ativo: boolean; trocar_senha: boolean; pessoa_id: string | null; pessoa_nome: string | null };
const usuarios = ref<Usuario[]>([]);
const erro = ref('');
watch(versao, async () => {
  try { usuarios.value = await api.get<Usuario[]>('/conta/usuarios'); } catch (e) { erro.value = (e as Error).message; }
}, { immediate: true });

const modal = ref<{ tipo: 'novo' | 'editar' | 'senha' | null; u: Usuario | null }>({ tipo: null, u: null });
const pessoasLivres = computed(() => cadastros.pessoas
  .filter((p) => !usuarios.value.some((u) => u.pessoa_id === p.id && u.id !== modal.value.u?.id))
  .map((p) => ({ v: p.id, r: p.nome })));

const camposNovo: Campo[] = [
  { k: 'nome', r: 'Nome', obrig: true, meia: true },
  { k: 'email', r: 'E-mail', obrig: true, meia: true, ph: 'nome@email.com' },
  { k: 'senha', r: 'Senha temporária', obrig: true, dica: 'Mínimo de 10 caracteres. A pessoa troca no primeiro acesso.' },
  { k: 'pessoa_id', r: 'Perfil em Pessoas', t: 'sel', op: () => pessoasLivres.value, vazio: 'Criar um perfil novo com o primeiro nome', dica: 'É onde ficam salário, cargo, férias e 13º dessa pessoa.' },
  { k: 'papel', r: 'Papel', t: 'sel', op: [{ v: 'membro', r: 'Membro: usa tudo, não gerencia usuários' }, { v: 'admin', r: 'Administrador: também gerencia usuários' }] },
];
const camposEditar: Campo[] = [
  { k: 'nome', r: 'Nome', obrig: true },
  { k: 'pessoa_id', r: 'Perfil em Pessoas', t: 'sel', op: () => pessoasLivres.value, vazio: 'Nenhum' },
  { k: 'papel', r: 'Papel', t: 'sel', meia: true, op: [{ v: 'membro', r: 'Membro' }, { v: 'admin', r: 'Administrador' }] },
  { k: 'ativo', r: 'Acesso', t: 'sel', meia: true, op: [{ v: true, r: 'Ativo' }, { v: false, r: 'Desativado' }] },
];

const senhaNova = ref('');
async function redefinir() {
  try {
    await api.put(`/conta/usuarios/${modal.value.u!.id}/senha`, { senha: senhaNova.value });
    avisar('Senha temporária definida');
    senhaNova.value = '';
    modal.value = { tipo: null, u: null };
    avisarMudanca();
  } catch (e) { avisar((e as Error).message, 'erro'); }
}
</script>

<template>
  <div class="pagina estreita">
    <header class="cabecalho">
      <div>
        <h1>Usuários da casa</h1>
        <p>Quem entra no Vida da {{ sessao.eu?.casa?.nome }}. Finanças são compartilhadas; o resto é de cada um.</p>
      </div>
      <button class="btn primario" @click="modal = { tipo: 'novo', u: null }">Adicionar pessoa</button>
    </header>
    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <ul class="lista painel">
      <li v-for="u in usuarios" :key="u.id" class="clicavel" :class="{ inativo: !u.ativo }" @click="modal = { tipo: 'editar', u }">
        <span class="ico" :style="{ '--c': 'var(--marca)' }">{{ u.nome.slice(0, 1) }}</span>
        <div>
          <div class="titulo">{{ u.nome }}<span v-if="u.id === sessao.eu?.id" class="suave miudo"> (você)</span></div>
          <div class="meta">{{ [u.email, u.pessoa_nome ? `perfil ${u.pessoa_nome}` : 'sem perfil'].join(', ') }}</div>
        </div>
        <div class="valor">
          <span :class="['selo', u.papel === 'admin' ? 'paga' : '']">{{ u.papel === 'admin' ? 'Admin' : 'Membro' }}</span>
          <div v-if="!u.ativo" class="meta">desativado</div>
          <div v-else-if="u.trocar_senha" class="meta previsto">senha temporária</div>
        </div>
      </li>
    </ul>

    <EntidadeModal v-if="modal.tipo === 'novo'" titulo="Adicionar pessoa à casa" rota="/conta/usuarios" :campos="camposNovo"
      :padrao="{ papel: 'membro', pessoa_id: null }" :fixos="{ criar_pessoa: true }" rotulo-salvar="Criar acesso" @fechar="modal.tipo = null" />
    <EntidadeModal v-if="modal.tipo === 'editar'" :titulo="modal.u!.nome" rota="/conta/usuarios" :campos="camposEditar" :item="modal.u"
      rotulo-salvar="Salvar" @fechar="modal.tipo = null">
      <button type="button" class="btn" @click="modal = { tipo: 'senha', u: modal.u }">Definir senha temporária</button>
    </EntidadeModal>
    <Modal v-if="modal.tipo === 'senha'" :titulo="`Nova senha para ${modal.u!.nome}`" @fechar="modal.tipo = null">
      <form class="form" @submit.prevent="redefinir">
        <label class="campo"><span>Senha temporária</span><input v-model="senhaNova" minlength="10" required /><small>Passe para a pessoa; ela troca no próximo acesso.</small></label>
        <div class="acoes"><button class="btn primario" type="submit">Definir senha</button></div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.estreita { max-width: 820px; }
.inativo { opacity: 0.55; }
</style>

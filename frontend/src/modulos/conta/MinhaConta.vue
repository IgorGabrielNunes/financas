<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../core/api';
import { avisar, carregarEu, sessao } from '../../core/store';

const route = useRoute();
const router = useRouter();
const obrigatoria = computed(() => route.query.trocar === '1' || sessao.eu?.trocar_senha);
const f = reactive({ atual: '', nova: '', repetir: '' });
const erro = ref('');
const casa = reactive({ nome: sessao.eu?.casa?.nome ?? '' });

async function trocar() {
  erro.value = '';
  if (f.nova !== f.repetir) return (erro.value = 'As duas senhas novas não são iguais.');
  try {
    await api.put('/conta/senha', { atual: f.atual, nova: f.nova });
    Object.assign(f, { atual: '', nova: '', repetir: '' });
    await carregarEu();
    avisar('Senha alterada');
    if (route.query.trocar) router.replace('/');
  } catch (e) { erro.value = (e as Error).message; }
}
async function salvarCasa() {
  try {
    await api.put('/conta/casa', casa);
    await carregarEu();
    avisar('Nome da casa salvo');
  } catch (e) { avisar((e as Error).message, 'erro'); }
}
</script>

<template>
  <div class="pagina estreita">
    <header class="cabecalho">
      <div>
        <h1>{{ sessao.eu?.nome ?? 'Minha conta' }}</h1>
        <p>{{ sessao.eu?.email }}, {{ sessao.eu?.papel === 'admin' ? 'administrador' : 'membro' }} da {{ sessao.eu?.casa?.nome }}</p>
      </div>
    </header>

    <div v-if="obrigatoria" class="aviso">
      <b>Troque a senha temporária.</b> Ela foi criada por outra pessoa; escolha uma só sua para continuar.
    </div>

    <section class="secao">
      <header><h2>Senha</h2></header>
      <form class="form painel recheado" @submit.prevent="trocar">
        <label class="campo"><span>Senha atual{{ obrigatoria ? ' (a temporária)' : '' }}</span><input v-model="f.atual" type="password" autocomplete="current-password" required /></label>
        <div class="linha">
          <label class="campo"><span>Nova senha</span><input v-model="f.nova" type="password" autocomplete="new-password" minlength="10" required /><small>Pelo menos 10 caracteres</small></label>
          <label class="campo"><span>Repita a nova senha</span><input v-model="f.repetir" type="password" autocomplete="new-password" minlength="10" required /></label>
        </div>
        <p v-if="erro" class="erro-form">{{ erro }}</p>
        <div class="acoes"><button class="btn primario" type="submit">Trocar senha</button></div>
      </form>
    </section>

    <section v-if="!obrigatoria" class="secao">
      <header><h2>Meu perfil financeiro</h2></header>
      <div class="painel recheado perfil">
        <template v-if="sessao.eu?.pessoa_id">
          <p>Seu salário, cargo, férias e 13º ficam no perfil <b>{{ sessao.eu.pessoa_nome }}</b>.</p>
          <RouterLink class="btn" :to="`/financas/pessoas/${sessao.eu.pessoa_id}`">Abrir salário e férias</RouterLink>
        </template>
        <p v-else class="suave">Seu usuário ainda não está ligado a um perfil em Pessoas. Peça ao administrador para vincular em Usuários da casa.</p>
      </div>
    </section>

    <section v-if="!obrigatoria && sessao.eu?.papel === 'admin'" class="secao">
      <header><h2>Casa</h2><RouterLink class="btn link" to="/conta/usuarios">Usuários da casa</RouterLink></header>
      <form class="form painel recheado" @submit.prevent="salvarCasa">
        <label class="campo"><span>Nome da casa</span><input v-model="casa.nome" maxlength="60" required /></label>
        <p class="miudo suave">As finanças são da casa: todos os membros veem e editam. Tarefas, anotações, estudos, saúde, projetos e profissional são de cada um.</p>
        <div class="acoes"><button class="btn" type="submit">Salvar nome</button></div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.estreita { max-width: 720px; }
.aviso { background: var(--previsto-tint); color: var(--ink); padding: 14px 16px; border-radius: var(--raio-m); }
.perfil { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
</style>

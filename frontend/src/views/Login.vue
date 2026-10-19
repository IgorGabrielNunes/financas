<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, setToken } from '../api';
import { carregarCadastros } from '../store';

const router = useRouter();
const email = ref('');
const senha = ref('');
const erro = ref('');
const entrando = ref(false);

async function entrar() {
  erro.value = '';
  entrando.value = true;
  try {
    const r = await api.post<{ token: string }>('/auth/login', { email: email.value, senha: senha.value });
    setToken(r.token);
    await carregarCadastros();
    router.replace('/');
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    entrando.value = false;
  }
}
</script>

<template>
  <div class="login">
    <form class="form painel recheado" @submit.prevent="entrar">
      <h1>Caixa</h1>
      <p class="suave">Quanto dá para gastar, de verdade.</p>
      <label class="campo"><span>E-mail</span><input v-model="email" type="email" autocomplete="username" required /></label>
      <label class="campo"><span>Senha</span><input v-model="senha" type="password" autocomplete="current-password" required /></label>
      <p v-if="erro" class="erro-form" role="alert">{{ erro }}</p>
      <button class="btn primario" type="submit" :disabled="entrando">{{ entrando ? 'Entrando…' : 'Entrar' }}</button>
    </form>
  </div>
</template>

<style scoped>
.login { min-height: 100dvh; display: grid; place-items: center; padding: 20px; }
.login form { width: min(380px, 100%); }
.login h1 { font-size: 2.4rem; letter-spacing: -0.03em; }
</style>

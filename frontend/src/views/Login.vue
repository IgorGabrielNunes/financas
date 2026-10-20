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
const lento = ref(false);

async function entrar() {
  erro.value = '';
  entrando.value = true;
  // a API grátis dorme após 15 min: avisa em vez de parecer travado
  const t = setTimeout(() => (lento.value = true), 4000);
  try {
    const r = await api.post<{ token: string }>('/auth/login', { email: email.value, senha: senha.value });
    setToken(r.token);
    await carregarCadastros();
    router.replace('/');
  } catch (e) {
    erro.value = (e as Error).message === 'Failed to fetch'
      ? 'Não foi possível falar com o servidor. Se ele estava parado, aguarde alguns segundos e tente de novo.'
      : (e as Error).message;
  } finally {
    clearTimeout(t);
    lento.value = false;
    entrando.value = false;
  }
}
</script>

<template>
  <div class="login">
    <section class="lado">
      <span class="logo" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M6 15.5c1.6 1.6 3.6 2.5 6 2.5 4.4 0 8-3.6 8-8M4 10a8 8 0 0 1 13.7-5.6" /><path d="M12 7v6l3 2" /></svg>
      </span>
      <h1>Caixa</h1>
      <p>Quanto dá para gastar até o próximo salário, sem contar com o limite do cartão.</p>
    </section>

    <form class="form cartao-login" @submit.prevent="entrar">
      <h2>Entrar</h2>
      <label class="campo"><span>E-mail</span><input v-model="email" type="email" autocomplete="username" required /></label>
      <label class="campo"><span>Senha</span><input v-model="senha" type="password" autocomplete="current-password" required /></label>
      <p v-if="erro" class="erro-form" role="alert">{{ erro }}</p>
      <button class="btn primario" type="submit" :disabled="entrando">{{ entrando ? 'Entrando…' : 'Entrar' }}</button>
      <p v-if="lento" class="miudo suave">O servidor estava parado e está acordando. Leva até 1 minuto na primeira vez.</p>
    </form>
  </div>
</template>

<style scoped>
.login { min-height: 100dvh; display: grid; grid-template-columns: 1fr 1fr; }
.lado {
  background: var(--marca); color: #fff; padding: 48px; display: grid; align-content: end; gap: 14px;
}
.lado h1 { font-size: clamp(2.6rem, 5vw, 3.6rem); letter-spacing: -0.04em; }
.lado p { color: rgba(255, 255, 255, 0.75); font-size: 1.1rem; max-width: 34ch; }
.logo { width: 52px; height: 52px; border-radius: 15px; background: rgba(255, 255, 255, 0.14); display: grid; place-items: center; }
.logo svg { width: 30px; height: 30px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.cartao-login { align-self: center; justify-self: center; width: min(380px, calc(100% - 40px)); }
.cartao-login h2 { font-size: 1.5rem; margin-bottom: 4px; }
.cartao-login .btn { min-height: 48px; }
@media (max-width: 760px) {
  .login { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .lado { padding: 40px 24px 28px; }
  .cartao-login { align-self: start; padding-top: 28px; }
}
</style>

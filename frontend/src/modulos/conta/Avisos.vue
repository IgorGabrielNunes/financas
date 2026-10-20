<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../core/api';
import { avisar, sessao } from '../../core/store';

type Config = {
  ativo: boolean; canal: 'callmebot' | 'telegram' | 'grupo'; telefone: string | null; discreto: boolean; resumo_hora: string | null;
  antecedencia_min: number; avisar_treino: boolean; avisar_remedios: boolean; avisar_consultas: boolean; avisar_entrevistas: boolean;
  avisar_refeicoes: boolean; silencio_inicio: string | null; silencio_fim: string | null;
  tem_apikey: boolean; telegram_vinculado: boolean; grupo_vinculado: boolean; telegram_disponivel: boolean; telegram_robo: string | null;
};
type Previa = { sai_as: string; tipo: string; texto: string };
type Casa = {
  ativo: boolean; resumo_hora: string; avisar_tarefas: boolean; avisar_contas: boolean; dias_antes_contas: number;
  grupo_vinculado: boolean; titulo_grupo: string | null; telegram_disponivel: boolean; telegram_robo: string | null; previa: Previa[];
};

const CALLMEBOT = '+34 621 331 709';
const cfg = ref<Config | null>(null);
const f = reactive({ apikey: '', usarResumo: true, usarSilencio: true });
const previa = ref<Previa[]>([]);
const casa = ref<Casa | null>(null);
const codigo = ref<{ codigo: string; link: string | null; link_grupo: string | null; comando: string; tipo: 'pessoal' | 'casa' } | null>(null);
const salvando = ref(false);
const erro = ref('');
const admin = computed(() => sessao.eu?.papel === 'admin');

async function carregar() {
  try {
    const [c, p, k] = await Promise.all([
      api.get<Config>('/avisos/config'), api.get<{ avisos: Previa[] }>('/avisos/previa'), api.get<Casa>('/avisos/casa'),
    ]);
    cfg.value = c; previa.value = p.avisos; casa.value = k;
    f.usarResumo = !!c.resumo_hora; f.usarSilencio = !!c.silencio_inicio;
    if (!c.resumo_hora) c.resumo_hora = '07:00';
    if (!c.silencio_inicio) { c.silencio_inicio = '22:00'; c.silencio_fim = '07:00'; }
  } catch (e) { erro.value = (e as Error).message; }
}
onMounted(carregar);

async function salvar(ativar?: boolean) {
  if (!cfg.value) return;
  erro.value = '';
  salvando.value = true;
  const c = cfg.value;
  try {
    cfg.value = await api.put<Config>('/avisos/config', {
      ativo: ativar ?? c.ativo, canal: c.canal, telefone: c.telefone?.replace(/[^\d+]/g, '') || null,
      apikey: f.apikey.trim() || undefined, discreto: c.discreto,
      resumo_hora: f.usarResumo ? c.resumo_hora : null, antecedencia_min: Number(c.antecedencia_min),
      avisar_treino: c.avisar_treino, avisar_remedios: c.avisar_remedios, avisar_consultas: c.avisar_consultas,
      avisar_entrevistas: c.avisar_entrevistas, avisar_refeicoes: c.avisar_refeicoes,
      silencio_inicio: f.usarSilencio ? c.silencio_inicio : null, silencio_fim: f.usarSilencio ? c.silencio_fim : null,
    });
    f.apikey = '';
    avisar(cfg.value.ativo ? 'Avisos ligados' : 'Configuração salva');
    previa.value = (await api.get<{ avisos: Previa[] }>('/avisos/previa')).avisos;
  } catch (e) { erro.value = (e as Error).message; } finally { salvando.value = false; }
}
async function testar(rota: string) {
  try { await api.post(rota, {}); avisar('Mensagem de teste enviada'); } catch (e) { avisar((e as Error).message, 'erro'); }
}
async function gerarCodigo(tipo: 'pessoal' | 'casa') {
  try { codigo.value = { ...(await api.post<any>('/avisos/telegram/codigo', { tipo })), tipo }; } catch (e) { avisar((e as Error).message, 'erro'); }
}
async function desvincular() {
  await api.del('/avisos/telegram'); await carregar();
}
async function salvarCasa(ativar?: boolean) {
  if (!casa.value) return;
  const k = casa.value;
  try {
    await api.put('/avisos/casa', { ativo: ativar ?? k.ativo, resumo_hora: k.resumo_hora, avisar_tarefas: k.avisar_tarefas, avisar_contas: k.avisar_contas, dias_antes_contas: Number(k.dias_antes_contas) });
    avisar('Grupo da casa salvo');
    await carregar();
  } catch (e) { avisar((e as Error).message, 'erro'); }
}
/** Prévia como a mensagem chega: *negrito* do WhatsApp vira <b> (texto escapado antes; nada de HTML do usuário passa). */
const formatar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
const prontoWhats = computed(() => !!cfg.value?.telefone && (cfg.value.tem_apikey || !!f.apikey.trim()));
/** O canal escolhido tem tudo para enviar? (WhatsApp: número + chave; Telegram: chat vinculado; grupo: grupo vinculado) */
const canalPronto = computed(() => {
  const c = cfg.value;
  if (!c) return false;
  return c.canal === 'callmebot' ? prontoWhats.value : c.canal === 'telegram' ? c.telegram_vinculado : c.grupo_vinculado;
});
</script>

<template>
  <div class="pagina estreita modulo">
    <header class="cabecalho">
      <div>
        <RouterLink to="/conta" class="btn link">Minha conta</RouterLink>
        <h1>Avisos</h1>
        <p>Lembretes no seu WhatsApp ou Telegram: resumo do dia, treino, remédios e compromissos. Cada pessoa configura os seus.</p>
      </div>
    </header>
    <p v-if="erro" class="erro-form" role="alert">{{ erro }}</p>

    <template v-if="cfg">
      <!-- ---------------------------------------------------------- canal -->
      <section class="painel bloco">
        <div class="linha-topo">
          <h2>Onde receber</h2>
          <span :class="['selo', cfg.ativo ? 'paga' : '']">{{ cfg.ativo ? 'Ligado' : 'Desligado' }}</span>
        </div>
        <div class="segmentado canal">
          <button :aria-pressed="cfg.canal === 'callmebot'" @click="cfg.canal = 'callmebot'">WhatsApp</button>
          <button :aria-pressed="cfg.canal === 'telegram'" @click="cfg.canal = 'telegram'">Telegram</button>
          <button :aria-pressed="cfg.canal === 'grupo'" @click="cfg.canal = 'grupo'">Grupo</button>
        </div>

        <template v-if="cfg.canal === 'callmebot'">
          <ol class="passos">
            <li>Salve o número <b>{{ CALLMEBOT }}</b> nos contatos (CallMeBot, serviço grátis para uso pessoal).</li>
            <li>Mande para ele no WhatsApp: <code>I allow callmebot to send me messages</code></li>
            <li>Ele responde com a sua <b>apikey</b>. Cole aqui embaixo.</li>
          </ol>
          <div class="linha">
            <label class="campo"><span>Seu WhatsApp (com DDI e DDD)</span><input v-model="cfg.telefone" inputmode="tel" placeholder="+55 55 99999-8888" /></label>
            <label class="campo"><span>apikey do CallMeBot</span>
              <input v-model="f.apikey" autocomplete="off" :placeholder="cfg.tem_apikey ? '•••••• (salva — preencha só para trocar)' : '123456'" />
            </label>
          </div>
          <p class="suave miudo">Só manda para o seu próprio número. As mensagens passam pelo servidor do CallMeBot: se não quiser que ele veja nomes de consultas ou remédios, ligue o <b>modo discreto</b> abaixo.</p>
        </template>

        <template v-else-if="cfg.canal === 'grupo'">
          <p>Seus avisos vão para o grupo da casa no Telegram, com o seu nome no topo (ex.: <b>👤 {{ sessao.eu?.nome?.split(' ')[0] }}</b> — hora do treino).</p>
          <p v-if="!cfg.grupo_vinculado" class="aviso">O grupo ainda não foi vinculado. {{ admin ? 'Vincule na seção "Grupo da casa" abaixo.' : 'Peça ao administrador da casa.' }}</p>
          <p class="suave miudo">Todos do grupo leem: para remédios e consultas, considere o <b>modo discreto</b>.</p>
        </template>

        <template v-else>
          <p v-if="!cfg.telegram_disponivel" class="aviso">O robô do Telegram ainda não foi configurado no servidor (veja o README: "Avisos").</p>
          <template v-else-if="cfg.telegram_vinculado">
            <p>✅ Telegram vinculado<span v-if="cfg.telegram_robo"> ao @{{ cfg.telegram_robo }}</span>.</p>
            <button class="btn" @click="desvincular">Desvincular</button>
          </template>
          <template v-else>
            <p>Toque para abrir o robô e enviar o código (vale 30 minutos).</p>
            <button class="btn" @click="gerarCodigo('pessoal')">Gerar link de vínculo</button>
            <div v-if="codigo?.tipo === 'pessoal'" class="codigo">
              <a v-if="codigo.link" :href="codigo.link" target="_blank" rel="noopener noreferrer" class="btn primario">Abrir no Telegram</a>
              <span class="suave">ou mande ao robô: <code>{{ codigo.comando }}</code></span>
              <button class="btn-link" @click="carregar">Já mandei, atualizar</button>
            </div>
          </template>
        </template>

        <div class="acoes">
          <button class="btn" :disabled="!canalPronto" @click="salvar().then(() => testar('/avisos/teste'))">Salvar e testar</button>
          <button v-if="!cfg.ativo" class="btn primario" :disabled="salvando || !canalPronto" @click="salvar(true)">Ligar avisos</button>
          <button v-else class="btn perigo" :disabled="salvando" @click="salvar(false)">Desligar</button>
        </div>
      </section>

      <!-- -------------------------------------------------------- o que avisar -->
      <section class="painel bloco">
        <h2>O que avisar</h2>
        <label class="opcao"><input v-model="f.usarResumo" type="checkbox" /><span><b>Resumo do dia</b><small>Treino, tarefas, remédios e compromissos de hoje.</small></span>
          <input v-if="f.usarResumo" v-model="cfg.resumo_hora" type="time" class="hora" aria-label="Horário do resumo" @click.stop /></label>
        <label class="opcao"><input v-model="cfg.avisar_treino" type="checkbox" /><span><b>Hora do treino</b><small>No horário da ficha do dia (se não tiver feito ainda).</small></span></label>
        <label class="opcao"><input v-model="cfg.avisar_remedios" type="checkbox" /><span><b>Remédios</b><small>Em cada horário, se a dose não foi marcada.</small></span></label>
        <label class="opcao"><input v-model="cfg.avisar_consultas" type="checkbox" /><span><b>Consultas e exames</b></span></label>
        <label class="opcao"><input v-model="cfg.avisar_entrevistas" type="checkbox" /><span><b>Entrevistas</b></span></label>
        <label class="opcao"><input v-model="cfg.avisar_refeicoes" type="checkbox" /><span><b>Refeições</b><small>Só as marcadas com "avisar no horário" no plano de dieta.</small></span></label>
        <div class="linha">
          <label class="campo"><span>Avisar compromissos com antecedência de</span>
            <select v-model.number="cfg.antecedencia_min">
              <option v-for="m in [15, 30, 60, 120, 180]" :key="m" :value="m">{{ m < 60 ? `${m} min` : `${m / 60} h` }}</option>
            </select>
          </label>
        </div>
        <label class="opcao"><input v-model="f.usarSilencio" type="checkbox" /><span><b>Não perturbe</b><small>Nada é enviado nesse intervalo.</small></span></label>
        <div v-if="f.usarSilencio" class="linha">
          <label class="campo"><span>Das</span><input v-model="cfg.silencio_inicio" type="time" /></label>
          <label class="campo"><span>Até</span><input v-model="cfg.silencio_fim" type="time" /></label>
        </div>
        <label class="opcao"><input v-model="cfg.discreto" type="checkbox" /><span><b>Modo discreto</b><small>Sem nomes de consultas, remédios e tarefas na mensagem (ex.: "Compromisso às 14:30").</small></span></label>
        <div class="acoes"><button class="btn primario" :disabled="salvando" @click="salvar()">Salvar</button></div>
      </section>

      <!-- ---------------------------------------------------------------- prévia -->
      <section class="secao">
        <header><h2>Hoje você receberia</h2></header>
        <ul v-if="previa.length" class="lista painel">
          <li v-for="p in previa" :key="p.sai_as + p.tipo + p.texto" class="previa">
            <span class="hora-previa">{{ p.sai_as }}</span>
            <div class="texto" v-html="formatar(p.texto)" />
          </li>
        </ul>
        <div v-else class="vazio painel"><span>Nada programado para hoje com a configuração atual.</span></div>
      </section>
    </template>

    <!-- ------------------------------------------------------------ grupo da casa -->
    <section v-if="casa" class="painel bloco">
      <div class="linha-topo">
        <h2>Grupo da casa (Telegram)</h2>
        <span :class="['selo', casa.ativo && casa.grupo_vinculado ? 'paga' : '']">{{ casa.ativo && casa.grupo_vinculado ? 'Ligado' : 'Desligado' }}</span>
      </div>
      <p class="suave">Resumo diário para todos: tarefas compartilhadas (com o responsável) e contas/faturas vencendo. WhatsApp grátis não manda para grupos, por isso o grupo é no Telegram.</p>
      <p v-if="!casa.telegram_disponivel" class="aviso">O robô do Telegram ainda não foi configurado no servidor.</p>
      <template v-else-if="!casa.grupo_vinculado">
        <ol v-if="admin" class="passos">
          <li>Crie um grupo no Telegram com quem mora com você.</li>
          <li>Gere o código e adicione o robô ao grupo pelo link (ou adicione @{{ casa.telegram_robo ?? 'seu robô' }} e mande o comando no grupo).</li>
        </ol>
        <button v-if="admin" class="btn" @click="gerarCodigo('casa')">Gerar código do grupo</button>
        <p v-else class="suave">Peça ao administrador da casa para vincular o grupo.</p>
        <div v-if="codigo?.tipo === 'casa'" class="codigo">
          <a v-if="codigo.link_grupo" :href="codigo.link_grupo" target="_blank" rel="noopener noreferrer" class="btn primario">Adicionar robô ao grupo</a>
          <span class="suave">ou mande no grupo: <code>{{ codigo.comando }}</code></span>
          <button class="btn-link" @click="carregar">Já mandei, atualizar</button>
        </div>
      </template>
      <template v-else>
        <p>✅ Grupo vinculado{{ casa.titulo_grupo ? `: ${casa.titulo_grupo}` : '' }}.</p>
        <fieldset :disabled="!admin" class="campos-casa">
          <div class="linha">
            <label class="campo"><span>Horário do resumo</span><input v-model="casa.resumo_hora" type="time" /></label>
            <label class="campo"><span>Avisar contas com antecedência de</span>
              <select v-model.number="casa.dias_antes_contas"><option v-for="d in [0, 1, 2, 3, 5, 7]" :key="d" :value="d">{{ d === 0 ? 'só no dia' : `${d} dia${d > 1 ? 's' : ''}` }}</option></select>
            </label>
          </div>
          <label class="opcao"><input v-model="casa.avisar_tarefas" type="checkbox" /><span><b>Tarefas da casa</b></span></label>
          <label class="opcao"><input v-model="casa.avisar_contas" type="checkbox" /><span><b>Contas e faturas vencendo</b></span></label>
        </fieldset>
        <div v-if="admin" class="acoes">
          <button class="btn" @click="testar('/avisos/casa/teste')">Testar</button>
          <button v-if="casa.ativo" class="btn perigo" @click="salvarCasa(false)">Desligar</button>
          <button class="btn primario" @click="salvarCasa(true)">{{ casa.ativo ? 'Salvar' : 'Ligar' }}</button>
        </div>
        <template v-if="casa.previa.length">
          <h3 class="sub">Hoje o grupo receberia ({{ casa.previa[0].sai_as }})</h3>
          <div class="mensagem" v-html="formatar(casa.previa[0].texto)" />
        </template>
      </template>
    </section>
  </div>
</template>

<style scoped>
.bloco { padding: 18px 20px; display: grid; gap: 14px; }
.bloco h2 { font-size: 1.05rem; margin: 0; }
.linha-topo { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.canal { justify-self: start; }
.passos { margin: 0; padding-left: 20px; display: grid; gap: 6px; color: var(--ink-2); }
code { background: var(--surface-2); padding: 1px 6px; border-radius: 6px; font-size: 0.85em; overflow-wrap: anywhere; }
.aviso { margin: 0; padding: 10px 12px; border-radius: var(--raio-s); background: var(--previsto-tint); color: var(--previsto); }
.codigo { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.acoes { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.opcao { display: flex; gap: 12px; align-items: center; cursor: pointer; min-height: 44px; }
.opcao > input[type='checkbox'] { width: 20px; height: 20px; min-height: 0; flex: none; accent-color: var(--marca); }
.opcao > span { display: grid; gap: 1px; flex: 1; min-width: 0; }
.opcao small { color: var(--ink-3); font-size: 0.8rem; }
.opcao .hora { width: auto; flex: none; }
.secao > header h2 { font-size: 1rem; margin: 0; }
.lista > li.previa { grid-template-columns: 52px minmax(0, 1fr); align-items: start; }
.hora-previa { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink-2); padding-top: 1px; }
.texto { white-space: pre-wrap; font-size: 0.875rem; overflow-wrap: anywhere; }
.btn-link { border: 0; background: none; color: var(--marca-tint-ink); font: 600 0.875rem var(--fonte); cursor: pointer; min-height: 40px; }
.campos-casa { border: 0; padding: 0; margin: 0; display: grid; gap: 10px; min-width: 0; }
.sub { font-size: 0.9rem; margin: 6px 0 0; }
.mensagem { margin: 0; white-space: pre-wrap; font: 0.875rem/1.5 var(--fonte); background: var(--surface-2); padding: 12px 14px; border-radius: var(--raio-s); overflow-wrap: anywhere; }
</style>

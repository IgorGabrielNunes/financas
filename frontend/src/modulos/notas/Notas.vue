<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../core/api';
import { avisar, avisarMudanca, versao } from '../../core/store';
import { dataCurta } from '../../core/format';
import Modal from '../../ui/Modal.vue';

type Nota = { id: string; titulo: string; conteudo: string; etiquetas: string[]; fixada: boolean; cor: string | null; arquivada: boolean; updated_at: string };

const route = useRoute();
const router = useRouter();
const notas = ref<Nota[]>([]);
const etiquetas = ref<{ etiqueta: string; qtd: number }[]>([]);
const busca = ref('');
const etiqueta = ref<string | null>(null);
const arquivadas = ref(false);
const erro = ref('');
const carregando = ref(true);

let t: ReturnType<typeof setTimeout> | undefined;
async function carregar() {
  const p = new URLSearchParams({ arquivada: String(arquivadas.value) });
  if (busca.value.trim()) p.set('q', busca.value.trim());
  if (etiqueta.value) p.set('etiqueta', etiqueta.value);
  try {
    [notas.value, etiquetas.value] = await Promise.all([api.get<Nota[]>(`/notas?${p}`), api.get<typeof etiquetas.value>('/notas-etiquetas')]);
  } catch (e) { erro.value = (e as Error).message; } finally { carregando.value = false; }
}
onMounted(() => { carregar(); if (route.query.novo) novo(); });
watch([etiqueta, arquivadas, versao], carregar);
watch(busca, () => { clearTimeout(t); t = setTimeout(carregar, 250); });
watch(() => route.query.novo, (v) => v && novo());

const fixadas = computed(() => notas.value.filter((n) => n.fixada));
const outras = computed(() => notas.value.filter((n) => !n.fixada));

// ------------------------------------------------------------------ editor
const CORES = [null, '#fef3c7', '#dcfce7', '#dbeafe', '#fce7f3', '#ede9fe', '#fee2e2'];
const editor = ref<{ id: string | null } | null>(null);
const f = reactive({ titulo: '', conteudo: '', etiquetas: [] as string[], fixada: false, cor: null as string | null, arquivada: false });
const novaEtiqueta = ref('');

function novo() {
  Object.assign(f, { titulo: '', conteudo: '', etiquetas: etiqueta.value ? [etiqueta.value] : [], fixada: false, cor: null, arquivada: false });
  editor.value = { id: null };
  if (route.query.novo) router.replace({ query: { ...route.query, novo: undefined } });
}
function abrir(n: Nota) {
  Object.assign(f, { titulo: n.titulo, conteudo: n.conteudo, etiquetas: [...n.etiquetas], fixada: n.fixada, cor: n.cor, arquivada: n.arquivada });
  editor.value = { id: n.id };
}
function addEtiqueta() {
  for (const e of novaEtiqueta.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) if (!f.etiquetas.includes(e)) f.etiquetas.push(e);
  novaEtiqueta.value = '';
}
async function salvar(extra: Partial<typeof f> = {}) {
  addEtiqueta();
  Object.assign(f, extra);
  if (!f.titulo.trim() && !f.conteudo.trim()) { editor.value = null; return; }
  try {
    if (editor.value?.id) await api.put(`/notas/${editor.value.id}`, f); else await api.post('/notas', f);
    editor.value = null;
    avisarMudanca();
  } catch (e) { avisar((e as Error).message, 'erro'); }
}
async function excluir() {
  if (!editor.value?.id || !confirm('Excluir esta anotação de vez?')) return;
  await api.del(`/notas/${editor.value.id}`).catch((e) => avisar(e.message, 'erro'));
  editor.value = null;
  avisarMudanca();
}
async function alternarFixada(n: Nota) {
  await api.patch(`/notas/${n.id}`, { fixada: !n.fixada }).catch((e) => avisar(e.message, 'erro'));
  avisarMudanca();
}
function atalho(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); salvar(); }
}
</script>

<template>
  <div class="pagina modulo">
    <header class="cabecalho">
      <div>
        <h1>Anotações</h1>
        <p>Ideias, links, listas e o que precisar guardar.</p>
      </div>
      <button class="btn primario" @click="novo">Nova anotação</button>
    </header>

    <div class="barra">
      <input v-model="busca" type="search" placeholder="Buscar nas anotações…" aria-label="Buscar" />
      <label class="arq"><input v-model="arquivadas" type="checkbox" /> Arquivadas</label>
    </div>
    <div v-if="etiquetas.length" class="etiquetas">
      <button :aria-pressed="!etiqueta" @click="etiqueta = null">Todas</button>
      <button v-for="e in etiquetas" :key="e.etiqueta" :aria-pressed="etiqueta === e.etiqueta" @click="etiqueta = etiqueta === e.etiqueta ? null : e.etiqueta">
        #{{ e.etiqueta }} <small>{{ e.qtd }}</small>
      </button>
    </div>
    <p v-if="erro" class="erro-form">{{ erro }}</p>

    <template v-for="[rotulo, lista] in ([['Fixadas', fixadas], [fixadas.length ? 'Outras' : '', outras]] as [string, Nota[]][])" :key="rotulo">
      <h2 v-if="lista.length && rotulo" class="rotulo">{{ rotulo }}</h2>
      <div v-if="lista.length" class="grade-notas">
        <article v-for="n in lista" :key="n.id" class="nota" :style="n.cor ? { '--fundo': n.cor } : {}" tabindex="0"
          @click="abrir(n)" @keydown.enter="abrir(n)">
          <button class="pino" :aria-pressed="n.fixada" :aria-label="n.fixada ? 'Desafixar' : 'Fixar'" @click.stop="alternarFixada(n)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" /></svg>
          </button>
          <h3 v-if="n.titulo">{{ n.titulo }}</h3>
          <p>{{ n.conteudo }}</p>
          <footer>
            <span v-for="e in n.etiquetas" :key="e">#{{ e }}</span>
            <time>{{ dataCurta(n.updated_at.slice(0, 10)) }}</time>
          </footer>
        </article>
      </div>
    </template>
    <div v-if="!notas.length && !carregando" class="vazio painel">
      <b>{{ busca || etiqueta ? 'Nada encontrado' : arquivadas ? 'Nada arquivado' : 'Nenhuma anotação ainda' }}</b>
      <button v-if="!busca && !etiqueta && !arquivadas" class="btn" @click="novo">Escrever a primeira</button>
    </div>

    <Modal v-if="editor" :titulo="editor.id ? 'Anotação' : 'Nova anotação'" largo @fechar="salvar()">
      <form class="form editor" :style="f.cor ? { '--fundo': f.cor } : {}" @submit.prevent="salvar()" @keydown="atalho">
        <input v-model="f.titulo" class="titulo" placeholder="Título" maxlength="200" />
        <textarea v-model="f.conteudo" rows="12" placeholder="Escreva…" maxlength="100000" autofocus />
        <div class="tags">
          <span v-for="(e, i) in f.etiquetas" :key="e" class="tag">#{{ e }}<button type="button" :aria-label="`Remover ${e}`" @click="f.etiquetas.splice(i, 1)">×</button></span>
          <input v-model="novaEtiqueta" placeholder="+ etiqueta" list="etq" @keydown.enter.prevent="addEtiqueta" @keydown.,.prevent="addEtiqueta" @blur="addEtiqueta" />
          <datalist id="etq"><option v-for="e in etiquetas" :key="e.etiqueta" :value="e.etiqueta" /></datalist>
        </div>
        <div class="cores" role="radiogroup" aria-label="Cor">
          <button v-for="c in CORES" :key="c ?? 'n'" type="button" role="radio" :aria-checked="f.cor === c" :style="{ background: c ?? 'var(--surface)' }"
            :aria-label="c ?? 'Sem cor'" @click="f.cor = c" />
          <label class="fix"><input v-model="f.fixada" type="checkbox" /> Fixada</label>
        </div>
        <div class="acoes">
          <button v-if="editor.id" class="btn perigo" type="button" @click="excluir">Excluir</button>
          <button v-if="editor.id" class="btn" type="button" @click="salvar({ arquivada: !f.arquivada })">{{ f.arquivada ? 'Desarquivar' : 'Arquivar' }}</button>
          <button class="btn primario" type="submit">Salvar</button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.barra { display: flex; gap: 12px; align-items: center; }
.barra input[type='search'] { flex: 1; }
.arq { display: inline-flex; gap: 6px; align-items: center; color: var(--ink-2); font-size: 0.9rem; white-space: nowrap; cursor: pointer; }
.arq input, .fix input { min-height: 0; width: 18px; height: 18px; accent-color: var(--marca); }
.etiquetas { display: flex; gap: 6px; overflow-x: auto; padding: 2px 0; scrollbar-width: none; }
.etiquetas button { flex: none; font: 600 0.82rem var(--fonte); padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2); cursor: pointer; }
.etiquetas small { color: var(--ink-3); margin-left: 3px; }
.etiquetas button[aria-pressed='true'] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.rotulo { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); margin: 6px 0 -8px 2px; }
.grade-notas { columns: 260px; column-gap: 14px; }
.nota {
  --fundo: var(--surface);
  break-inside: avoid; margin-bottom: 14px; position: relative; cursor: pointer; padding: 16px 16px 12px;
  background: var(--fundo); border: 1px solid var(--line); border-radius: var(--raio-m); color: #1c1917;
}
.nota:not([style]) { color: var(--ink); }
.nota:hover { box-shadow: var(--sombra-flutuante); }
.nota h3 { font-size: 1rem; margin: 0 28px 6px 0; }
.nota p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 10; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.9rem; line-height: 1.5; }
.nota footer { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 10px; font-size: 0.75rem; opacity: 0.65; }
.nota time { margin-left: auto; }
.pino { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border: 0; background: none; border-radius: 8px; cursor: pointer; color: inherit; opacity: 0; display: grid; place-items: center; }
.nota:hover .pino, .pino[aria-pressed='true'], .nota:focus-within .pino { opacity: 0.7; }
.pino[aria-pressed='true'] svg { fill: currentColor; }
.pino svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
@media (hover: none) { .pino { opacity: 0.45; } }

.editor .titulo { font-size: 1.2rem; font-weight: 650; }
.editor textarea { min-height: 260px; line-height: 1.55; resize: vertical; }
.editor[style] .titulo, .editor[style] textarea { background: var(--fundo); color: #1c1917; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tag { display: inline-flex; align-items: center; gap: 2px; padding: 4px 4px 4px 10px; border-radius: 999px; background: var(--surface-2); font-size: 0.85rem; font-weight: 600; }
.tag button { border: 0; background: none; cursor: pointer; color: var(--ink-3); font-size: 1rem; padding: 0 6px; }
.tags input { flex: 1; min-width: 120px; min-height: 36px; }
.cores { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cores button { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--line-2); cursor: pointer; padding: 0; }
.cores button[aria-checked='true'] { outline: 2px solid var(--marca); outline-offset: 2px; }
.fix { margin-left: auto; display: inline-flex; gap: 6px; align-items: center; font-size: 0.9rem; color: var(--ink-2); cursor: pointer; }
@media (pointer: coarse) {
  .etiquetas button { min-height: 40px; padding: 8px 14px; }
  .pino { width: 40px; height: 40px; top: 4px; right: 4px; }
  .tag button { min-width: 32px; min-height: 32px; }
}
</style>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, type Lancamento, type Meio, type ParcelaPlanejada } from '../api';
import { avisar, avisarMudanca, cadastros, lancamentoModal } from '../store';
import { dataCurta, dinheiro, hoje, mesAno, MEIOS } from '../format';
import Modal from './Modal.vue';
import MoneyInput from './MoneyInput.vue';
import Comprovantes from './Comprovantes.vue';
import { enviarComprovante } from './comprimir';

type Parcela = { numero: number; valor_centavos: number; competencia: string; data_vencimento: string; fatura_id: string };

const editando = computed(() => lancamentoModal.id);
const f = reactive({
  tipo: 'despesa' as 'despesa' | 'receita',
  valor_centavos: 0,
  descricao: '',
  meio: 'debito' as Meio,
  conta_id: null as string | null,
  cartao_id: null as string | null,
  categoria_id: null as string | null,
  parcelas_total: 1,
  parcelas_pagas_antes: 0,
  data: hoje(),
  status: 'realizado' as 'realizado' | 'previsto',
  observacao: '',
});
const parcelasAtuais = ref<Parcela[]>([]);
const pendentes = ref<File[]>([]); // comprovantes escolhidos antes de o lançamento existir
const salvando = ref(false);
const erro = ref('');
const simulacao = ref<ParcelaPlanejada[]>([]);

const contasAtivas = computed(() => cadastros.contas.filter((c) => c.ativa));
const cartoesAtivos = computed(() => cadastros.cartoes.filter((c) => c.ativo));
const categorias = computed(() => cadastros.categorias.filter((c) => c.tipo === f.tipo));
const meios = computed<Meio[]>(() =>
  f.tipo === 'receita' ? ['pix', 'transferencia', 'dinheiro', 'debito'] : ['debito', 'pix', 'credito', 'dinheiro', 'boleto', 'transferencia'],
);
const cartaoSel = computed(() => cadastros.cartoes.find((c) => c.id === f.cartao_id));

onMounted(async () => {
  if (editando.value) {
    const l = await api.get<Lancamento & { parcelas: Parcela[] }>(`/lancamentos/${editando.value}`);
    Object.assign(f, {
      tipo: l.tipo, valor_centavos: l.valor_centavos, descricao: l.descricao, meio: l.meio, conta_id: l.conta_id,
      cartao_id: l.cartao_id, categoria_id: l.categoria_id, parcelas_total: l.parcelas_total,
      parcelas_pagas_antes: l.parcelas_pagas_antes ?? 0, data: l.data,
      status: l.status, observacao: l.observacao ?? '',
    });
    parcelasAtuais.value = l.parcelas;
  }
  Object.assign(f, lancamentoModal.preset); // depois do load: "Confirmar" abre a edição já como realizado
  if (!f.conta_id && f.meio !== 'credito') f.conta_id = contasAtivas.value[0]?.id ?? null;
  if (!f.cartao_id) f.cartao_id = cartoesAtivos.value[0]?.id ?? null;
});

watch(() => f.tipo, () => {
  if (!meios.value.includes(f.meio)) f.meio = meios.value[0];
  if (!categorias.value.some((c) => c.id === f.categoria_id)) f.categoria_id = null;
});

// Prévia "em qual fatura cai": debounce simples para não martelar a API a cada dígito
let t: ReturnType<typeof setTimeout>;
watch(() => [f.meio, f.cartao_id, f.valor_centavos, f.parcelas_total, f.data], () => {
  clearTimeout(t);
  simulacao.value = [];
  if (f.meio !== 'credito' || !f.cartao_id || f.valor_centavos <= 0) return;
  t = setTimeout(async () => {
    simulacao.value = await api
      .get<ParcelaPlanejada[]>(`/cartoes/${f.cartao_id}/simular?data=${f.data}&valor=${f.valor_centavos}&parcelas=${f.parcelas_total}`)
      .catch(() => []);
  }, 250);
}, { immediate: true });

// Compra antiga ainda em andamento: parcelas com vencimento antes de hoje provavelmente já foram pagas
const parcelasVencidas = computed(() => simulacao.value.filter((p) => p.ciclo.dataVencimento < hoje()).length);
watch(parcelasVencidas, (n) => {
  if (!editando.value) f.parcelas_pagas_antes = Math.min(n, Math.max(f.parcelas_total - 1, 0));
});
watch(() => f.parcelas_total, (n) => { if (f.parcelas_pagas_antes >= n) f.parcelas_pagas_antes = Math.max(n - 1, 0); });

const estouraLimite = computed(() =>
  f.meio === 'credito' && cartaoSel.value && !editando.value && f.valor_centavos > cartaoSel.value.livre_centavos,
);

function fechar() {
  lancamentoModal.aberto = false;
}

async function salvar() {
  erro.value = '';
  if (f.valor_centavos <= 0) return (erro.value = 'Informe o valor.');
  if (!f.descricao.trim()) return (erro.value = 'Informe uma descrição.');
  if (f.meio === 'credito' && !f.cartao_id) return (erro.value = 'Escolha o cartão.');
  const payload = {
    ...f,
    descricao: f.descricao.trim(),
    conta_id: f.meio === 'credito' ? null : f.conta_id,
    cartao_id: f.meio === 'credito' ? f.cartao_id : null,
    parcelas_total: f.meio === 'credito' ? f.parcelas_total : 1,
    parcelas_pagas_antes: f.meio === 'credito' ? f.parcelas_pagas_antes : 0,
    observacao: f.observacao.trim() || null,
  };
  salvando.value = true;
  try {
    if (editando.value) {
      await api.patch(`/lancamentos/${editando.value}`, payload);
    } else {
      const { id } = await api.post<{ id: string }>('/lancamentos', payload);
      for (const arq of pendentes.value) await enviarComprovante(id, arq);
    }
    avisar(editando.value ? 'Lançamento atualizado' : 'Lançamento salvo');
    avisarMudanca();
    fechar();
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    salvando.value = false;
  }
}

async function excluir() {
  const aviso = f.meio === 'credito' && f.parcelas_total > 1 ? ' Todas as parcelas serão removidas das faturas.' : '';
  if (!confirm(`Excluir "${f.descricao}"?${aviso}`)) return;
  try {
    await api.del(`/lancamentos/${editando.value}`);
    avisar('Lançamento excluído');
    avisarMudanca();
    fechar();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

function escolherPendentes(e: Event) {
  const input = e.target as HTMLInputElement;
  pendentes.value.push(...Array.from(input.files ?? []));
  input.value = '';
}
</script>

<template>
  <Modal :titulo="editando ? 'Editar lançamento' : 'Novo lançamento'" @fechar="fechar">
    <form class="form" @submit.prevent="salvar">
      <div class="segmentado" role="group" aria-label="Tipo">
        <button type="button" :aria-pressed="f.tipo === 'despesa'" @click="f.tipo = 'despesa'">Saiu dinheiro</button>
        <button type="button" :aria-pressed="f.tipo === 'receita'" @click="f.tipo = 'receita'">Entrou dinheiro</button>
      </div>

      <label class="campo">
        <span>Valor{{ f.meio === 'credito' && f.parcelas_total > 1 ? ' total da compra' : '' }}</span>
        <MoneyInput v-model="f.valor_centavos" grande />
      </label>

      <label class="campo">
        <span>Descrição</span>
        <input v-model="f.descricao" maxlength="120" placeholder="Ex.: mercado, gasolina, farmácia" autocomplete="off" />
      </label>

      <div class="campo">
        <span>Como pagou</span>
        <div class="chips">
          <button v-for="m in meios" :key="m" type="button" :class="{ credito: m === 'credito' }" :aria-pressed="f.meio === m" @click="f.meio = m">
            {{ MEIOS[m] }}
          </button>
        </div>
      </div>

      <template v-if="f.meio === 'credito'">
        <div class="linha">
          <label class="campo">
            <span>Cartão</span>
            <select v-model="f.cartao_id">
              <option v-for="c in cartoesAtivos" :key="c.id" :value="c.id">{{ c.nome }}</option>
            </select>
          </label>
          <label class="campo">
            <span>Parcelas</span>
            <select v-model.number="f.parcelas_total">
              <option v-for="n in 24" :key="n" :value="n">{{ n === 1 ? 'À vista' : `${n}x` }}</option>
            </select>
          </label>
        </div>
        <div v-if="simulacao.length" class="previa">
          <p>
            <template v-if="f.parcelas_total > 1">{{ f.parcelas_total }}x de {{ dinheiro(simulacao[1]?.valorCentavos ?? simulacao[0].valorCentavos) }}, começando na</template>
            <template v-else>Entra na</template>
            fatura de <b>{{ mesAno(simulacao[0].ciclo.competencia) }}</b>, que vence em {{ dataCurta(simulacao[0].ciclo.dataVencimento) }}.
            <template v-if="f.parcelas_total > 1">A última parcela cai em {{ mesAno(simulacao[simulacao.length - 1].ciclo.competencia) }}.</template>
          </p>
          <label v-if="f.parcelas_total > 1 && (parcelasVencidas > 0 || f.parcelas_pagas_antes > 0)" class="campo">
            <span>Parcelas que você já pagou antes de usar o Caixa</span>
            <select v-model.number="f.parcelas_pagas_antes">
              <option v-for="n in f.parcelas_total" :key="n - 1" :value="n - 1">{{ n - 1 }}</option>
            </select>
            <small>Essas parcelas não entram em fatura nem no limite usado.</small>
          </label>
          <p v-if="estouraLimite" class="sai">Passa do limite livre deste cartão ({{ dinheiro(cartaoSel!.livre_centavos) }}).</p>
          <p v-if="parcelasAtuais.length" class="miudo suave">Alterar valor, data ou parcelas recalcula todas as parcelas.</p>
        </div>
        <p v-if="!cartoesAtivos.length" class="sai">Cadastre um cartão em Cartões primeiro.</p>
      </template>

      <label v-else class="campo">
        <span>{{ f.tipo === 'receita' ? 'Entrou na conta' : 'Saiu da conta' }}</span>
        <select v-model="f.conta_id">
          <option :value="null">Nenhuma (não afeta saldo)</option>
          <option v-for="c in contasAtivas" :key="c.id" :value="c.id">{{ c.nome }}</option>
        </select>
      </label>

      <div class="linha">
        <label class="campo">
          <span>Categoria</span>
          <select v-model="f.categoria_id">
            <option :value="null">Sem categoria</option>
            <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
          </select>
        </label>
        <label class="campo">
          <span>Data</span>
          <input v-model="f.data" type="date" required />
        </label>
      </div>

      <div v-if="f.meio !== 'credito'" class="segmentado" role="group" aria-label="Situação">
        <button type="button" :aria-pressed="f.status === 'realizado'" @click="f.status = 'realizado'">Já aconteceu</button>
        <button type="button" :aria-pressed="f.status === 'previsto'" @click="f.status = 'previsto'">Ainda vai acontecer</button>
      </div>

      <label class="campo">
        <span>Observação</span>
        <textarea v-model="f.observacao" rows="2" maxlength="500" />
      </label>

      <div class="campo">
        <span>Comprovantes</span>
        <Comprovantes v-if="editando" :lancamento-id="editando" />
        <template v-else>
          <ul v-if="pendentes.length" class="pendentes">
            <li v-for="(p, i) in pendentes" :key="i">{{ p.name }} <button class="btn link" type="button" @click="pendentes.splice(i, 1)">remover</button></li>
          </ul>
          <label class="btn">
            Anexar foto ou PDF
            <input class="sr" type="file" accept="image/*,application/pdf" multiple @change="escolherPendentes" />
          </label>
        </template>
      </div>

      <p v-if="erro" class="erro-form" role="alert">{{ erro }}</p>

      <div class="acoes">
        <button v-if="editando" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit" :disabled="salvando">{{ salvando ? 'Salvando…' : 'Salvar lançamento' }}</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips button {
  font: 600 0.875rem var(--texto); padding: 8px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink-2);
}
.chips button[aria-pressed='true'] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.chips button.credito[aria-pressed='true'] { background: var(--sai); border-color: var(--sai); color: #fff; }
.previa { border-left: 3px solid var(--sai); padding: 8px 12px; background: var(--surface-2); border-radius: 0 var(--raio-s) var(--raio-s) 0; display: grid; gap: 4px; font-size: 0.9rem; }
.pendentes { margin: 0; padding-left: 18px; font-size: 0.875rem; }
.acoes { position: sticky; bottom: 0; background: var(--surface); padding-top: 6px; }
</style>

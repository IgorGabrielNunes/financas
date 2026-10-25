<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../../../core/api';
import { avisar, avisarMudanca, cadastros } from '../../../core/store';
import { hoje } from '../../../core/format';
import Modal from '../../../ui/Modal.vue';
import MoneyInput from '../../../ui/MoneyInput.vue';
import { INDEXADORES, numero, TIPOS_INVEST, type Indexador, type Investimento, type Membro, type Meta } from '../investir';

const props = defineProps<{ investimento?: Investimento | null; metaId?: string | null }>();
const emit = defineEmits<{ fechar: []; salvo: [id: string] }>();
const i = props.investimento;
const contas = computed(() => cadastros.contas.filter((c) => c.ativa || c.id === i?.conta_id));

const f = reactive({
  nome: i?.nome ?? '',
  tipo: i?.tipo ?? 'caixinha',
  indexador: (i?.indexador ?? 'cdi') as Indexador,
  taxa: String(i?.taxa ?? 100).replace('.', ','),
  isento_ir: i?.isento_ir ?? false,
  taxa_adm_aa: String(i?.taxa_adm_aa ?? 0).replace('.', ','),
  liquidez: i?.liquidez ?? 'diaria',
  vencimento: i?.vencimento ?? '',
  conta_id: i?.conta_id ?? contas.value[0]?.id ?? '',
  meta_id: i?.meta_id ?? props.metaId ?? null,
  usuario_id: i?.usuario_id ?? null,
  ativo: i?.ativo ?? true,
  observacao: i?.observacao ?? '',
});
// só na criação: o que já existe aplicado
const ini = reactive({ valor_centavos: 0, data: hoje(), saldo_atual_centavos: 0, conta_origem_id: null as string | null });
const erro = ref('');
const metas = ref<Meta[]>([]);
const membros = ref<Membro[]>([]);
Promise.all([api.get<Meta[]>('/metas'), api.get<Membro[]>('/membros')]).then(([m, u]) => { metas.value = m; membros.value = u; }).catch(() => {});

// trocar o tipo preenche o modelo típico (só ao criar, para não sobrescrever o que o usuário já ajustou)
watch(() => f.tipo, (t) => {
  if (i) return;
  const p = TIPOS_INVEST[t];
  Object.assign(f, { indexador: p.modelo.indexador, taxa: String(p.modelo.taxa).replace('.', ','), isento_ir: p.modelo.isento_ir,
    taxa_adm_aa: String(p.modelo.taxa_adm_aa ?? 0).replace('.', ','), liquidez: p.liquidez });
});
const rotuloTaxa = computed(() => INDEXADORES[f.indexador].taxa);
const variavel = computed(() => f.indexador === 'nenhum');

async function salvar() {
  erro.value = '';
  const taxa = rotuloTaxa.value ? numero(f.taxa) : 0;
  if (taxa === null) { erro.value = 'Informe a taxa'; return; }
  if (!f.conta_id) { erro.value = 'Escolha a conta/banco onde o dinheiro está'; return; }
  const corpo = {
    ...f, taxa, taxa_adm_aa: numero(f.taxa_adm_aa) ?? 0, vencimento: f.vencimento || null, observacao: f.observacao || null,
  };
  try {
    let id: string;
    if (i) { await api.put(`/investimentos/${i.id}`, corpo); id = i.id; }
    else {
      const inicial = ini.valor_centavos > 0 ? { ...ini, saldo_atual_centavos: ini.saldo_atual_centavos || null } : null;
      id = (await api.post<{ id: string }>('/investimentos', { ...corpo, inicial })).id;
    }
    avisar('Investimento salvo');
    avisarMudanca();
    emit('salvo', id);
    emit('fechar');
  } catch (e) { erro.value = (e as Error).message; }
}
async function excluir() {
  if (!i || !confirm(`Excluir "${i.nome}" e todo o histórico? Aportes que saíram de contas voltam para o saldo delas.\n\nPara encerrar mantendo o histórico, registre o resgate e marque como encerrado.`)) return;
  try { await api.del(`/investimentos/${i.id}`); avisarMudanca(); emit('fechar'); } catch (e) { erro.value = (e as Error).message; }
}
</script>

<template>
  <Modal :titulo="i ? 'Editar investimento' : 'Novo investimento'" @fechar="emit('fechar')">
    <form class="form" @submit.prevent="salvar">
      <div class="linha">
        <label class="campo"><span>Tipo</span>
          <select v-model="f.tipo"><option v-for="(t, k) in TIPOS_INVEST" :key="k" :value="k">{{ t.nome }}</option></select>
        </label>
        <label class="campo"><span>Nome</span><input v-model="f.nome" required maxlength="80" placeholder="Ex.: Caixinha viagem, CDB Inter 2028" /></label>
      </div>
      <label class="campo">
        <span>Onde o dinheiro está</span>
        <select v-model="f.conta_id" required>
          <option v-for="c in contas" :key="c.id" :value="c.id">{{ c.nome }}</option>
        </select>
        <small v-if="!contas.length">Cadastre antes a conta/corretora em Carteira.</small>
        <small v-else>O banco ou corretora. O valor aparece ligado a essa conta, mas não soma no saldo dela nem no disponível.</small>
      </label>

      <fieldset class="grupo">
        <legend>Como rende (modelo atual)</legend>
        <div class="linha">
          <label class="campo"><span>Rentabilidade</span>
            <select v-model="f.indexador"><option v-for="(x, k) in INDEXADORES" :key="k" :value="k">{{ x.nome }}</option></select>
          </label>
          <label v-if="rotuloTaxa" class="campo"><span>{{ rotuloTaxa }}</span><input v-model="f.taxa" inputmode="decimal" required /></label>
        </div>
        <div v-if="!variavel" class="linha">
          <label class="campo"><span>Liquidez</span>
            <select v-model="f.liquidez"><option value="diaria">Saque a qualquer momento</option><option value="vencimento">Só no vencimento</option></select>
          </label>
          <label class="campo"><span>Vencimento</span><input v-model="f.vencimento" type="date" /></label>
        </div>
        <div v-if="!variavel" class="linha">
          <label class="check"><input v-model="f.isento_ir" type="checkbox" /> Isento de IR (LCI, LCA, poupança)</label>
          <label v-if="f.tipo === 'fundo_di' || numero(f.taxa_adm_aa)" class="campo"><span>Taxa de administração (% a.a.)</span><input v-model="f.taxa_adm_aa" inputmode="decimal" /></label>
        </div>
        <small v-if="variavel" class="suave">Ações, FII e cripto não têm rendimento previsível: informe o saldo de tempos em tempos para acompanhar.</small>
      </fieldset>

      <fieldset v-if="!i" class="grupo">
        <legend>Quanto já tem aqui</legend>
        <div class="linha">
          <label class="campo"><span>Valor aplicado</span><MoneyInput v-model="ini.valor_centavos" /></label>
          <label class="campo"><span>Data da aplicação</span><input v-model="ini.data" type="date" :max="hoje()" /></label>
        </div>
        <template v-if="ini.valor_centavos > 0">
          <label class="campo">
            <span>Saldo de hoje no app do banco (opcional)</span>
            <MoneyInput v-model="ini.saldo_atual_centavos" />
            <small>Com o saldo real, o Vida mostra o rendimento exato até hoje e estima daqui pra frente.</small>
          </label>
          <label class="campo"><span>Esse dinheiro está saindo de uma conta agora?</span>
            <select v-model="ini.conta_origem_id">
              <option :value="null">Não, já estava aplicado (não mexe no saldo das contas)</option>
              <option v-for="c in contas" :key="c.id" :value="c.id">Sim, sai de {{ c.nome }}</option>
            </select>
          </label>
        </template>
      </fieldset>

      <div class="linha">
        <label class="campo"><span>Meta (opcional)</span>
          <select v-model="f.meta_id">
            <option :value="null">Nenhuma</option>
            <option v-for="m in metas.filter((x) => !x.arquivada || x.id === f.meta_id)" :key="m.id" :value="m.id">{{ m.icone }} {{ m.nome }}</option>
          </select>
        </label>
        <label class="campo"><span>De quem é</span>
          <select v-model="f.usuario_id">
            <option :value="null">Da casa</option>
            <option v-for="u in membros" :key="u.id" :value="u.id">{{ u.nome }}</option>
          </select>
        </label>
      </div>
      <label v-if="i" class="campo"><span>Situação</span>
        <select v-model="f.ativo"><option :value="true">Ativo</option><option :value="false">Encerrado (sai dos totais)</option></select>
      </label>
      <label class="campo"><span>Observação</span><input v-model="f.observacao" maxlength="500" /></label>

      <p v-if="erro" class="erro-form">{{ erro }}</p>
      <div class="acoes">
        <button v-if="i" class="btn perigo" type="button" @click="excluir">Excluir</button>
        <button class="btn primario" type="submit">Salvar</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.grupo { border: 1px solid var(--line); border-radius: var(--raio-m); padding: 12px 14px 14px; margin: 0; display: grid; gap: 12px; min-width: 0; }
.grupo legend { font-weight: 650; font-size: 0.875rem; padding: 0 6px; }
.check { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; min-height: 44px; }
.check input { width: 20px; height: 20px; }
</style>

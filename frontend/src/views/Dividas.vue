<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Divida, type Inadimplencia } from '../api';
import { versao } from '../store';
import { dataBR, dataCurta, dinheiro, FORMAS_DIVIDA, mesAno, ORIGENS_INAD, STATUS_INAD, TIPOS_DIVIDA } from '../format';
import DividaForm from '../components/DividaForm.vue';
import InadimplenciaForm from '../components/InadimplenciaForm.vue';

const route = useRoute();
const router = useRouter();
const aba = computed(() => (route.query.aba === 'inadimplencia' ? 'inadimplencia' : 'dividas'));
const dividas = ref<Divida[]>([]);
const inads = ref<Inadimplencia[]>([]);
const formD = ref<{ aberto: boolean; item: Divida | null }>({ aberto: false, item: null });
const formI = ref<{ aberto: boolean; item: Inadimplencia | null }>({ aberto: false, item: null });

watch(versao, async () => {
  [dividas.value, inads.value] = await Promise.all([api.get<Divida[]>('/dividas'), api.get<Inadimplencia[]>('/inadimplencias')]);
}, { immediate: true });

const ativas = computed(() => dividas.value.filter((d) => d.ativa));
const quitadas = computed(() => dividas.value.filter((d) => !d.ativa));
const inadAbertas = computed(() => inads.value.filter((i) => i.status !== 'quitada'));
const inadQuitadas = computed(() => inads.value.filter((i) => i.status === 'quitada'));
const tot = computed(() => ({
  saldo: ativas.value.reduce((s, d) => s + d.saldo_nominal_centavos, 0),
  mensal: ativas.value.reduce((s, d) => s + d.valor_parcela_centavos, 0),
  atraso: inadAbertas.value.reduce((s, i) => s + i.em_aberto_centavos, 0),
}));
</script>

<template>
  <div class="pagina">
    <header class="cabecalho">
      <div>
        <h1>Dívidas</h1>
        <p>{{ dinheiro(tot.saldo) }} em parcelas a vencer, {{ dinheiro(tot.mensal) }} por mês. {{ dinheiro(tot.atraso) }} em atraso.</p>
      </div>
      <button v-if="aba === 'dividas'" class="btn primario" @click="formD = { aberto: true, item: null }">Adicionar dívida</button>
      <button v-else class="btn primario" @click="formI = { aberto: true, item: null }">Registrar atraso</button>
    </header>

    <div class="segmentado abas" role="tablist">
      <button role="tab" :aria-pressed="aba === 'dividas'" @click="router.replace({ query: {} })">Parceladas ({{ ativas.length }})</button>
      <button role="tab" :aria-pressed="aba === 'inadimplencia'" @click="router.replace({ query: { aba: 'inadimplencia' } })">Em atraso ({{ inadAbertas.length }})</button>
    </div>

    <!-- ------------------------------------------------------------ dívidas parceladas -->
    <template v-if="aba === 'dividas'">
      <div v-if="!ativas.length" class="painel vazio">
        <p>Consignado, empréstimo, financiamento: cadastre com o valor da parcela e a data da 1ª. As parcelas restantes entram nos fixos de cada mês.</p>
        <button class="btn primario" @click="formD = { aberto: true, item: null }">Adicionar dívida</button>
      </div>

      <div class="cartelas">
        <article v-for="d in ativas" :key="d.id" class="painel cartela clicavel" @click="formD = { aberto: true, item: d }">
          <header>
            <div>
              <h3>{{ TIPOS_DIVIDA[d.tipo] }}, {{ d.credor }}</h3>
              <p class="meta">{{ d.pessoa_nome ?? 'Do casal' }}, {{ FORMAS_DIVIDA[d.forma_pagamento].toLowerCase() }}<template v-if="d.descricao">, {{ d.descricao }}</template></p>
            </div>
            <b>{{ dinheiro(d.valor_parcela_centavos) }}<small>/mês</small></b>
          </header>
          <div class="progresso" :aria-label="`${d.parcelas_pagas} de ${d.parcelas_total} parcelas pagas`">
            <i :style="{ width: (d.parcelas_pagas / d.parcelas_total) * 100 + '%' }" />
          </div>
          <p class="miudo suave">{{ d.parcelas_pagas }} de {{ d.parcelas_total }} pagas. Termina em {{ mesAno(d.ultima_parcela) }}<template v-if="d.proxima_parcela">, próxima em {{ dataCurta(d.proxima_parcela) }}</template>.</p>
          <dl>
            <div><dt>Falta pagar</dt><dd class="sai">{{ dinheiro(d.saldo_nominal_centavos) }}</dd></div>
            <div v-if="d.valor_quitacao_estimado_centavos !== null">
              <dt>Para quitar hoje (estimado)</dt><dd>{{ dinheiro(d.valor_quitacao_estimado_centavos) }}</dd>
            </div>
            <div v-if="d.valor_contratado_centavos"><dt>Juros no contrato todo</dt><dd>{{ dinheiro(d.total_pago_no_fim_centavos - d.valor_contratado_centavos) }}</dd></div>
          </dl>
        </article>
      </div>
      <p class="miudo suave">
        "Para quitar hoje" usa a taxa mensal informada (tabela Price). Na quitação antecipada o banco desconta os juros futuros;
        peça o valor oficial antes de decidir. Parcelas pagas são contadas pelas datas, supondo pagamento em dia.
      </p>

      <section v-if="quitadas.length" class="secao">
        <header><h2>Quitadas</h2></header>
        <ul class="lista painel">
          <li v-for="d in quitadas" :key="d.id" class="clicavel" @click="formD = { aberto: true, item: d }">
            <span class="pin" />
            <div class="titulo">{{ TIPOS_DIVIDA[d.tipo] }}, {{ d.credor }}</div>
            <div class="valor entra">{{ d.quitada_em ? `quitada em ${dataBR(d.quitada_em)}` : 'concluída' }}</div>
          </li>
        </ul>
      </section>
    </template>

    <!-- ---------------------------------------------------------------- inadimplência -->
    <template v-else>
      <div v-if="!inadAbertas.length" class="painel vazio">
        <p>Registre aqui o que ficou para trás: com quem, quanto, desde quando e o que levou a isso. Quando fechar um acordo, as parcelas entram nos fixos.</p>
        <button class="btn primario" @click="formI = { aberto: true, item: null }">Registrar atraso</button>
      </div>

      <div class="cartelas">
        <article v-for="i in inadAbertas" :key="i.id" class="painel cartela clicavel" @click="formI = { aberto: true, item: i }">
          <header>
            <div>
              <h3>{{ i.credor }}</h3>
              <p class="meta">{{ ORIGENS_INAD[i.origem] }}, {{ i.pessoa_nome ?? 'do casal' }}</p>
            </div>
            <span :class="['selo', i.status === 'acordo' ? 'paga' : 'vencida']">{{ STATUS_INAD[i.status] }}</span>
          </header>
          <blockquote v-if="i.motivo">{{ i.motivo }}</blockquote>
          <dl>
            <div><dt>Em aberto</dt><dd class="sai">{{ dinheiro(i.em_aberto_centavos) }}</dd></div>
            <div><dt>Atrasado desde</dt><dd>{{ dataBR(i.desde) }} ({{ i.meses_em_atraso }} meses)</dd></div>
            <div v-if="i.valor_atual_centavos && i.valor_atual_centavos > i.valor_original_centavos">
              <dt>Cresceu com juros e multa</dt><dd>{{ dinheiro(i.valor_atual_centavos - i.valor_original_centavos) }}</dd>
            </div>
            <template v-if="i.status === 'acordo'">
              <div><dt>Acordo</dt><dd>{{ i.acordo_parcelas }}x de {{ dinheiro(i.acordo_valor_parcela_centavos!) }}</dd></div>
              <div><dt>Parcelas pagas</dt><dd>{{ i.acordo_parcelas_pagas }} de {{ i.acordo_parcelas }}, termina em {{ mesAno(i.acordo_ultima!) }}</dd></div>
              <div v-if="i.acordo_desconto_centavos && i.acordo_desconto_centavos > 0"><dt>Desconto obtido</dt><dd class="entra">{{ dinheiro(i.acordo_desconto_centavos) }}</dd></div>
            </template>
            <div v-if="i.negativado"><dt>Negativação sai do cadastro até</dt><dd>{{ dataBR(i.limite_negativacao!) }}</dd></div>
          </dl>
        </article>
      </div>
      <p class="miudo suave">
        O prazo da negativação conta 5 anos a partir do vencimento informado. Sair do cadastro não extingue a dívida:
        o credor ainda pode cobrar e ela pesa em análises do próprio credor. Confirme datas e valores no Registrato (Banco Central) e no Serasa.
      </p>

      <section v-if="inadQuitadas.length" class="secao">
        <header><h2>Resolvidas</h2></header>
        <ul class="lista painel">
          <li v-for="i in inadQuitadas" :key="i.id" class="clicavel" @click="formI = { aberto: true, item: i }">
            <span class="pin" />
            <div class="titulo">{{ i.credor }}</div>
            <div class="valor entra">quitada{{ i.quitada_em ? ` em ${dataBR(i.quitada_em)}` : '' }}</div>
          </li>
        </ul>
      </section>
    </template>

    <DividaForm v-if="formD.aberto" :divida="formD.item" @fechar="formD.aberto = false" />
    <InadimplenciaForm v-if="formI.aberto" :item="formI.item" @fechar="formI.aberto = false" />
  </div>
</template>

<style scoped>
.abas { max-width: 420px; }
.cartelas { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); align-items: start; }
.cartela { padding: 18px; display: grid; gap: 10px; cursor: pointer; }
.cartela:hover { border-color: var(--ink-3); }
.cartela header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.cartela header b { font: 700 1.25rem var(--display); white-space: nowrap; }
.cartela header small { font: 500 0.75rem var(--texto); color: var(--ink-3); }
.meta { color: var(--ink-3); font-size: 0.8125rem; }
.progresso { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--sai) 18%, var(--surface-2)); overflow: hidden; }
.progresso i { display: block; height: 100%; background: var(--entra); }
blockquote { margin: 0; padding: 8px 12px; border-left: 3px solid var(--previsto); background: var(--surface-2); font-size: 0.9rem; color: var(--ink-2); border-radius: 0 var(--raio-s) var(--raio-s) 0; }
dl { margin: 0; }
dl div { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-top: 1px solid var(--line); font-size: 0.875rem; }
dt { color: var(--ink-2); }
dd { margin: 0; font-weight: 600; text-align: right; }
</style>

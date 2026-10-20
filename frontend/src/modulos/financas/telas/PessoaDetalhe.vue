<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, type Pessoa, type Rescisao, type SalarioHist, type Trabalho } from '../../../core/api';
import { avisar, avisarMudanca, versao } from '../../../core/store';
import { dataBR, dataCurta, dinheiro, hoje, mesAno } from '../../../core/format';
import PessoaForm from '../componentes/PessoaForm.vue';
import ContratoForm from '../componentes/ContratoForm.vue';
import SalarioForm from '../componentes/SalarioForm.vue';
import FeriasForm from '../componentes/FeriasForm.vue';

const route = useRoute();
const t = ref<Trabalho | null>(null);
const erro = ref('');
const modal = ref<'perfil' | 'contrato' | 'salario' | 'ferias' | null>(null);
const salarioEdit = ref<SalarioHist | null>(null);

async function carregar() {
  try { t.value = await api.get<Trabalho>(`/pessoas/${route.params.id}/trabalho`); } catch (e) { erro.value = (e as Error).message; }
}
watch([() => route.params.id, versao], carregar, { immediate: true });

const r = computed(() => t.value?.resumo);
const p = computed(() => t.value?.pessoa);
const pronto = computed(() => !!p.value?.data_admissao && !!r.value?.temHistorico);
const tempo = computed(() => {
  const x = r.value?.tempoDeCasa;
  if (!x) return '';
  const a = x.anos ? `${x.anos} ${x.anos === 1 ? 'ano' : 'anos'}` : '';
  const m = x.meses ? `${x.meses} ${x.meses === 1 ? 'mês' : 'meses'}` : '';
  return [a, m].filter(Boolean).join(' e ') || 'menos de 1 mês';
});

function abrirSalario(s: SalarioHist | null) {
  salarioEdit.value = s;
  modal.value = 'salario';
}
async function excluirFerias(fid: string) {
  if (!confirm('Excluir este registro de férias?')) return;
  await api.del(`/pessoas/${p.value!.id}/ferias/${fid}`);
  avisar('Férias excluídas');
  avisarMudanca();
}

// ------------------------------------------------------------- rescisão (sob demanda)
type Tipo = 'sem_justa_causa' | 'pedido_demissao' | 'justa_causa';
const TIPOS: { v: Tipo; rotulo: string; data: string }[] = [
  { v: 'sem_justa_causa', rotulo: 'Empresa demite sem justa causa (aviso indenizado)', data: 'Último dia trabalhado' },
  { v: 'pedido_demissao', rotulo: 'Peço demissão (aviso trabalhado)', data: 'Dia em que aviso a empresa' },
  { v: 'justa_causa', rotulo: 'Demissão por justa causa', data: 'Data da demissão' },
];
const resc = ref({ tipo: 'sem_justa_causa' as Tipo, data: hoje() });
const resultado = ref<Rescisao | null>(null);
const erroResc = ref('');
async function simular() {
  erroResc.value = '';
  try {
    resultado.value = await api.get<Rescisao>(`/pessoas/${p.value!.id}/rescisao?tipo=${resc.value.tipo}&data=${resc.value.data}`);
  } catch (e) {
    resultado.value = null;
    erroResc.value = (e as Error).message;
  }
}
watch(resc, () => { if (resultado.value) simular(); }, { deep: true });
</script>

<template>
  <div v-if="t && p && r" class="pagina">
    <header class="cabecalho">
      <div>
        <RouterLink class="btn link" to="/financas/pessoas">Pessoas</RouterLink>
        <h1>{{ p.nome }}</h1>
        <p>{{ p.cargo || 'Cargo não informado' }}<template v-if="p.data_admissao">, desde {{ dataBR(p.data_admissao) }} ({{ tempo }} de casa)</template></p>
      </div>
      <div class="acoes">
        <button class="btn" @click="modal = 'perfil'">Editar perfil</button>
        <button class="btn" @click="modal = 'contrato'">Dados do contrato</button>
      </div>
    </header>

    <div v-if="!pronto" class="painel recheado preparo">
      <h2>Para calcular férias, 13º e rescisão</h2>
      <ol>
        <li :class="{ feito: p.data_admissao }">Informe a <b>data de admissão</b> em Dados do contrato.</li>
        <li :class="{ feito: r.temHistorico }">Cadastre o <b>salário bruto</b> (e cada aumento, com a data em que passou a valer).</li>
      </ol>
      <div class="acoes" style="justify-content: flex-start">
        <button v-if="!p.data_admissao" class="btn primario" @click="modal = 'contrato'">Informar admissão</button>
        <button v-if="!r.temHistorico" class="btn primario" @click="abrirSalario(null)">Cadastrar salário</button>
      </div>
    </div>

    <!-- ------------------------------------------------------------------ salário -->
    <section class="secao">
      <header><h2>Salário</h2><button class="btn link" @click="abrirSalario(null)">Registrar aumento</button></header>
      <div v-if="r.liquidoAtual" class="painel holerite">
        <div class="bruto">
          <span>Bruto</span><b>{{ dinheiro(r.liquidoAtual.bruto) }}</b>
          <small v-if="p.paga_mes_seguinte">referente a {{ mesAno(r.liquidoAtual.referencia) }}</small>
        </div>
        <dl>
          <template v-if="!r.liquidoAtual.informado">
            <div><dt>INSS</dt><dd>− {{ dinheiro(r.liquidoAtual.inss) }}</dd></div>
            <div><dt>Imposto de renda</dt><dd>− {{ dinheiro(r.liquidoAtual.irrf) }}</dd></div>
            <div v-if="r.liquidoAtual.outros"><dt>Outros descontos</dt><dd>− {{ dinheiro(r.liquidoAtual.outros) }}</dd></div>
            <div v-if="r.liquidoAtual.consignado"><dt>Consignado em folha</dt><dd>− {{ dinheiro(r.liquidoAtual.consignado) }}</dd></div>
          </template>
          <div class="total">
            <dt>Cai na conta{{ p.dia_salario ? ` todo dia ${p.dia_salario}` : '' }}</dt>
            <dd class="entra">{{ dinheiro(r.liquidoAtual.liquido) }}</dd>
          </div>
          <p v-if="r.liquidoAtual.informado" class="miudo suave">Líquido informado manualmente no histórico.</p>
          <p v-if="r.liquidoProximoMes && r.liquidoProximoMes.liquido !== r.liquidoAtual.liquido" class="miudo previsto">
            No mês que vem: {{ dinheiro(r.liquidoProximoMes.liquido) }}.
          </p>
        </dl>
      </div>
      <ul v-if="t.salarios.length" class="lista painel">
        <li v-for="s in t.salarios" :key="s.id" class="clicavel" @click="abrirSalario(s)">
          <span :class="['pin', { atual: r.salarioVigente?.id === s.id }]" />
          <div>
            <div class="titulo">Desde {{ dataBR(s.vigencia) }}<template v-if="s.cargo">, {{ s.cargo }}</template></div>
            <div class="meta">{{ [
              s.vigencia > hoje() ? `começa em ${dataCurta(s.vigencia)}` : '',
              `líquido ${s.liquido_centavos ? 'informado' : 'estimado'} ${dinheiro(s.liquido_centavos ?? s.liquido_estimado)}`,
              s.observacao ?? '',
            ].filter(Boolean).join(', ') }}</div>
          </div>
          <div class="valor">{{ dinheiro(s.bruto_centavos) }}</div>
        </li>
      </ul>
      <p v-else class="painel vazio">Sem histórico ainda. O salário líquido do perfil continua valendo para os fixos.</p>
    </section>

    <div v-if="pronto" class="grade-2">
      <!-- -------------------------------------------------------------------- 13º -->
      <section v-if="r.decimo" class="secao">
        <header><h2>13º de {{ r.decimo.ano }}</h2><span>{{ r.decimo.avos }}/12 avos</span></header>
        <div class="painel">
          <dl class="tabela">
            <div><dt>Total bruto</dt><dd>{{ dinheiro(r.decimo.total) }}</dd></div>
            <div><dt>1ª parcela, até {{ dataCurta(r.decimo.datas.primeira) }}</dt><dd class="entra">{{ dinheiro(r.decimo.primeira) }}</dd></div>
            <div><dt>INSS</dt><dd>− {{ dinheiro(r.decimo.inss) }}</dd></div>
            <div><dt>Imposto de renda</dt><dd>− {{ dinheiro(r.decimo.irrf) }}</dd></div>
            <div><dt>2ª parcela, até {{ dataCurta(r.decimo.datas.segunda) }}</dt><dd class="entra">{{ dinheiro(r.decimo.segunda) }}</dd></div>
          </dl>
          <p class="miudo suave nota">
            {{ p.gerar_decimo ? 'As duas parcelas já aparecem como previstas no mês.' : 'Previsão desativada nos dados do contrato.' }}
            Os descontos ficam todos na 2ª parcela.
          </p>
        </div>
      </section>

      <!-- ----------------------------------------------------------------- férias -->
      <section v-if="r.ferias" class="secao">
        <header><h2>Férias</h2><button class="btn link" @click="modal = 'ferias'">Registrar férias</button></header>
        <div class="painel">
          <div class="saldo-ferias">
            <b :class="{ sai: r.ferias.algumEmDobro }">{{ r.ferias.diasDisponiveis }} dias</b>
            <span v-if="r.ferias.diasDisponiveis && r.ferias.prazoMaisProximo">
              disponíveis. Tire até {{ dataBR(r.ferias.prazoMaisProximo) }}<template v-if="r.ferias.algumEmDobro">: prazo vencido, a empresa deve em dobro</template>.
            </span>
            <span v-else>disponíveis agora.</span>
          </div>
          <dl class="tabela">
            <div><dt>30 dias de férias</dt><dd class="entra">{{ dinheiro(r.ferias.simulacao30.liquido) }}</dd></div>
            <div><dt>20 dias + vender 10</dt><dd class="entra">{{ dinheiro(r.ferias.simulacaoVendendo10.liquido) }}</dd></div>
          </dl>
          <p class="miudo suave nota">Valores líquidos com o salário de hoje, já com 1/3, INSS e IR.</p>
        </div>
        <ul class="lista painel periodos">
          <li v-for="per in r.ferias.periodos" :key="per.inicio">
            <span :class="['selo', per.emDobro ? 'vencida' : per.diasSaldo === 0 ? 'paga' : per.completo ? 'previsto' : '']">
              {{ per.quitado ? 'Resolvido' : per.emDobro ? 'Vencido' : per.diasSaldo === 0 ? 'Gozado' : per.completo ? 'Disponível' : 'Em formação' }}
            </span>
            <div>
              <div class="titulo">{{ dataBR(per.inicio) }} a {{ dataBR(per.fim) }}</div>
              <div class="meta">
                <template v-if="per.quitado">antes do Caixa</template>
                <template v-else-if="per.completo">tirar até {{ dataBR(per.limiteGozo) }}, {{ per.diasUsados }} de 30 usados</template>
                <template v-else>{{ per.diasDireito }} dias acumulados até hoje</template>
              </div>
            </div>
            <div class="valor">{{ per.quitado ? '' : `${per.diasSaldo} dias` }}</div>
          </li>
        </ul>
        <ul v-if="t.ferias.length" class="lista painel">
          <li v-for="f in t.ferias" :key="f.id">
            <span class="pin" />
            <div class="titulo">{{ dataBR(f.inicio) }}, {{ f.dias }} dias<template v-if="f.abono_dias"> + {{ f.abono_dias }} vendidos</template></div>
            <button class="btn link perigo miudo" @click="excluirFerias(f.id)">Excluir</button>
          </li>
        </ul>
      </section>
    </div>

    <!-- ------------------------------------------------- rescisão: fechado por padrão -->
    <details v-if="pronto" class="painel rescisao" @toggle="($event.target as HTMLDetailsElement).open && !resultado && simular()">
      <summary>
        <span>Simulações de rescisão</span>
        <small>Usa o histórico de salários, as férias e o FGTS estimado</small>
      </summary>
      <div class="corpo">
        <div class="form">
          <div class="campo">
            <span>Cenário</span>
            <div class="opcoes">
              <label v-for="o in TIPOS" :key="o.v" :class="{ ativo: resc.tipo === o.v }">
                <input v-model="resc.tipo" type="radio" name="tipo" :value="o.v" />{{ o.rotulo }}
              </label>
            </div>
          </div>
          <label class="campo" style="max-width: 260px">
            <span>{{ TIPOS.find((o) => o.v === resc.tipo)!.data }}</span>
            <input v-model="resc.data" type="date" />
          </label>
        </div>

        <p v-if="erroResc" class="erro-form">{{ erroResc }}</p>

        <template v-if="resultado">
          <p class="suave">{{
            `Saída em ${dataBR(resultado.dataSaida)}`
            + (resultado.tipo === 'sem_justa_causa' ? `, aviso de ${resultado.diasAviso} dias indenizado (contrato projetado até ${dataBR(resultado.dataProjetada)})` : '')
            + (resultado.avisoTrabalhado ? ', depois de 30 dias de aviso trabalhado' : '')
            + `. Salário base ${dinheiro(resultado.salarioBase)}.`
          }}</p>
          <table class="verbas">
            <tbody>
              <tr v-for="(v, i) in resultado.verbas" :key="i" :class="v.tipo">
                <td>{{ v.descricao }}<small v-if="v.obs">{{ v.obs }}</small></td>
                <td>{{ v.tipo === 'desconto' ? '− ' : '' }}{{ dinheiro(v.valor) }}</td>
              </tr>
              <tr class="soma"><td>Líquido da rescisão</td><td>{{ dinheiro(resultado.liquidoRescisao) }}</td></tr>
              <tr><td>FGTS estimado antes da saída<small>Sem a remuneração da conta; confira no app FGTS</small></td><td>{{ dinheiro(resultado.fgts.saldoAntes) }}</td></tr>
              <tr><td>Depósito de FGTS sobre a rescisão</td><td>{{ dinheiro(resultado.fgts.depositoRescisorio) }}</td></tr>
              <tr v-if="resultado.fgts.multa40"><td>Multa de 40% do FGTS</td><td>{{ dinheiro(resultado.fgts.multa40) }}</td></tr>
              <tr><td>FGTS que pode sacar</td><td>{{ dinheiro(resultado.fgts.sacavel) }}</td></tr>
              <tr class="soma total"><td>Total que fica disponível</td><td>{{ dinheiro(resultado.totalDisponivel) }}</td></tr>
            </tbody>
          </table>
          <ul class="obs">
            <li v-for="(o, i) in resultado.observacoes" :key="i">{{ o }}</li>
          </ul>
        </template>
        <p class="miudo suave">
          Estimativa para planejamento com tabelas de INSS e IR de {{ r.tabelaAno }}. Considera salário fixo, sem horas extras,
          adicionais, médias ou faltas. O valor oficial é o do termo de rescisão; em caso de dúvida, confira com o sindicato ou um advogado trabalhista.
        </p>
      </div>
    </details>

    <PessoaForm v-if="modal === 'perfil'" :pessoa="p as unknown as Pessoa" @fechar="modal = null" />
    <ContratoForm v-if="modal === 'contrato'" :t="t" @fechar="modal = null" />
    <SalarioForm v-if="modal === 'salario'" :pessoa-id="p.id" :salario="salarioEdit" :cargo-atual="p.cargo" @fechar="modal = null" />
    <FeriasForm v-if="modal === 'ferias'" :pessoa-id="p.id" @fechar="modal = null" />
  </div>
  <p v-else-if="erro" class="pagina erro-form">{{ erro }}</p>
</template>

<style scoped>
.preparo { display: grid; gap: 10px; border-left: 4px solid var(--previsto); }
.preparo ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
.preparo .feito { color: var(--ink-3); text-decoration: line-through; }

.holerite { display: grid; grid-template-columns: minmax(180px, 1fr) 2fr; }
.holerite .bruto { display: grid; align-content: center; gap: 2px; padding: 18px; border-right: 1px solid var(--line); }
.holerite .bruto span { font-size: 0.8125rem; color: var(--ink-2); }
.holerite .bruto b { font: 700 1.9rem var(--display); letter-spacing: -0.02em; }
.holerite .bruto small { color: var(--ink-3); font-size: 0.75rem; }
.holerite dl { margin: 0; padding: 8px 18px; }
@media (max-width: 760px) {
  .holerite { grid-template-columns: 1fr; }
  .holerite .bruto { border-right: 0; border-bottom: 1px solid var(--line); }
}
dl div { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 0.9rem; }
dl div:last-of-type { border-bottom: 0; }
dt { color: var(--ink-2); }
dd { margin: 0; font-weight: 600; text-align: right; white-space: nowrap; }
dl .total dd { font: 700 1.2rem var(--display); }
.tabela { margin: 0; padding: 6px 18px; }
.nota { padding: 0 18px 14px; }
.pin.atual { background: var(--entra); }

.saldo-ferias { padding: 16px 18px 6px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.saldo-ferias b { font: 700 1.6rem var(--display); }
.periodos .selo { min-width: 86px; text-align: center; }

.rescisao > summary { list-style: none; cursor: pointer; padding: 16px 18px; display: grid; gap: 2px; }
.rescisao > summary::-webkit-details-marker { display: none; }
.rescisao > summary span { font: 700 1.1rem var(--display); }
.rescisao > summary span::before { content: '+ '; color: var(--ink-3); }
.rescisao[open] > summary span::before { content: '− '; }
.rescisao > summary small { color: var(--ink-3); }
.rescisao .corpo { padding: 0 18px 18px; display: grid; gap: 16px; border-top: 1px solid var(--line); padding-top: 16px; }
.opcoes { display: grid; gap: 6px; }
.opcoes label { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--raio-s); cursor: pointer; font-weight: 500; }
.opcoes label.ativo { border-color: var(--ink); background: var(--surface-2); }
.opcoes input { width: auto; min-height: 0; accent-color: var(--ink); }
.verbas { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.verbas td { padding: 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
.verbas td:last-child { text-align: right; font-weight: 600; white-space: nowrap; padding-left: 12px; }
.verbas td small { display: block; color: var(--ink-3); font-size: 0.75rem; }
.verbas tr.desconto td:last-child { color: var(--sai); }
.verbas tr.soma td { font-weight: 700; border-bottom: 2px solid var(--ink); }
.verbas tr.total td { font: 700 1.15rem var(--display); color: var(--entra); border-bottom: 0; padding-top: 12px; }
.obs { margin: 0; padding-left: 18px; color: var(--ink-2); font-size: 0.875rem; display: grid; gap: 4px; }
</style>

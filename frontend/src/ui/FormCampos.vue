<script setup lang="ts">
import { computed } from 'vue';
import type { Campo } from './campos';
import MoneyInput from './MoneyInput.vue';

const props = defineProps<{ campos: Campo[]; modelo: Record<string, any> }>();

// agrupa campos "meia" consecutivos em linhas de dois
const linhas = computed(() => {
  const visiveis = props.campos.filter((c) => !c.se || c.se(props.modelo));
  const out: Campo[][] = [];
  for (const c of visiveis) {
    const ult = out[out.length - 1];
    if (c.meia && ult && ult.length === 1 && ult[0].meia) ult.push(c);
    else out.push([c]);
  }
  return out;
});
const ops = (c: Campo) => (typeof c.op === 'function' ? c.op() : c.op ?? []);
function tagsTexto(v: unknown) { return Array.isArray(v) ? v.join(', ') : String(v ?? ''); }
</script>

<template>
  <div v-for="(linha, i) in linhas" :key="i" :class="linha.length > 1 ? 'linha' : ''">
    <label v-for="c in linha" :key="c.k" class="campo">
      <span>{{ c.r }}</span>
      <textarea v-if="c.t === 'area'" v-model="modelo[c.k]" :rows="c.linhas ?? 4" :placeholder="c.ph" :required="c.obrig" />
      <select v-else-if="c.t === 'sel'" v-model="modelo[c.k]" :required="c.obrig">
        <option v-if="c.vazio" :value="null">{{ c.vazio }}</option>
        <option v-for="o in ops(c)" :key="String(o.v)" :value="o.v">{{ o.r }}</option>
      </select>
      <select v-else-if="c.t === 'bool'" v-model="modelo[c.k]">
        <option :value="true">Sim</option><option :value="false">Não</option>
      </select>
      <MoneyInput v-else-if="c.t === 'dinheiro'" :model-value="modelo[c.k] ?? 0" @update:model-value="(v: number) => (modelo[c.k] = v)" />
      <input v-else-if="c.t === 'tags'" :value="tagsTexto(modelo[c.k])" :placeholder="c.ph ?? 'separe por vírgula'"
        @change="(e) => (modelo[c.k] = (e.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean))" />
      <input v-else-if="c.t === 'cor'" v-model="modelo[c.k]" type="color" />
      <input v-else-if="c.t === 'num'" v-model="modelo[c.k]" type="number" inputmode="decimal" :min="c.min" :max="c.max" :step="c.passo ?? 'any'" :placeholder="c.ph" :required="c.obrig" />
      <input v-else :value="modelo[c.k] ?? ''" :type="c.t === 'data' ? 'date' : c.t === 'hora' ? 'time' : c.t === 'url' ? 'url' : 'text'"
        :placeholder="c.ph" :required="c.obrig" @input="(e) => (modelo[c.k] = (e.target as HTMLInputElement).value)" />
      <small v-if="c.dica">{{ c.dica }}</small>
    </label>
  </div>
</template>

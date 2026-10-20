<script setup lang="ts">
// Abas sincronizadas com ?aba= na URL: F5 e voltar do navegador mantêm a aba.
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
const props = defineProps<{ abas: { id: string; r: string; n?: number }[] }>();
const route = useRoute();
const router = useRouter();
const atual = computed(() => (route.query.aba as string) || props.abas[0].id);
defineExpose({ atual });
</script>

<template>
  <div class="abas-rolagem">
    <div class="segmentado abas" role="tablist">
      <button v-for="a in abas" :key="a.id" role="tab" :aria-pressed="atual === a.id"
        @click="router.replace({ query: { ...route.query, aba: a.id === abas[0].id ? undefined : a.id } })">
        {{ a.r }}<span v-if="a.n" class="n">{{ a.n }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.abas-rolagem { overflow-x: auto; margin: 0 -2px; padding: 2px; scrollbar-width: none; }
.abas { display: inline-flex; min-width: max-content; }
.abas button { flex: none; padding: 9px 14px; white-space: nowrap; }
.n { margin-left: 6px; font-size: 0.75rem; color: var(--ink-3); }
</style>

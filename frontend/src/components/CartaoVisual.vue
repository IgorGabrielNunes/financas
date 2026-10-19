<script setup lang="ts">
import type { Cartao } from '../api';
import { dinheiro } from '../format';
defineProps<{ cartao: Cartao }>();
</script>

<template>
  <div class="plastico" :style="{ '--c': cartao.cor }">
    <div class="topo">
      <strong>{{ cartao.nome }}</strong>
      <span>{{ cartao.bandeira }}</span>
    </div>
    <div class="livre">
      <small>Limite livre</small>
      <b>{{ dinheiro(cartao.livre_centavos) }}</b>
    </div>
    <div class="base">
      <span>{{ cartao.pessoa_nome ?? '' }}{{ cartao.final ? `  •••• ${cartao.final}` : '' }}</span>
      <span>Fecha dia {{ cartao.dia_fechamento }}, vence dia {{ cartao.dia_vencimento }}</span>
    </div>
    <div class="uso" :aria-label="`Usado ${dinheiro(cartao.usado_centavos)} de ${dinheiro(cartao.limite_centavos)}`">
      <i :style="{ width: Math.min(100, (cartao.usado_centavos / Math.max(cartao.limite_centavos, 1)) * 100) + '%' }" />
    </div>
  </div>
</template>

<style scoped>
/* proporção ISO/IEC 7810 ID-1 (85,6 × 53,98 mm) — o cartão tem o tamanho de um cartão */
.plastico {
  aspect-ratio: 1.586; border-radius: 14px; padding: 16px 18px; color: #fff; position: relative; overflow: hidden;
  background: linear-gradient(135deg, var(--c), color-mix(in srgb, var(--c) 70%, #000));
  display: grid; grid-template-rows: auto 1fr auto; container-type: inline-size;
}
.topo { display: flex; justify-content: space-between; font-size: 0.9rem; }
.topo span { opacity: 0.8; text-transform: capitalize; }
.livre { align-self: center; display: grid; }
.livre small { opacity: 0.75; font-size: 0.75rem; }
.livre b { font: 700 clamp(1.3rem, 9cqi, 2rem) var(--display); letter-spacing: -0.02em; }
.base { display: flex; justify-content: space-between; font-size: 0.75rem; opacity: 0.85; padding-bottom: 8px; }
.uso { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: rgba(255, 255, 255, 0.2); }
.uso i { display: block; height: 100%; background: rgba(255, 255, 255, 0.85); }
</style>

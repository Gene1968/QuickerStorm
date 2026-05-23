<script setup>
import { computed } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
const world  = useWorldStore()
const SIZE   = 128
const REGION = 256  // SL region = 256×256 m

const dots = computed(() =>
  world.avatars.map(av => ({
    id: av.localId,
    x:  av.pos ? (av.pos[0] / REGION) * SIZE : SIZE / 2,
    y:  av.pos ? SIZE - (av.pos[1] / REGION) * SIZE : SIZE / 2,
  }))
)
</script>

<template>
  <div class="absolute bottom-16 left-2 bg-black/60 rounded">
    <svg :width="SIZE" :height="SIZE">
      <rect width="100%" height="100%" fill="transparent" />
      <!-- Cross-hairs -->
      <line x1="64" y1="0" x2="64" y2="128" stroke="#ffffff18" stroke-width="1"/>
      <line x1="0"  y1="64" x2="128" y2="64" stroke="#ffffff18" stroke-width="1"/>
      <!-- Avatar dots -->
      <circle v-for="d in dots" :key="d.id" :cx="d.x" :cy="d.y" r="3" fill="#00b4d8" />
    </svg>
  </div>
</template>

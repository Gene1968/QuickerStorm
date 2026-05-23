<script setup>
import { ref } from 'vue'
import { useWorldEngine } from '@/composables/useWorldEngine'
const canvasRef = ref(null)
useWorldEngine(canvasRef)
</script>

<template>
  <div class="relative w-full h-full">
    <canvas ref="canvasRef" class="w-full h-full block" />
  </div>
</template>

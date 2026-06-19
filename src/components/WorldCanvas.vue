<script setup>
import { ref } from 'vue'
import { useWorldEngine } from '@/composables/useWorldEngine'
import HoverCursorBadge from '@/components/HoverCursorBadge.vue'
const canvasRef = ref(null)
const { hoverAction, hoverPos } = useWorldEngine(canvasRef)
</script>

<template>
  <div class="relative w-full h-full">
    <canvas ref="canvasRef" class="w-full h-full block" />
    <HoverCursorBadge :action="hoverAction" :x="hoverPos.x" :y="hoverPos.y" />
  </div>
</template>

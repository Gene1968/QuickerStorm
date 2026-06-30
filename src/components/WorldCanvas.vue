<script setup>
import { ref } from 'vue'
import { useWorldEngine } from '@/composables/useWorldEngine'
import HoverCursorBadge from '@/components/HoverCursorBadge.vue'
const canvasRef = ref(null)
import { computed } from 'vue'
const { hoverAction, hoverPos, altFocus } = useWorldEngine(canvasRef)
// Alt held → force the Zoom (7) magnifier badge: Alt+click sets the camera focal point. Overrides
// any object-hover action so the focus affordance is unambiguous.
const cursorAction = computed(() => (altFocus.value ? 7 : hoverAction.value))
</script>

<template>
  <div class="relative w-full h-full">
    <canvas ref="canvasRef" class="w-full h-full block" />
    <HoverCursorBadge :action="cursorAction" :x="hoverPos.x" :y="hoverPos.y" />
  </div>
</template>

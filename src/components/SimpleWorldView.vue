<script setup>
// 2D top-down fallback view — HTML canvas, no Three.js
import { ref, onMounted, onUnmounted } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
import { useLocalChat } from '@/composables/useLocalChat'
const world = useWorldStore()
const { messages, send } = useLocalChat()

const canvasRef = ref(null)
const input     = ref('')
const SIZE      = 256  // canvas px

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1a2a1a'
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.strokeStyle = '#ffffff18'
  ctx.beginPath()
  ctx.moveTo(SIZE / 2, 0);    ctx.lineTo(SIZE / 2, SIZE)
  ctx.moveTo(0, SIZE / 2);    ctx.lineTo(SIZE, SIZE / 2)
  ctx.stroke()
  for (const av of world.avatars) {
    const x = av.pos ? (av.pos[0] / 256) * SIZE : SIZE / 2
    const y = av.pos ? SIZE - (av.pos[1] / 256) * SIZE : SIZE / 2
    ctx.fillStyle = '#00b4d8'
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '10px sans-serif'
    ctx.fillText(av.name ?? 'Avatar', x + 6, y + 4)
  }
}

let rafId
function loop() { draw(); rafId = requestAnimationFrame(loop) }
onMounted(loop)
onUnmounted(() => cancelAnimationFrame(rafId))

function submit() {
  const msg = input.value.trim()
  if (!msg) return
  send(msg)
  input.value = ''
}
</script>

<template>
  <div class="flex flex-col h-full bg-bg text-t1">
    <div class="flex-1 flex items-center justify-center">
      <canvas ref="canvasRef" :width="SIZE" :height="SIZE" class="rounded border border-brd" />
    </div>
    <div class="max-h-32 overflow-y-auto px-3 py-1 bg-black/40 border-t border-brd">
      <div v-for="m in [...messages].reverse().slice(0, 20)" :key="m.id" class="text-sm py-0.5">
        <span class="text-accent">{{ m.fromName }}:</span> {{ m.message }}
      </div>
    </div>
    <form class="flex gap-2 p-2 bg-black/60 border-t border-brd" @submit.prevent="submit">
      <input
        v-model="input"
        class="flex-1 bg-card border border-brd rounded-sm px-2 py-1 text-sm text-t1"
        placeholder="Say something…"
        maxlength="1023"
      />
      <button class="px-3 py-1 bg-accent text-white rounded-sm text-sm hover:opacity-80">Send</button>
    </form>
  </div>
</template>

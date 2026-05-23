<script setup>
import { computed } from 'vue'
import { useSessionStore } from '@/stores/sessionStore'
import { useUiStore } from '@/stores/uiStore'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'

const session = useSessionStore()
const ui      = useUiStore()
const { connected } = useRealtimeSocket()

const region  = computed(() => session.regionName || 'Unknown Region')
const pos     = computed(() => {
  const p = ui.cameraPos
  return `${p.x}, ${p.z}, ${p.y}`  // display as SL X,Y,Z (height=Y in SL)
})
</script>

<template>
  <div class="flex items-center gap-3 px-3 h-8 bg-black/70 border-b border-brd text-xs text-white shrink-0 select-none">
    <!-- Connection status dot -->
    <span :class="connected ? 'text-green-400' : 'text-red-400'" class="text-[10px]">
      {{ connected ? '●' : '○' }}
    </span>

    <!-- Region name -->
    <span class="font-medium truncate max-w-[180px]" :title="region">{{ region }}</span>

    <!-- Coordinates -->
    <span class="text-white/60 font-mono">{{ pos }}</span>

    <!-- Sim info -->
    <span v-if="session.simIp" class="text-white/40 hidden sm:block">
      {{ session.simIp }}:{{ session.simPort }}
    </span>

    <span class="ml-auto text-white/40 text-[10px] hidden md:block">
      WASD/↑↓←→ move · Q/E turn · PgUp/Dn fly
    </span>
  </div>
</template>

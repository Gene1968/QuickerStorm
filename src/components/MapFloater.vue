<script setup>
import { ref } from 'vue'
import { useUiStore } from '@/stores/uiStore'

const ui = useUiStore()

const regionInput = ref('')
const status      = ref('')  // feedback message

function close() { ui.toggleMap() }

function teleport() {
  const name = regionInput.value.trim()
  if (!name) { status.value = 'Enter a region name.'; return }
  // TODO Phase 2: send TELEPORT_REQUEST via WS → server parses + sends TP packet
  status.value = `Teleport to "${name}" — coming in Phase 2.`
}

function onKeydown(e) {
  if (e.key === 'Enter') teleport()
  if (e.key === 'Escape') close()
}
</script>

<template>
  <!-- Draggable-feel floater panel — centered, fixed width -->
  <div
    class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-72
           bg-black/90 border border-white/20 rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
  >
    <!-- Header -->
    <div class="flex items-center px-3 py-2 bg-white/5 border-b border-white/10">
      <span class="text-white text-sm font-medium flex-1">🗺 Map / Teleport</span>
      <button class="text-white/50 hover:text-white text-lg leading-none" title="Close" @click="close">×</button>
    </div>

    <!-- Body -->
    <div class="p-3 flex flex-col gap-2">
      <p class="text-white/60 text-xs">Teleport to a region by name:</p>
      <div class="flex gap-2">
        <input
          v-model="regionInput"
          type="text"
          placeholder="Region name…"
          class="flex-1 bg-white/10 border border-white/20 rounded px-2 py-1.5 text-sm text-white
                 placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-accent"
          @keydown="onKeydown"
        />
        <button
          class="px-3 py-1.5 bg-accent text-white rounded text-sm hover:opacity-80 shrink-0"
          @click="teleport"
        >
          Go
        </button>
      </div>

      <!-- Status / feedback -->
      <p v-if="status" class="text-yellow-400 text-xs">{{ status }}</p>

      <div class="border-t border-white/10 mt-1 pt-2">
        <p class="text-white/30 text-xs italic">
          Full world map coming in Phase 2. For now, type any region name to teleport.
        </p>
      </div>
    </div>
  </div>
</template>

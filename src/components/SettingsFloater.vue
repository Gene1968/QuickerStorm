<script setup>
import { computed } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'

const ui      = useUiStore()
const session = useSessionStore()

const viewLabel = computed(() => ui.mode === '3d' ? '3D (Three.js)' : '2D (Simple)')
</script>

<template>
  <div
    class="absolute right-2 bottom-12 w-72
           bg-black/90 border border-white/20 rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
  >
    <!-- Header -->
    <div class="flex items-center px-3 py-2 bg-white/5 border-b border-white/10">
      <span class="text-white text-sm font-medium flex-1">⚙ Settings</span>
      <button class="text-white/50 hover:text-white text-lg leading-none" title="Close" @click="ui.toggleSettings()">×</button>
    </div>

    <!-- Body -->
    <div class="p-3 flex flex-col gap-3 text-sm">

      <!-- Session info -->
      <div v-if="session.agentId" class="text-white/50 text-xs font-mono break-all bg-white/5 rounded px-2 py-1">
        {{ session.agentId }}
      </div>

      <!-- View mode toggle -->
      <div class="flex items-center justify-between">
        <span class="text-white/80">Render mode</span>
        <button
          class="px-2 py-1 bg-accent/20 border border-accent/40 text-accent rounded text-xs hover:bg-accent/30 transition-colors"
          @click="ui.toggleMode()"
        >
          {{ viewLabel }} — switch
        </button>
      </div>

      <!-- Panel toggles -->
      <div class="flex flex-col gap-1.5 border-t border-white/10 pt-2">
        <p class="text-white/40 text-xs uppercase tracking-wide">Panels</p>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" :checked="ui.showChat"       @change="ui.toggleChat()"       class="accent-accent" />
          <span class="text-white/80">Nearby Chat</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" :checked="ui.showAvatarList" @change="ui.toggleAvatarList()" class="accent-accent" />
          <span class="text-white/80">Nearby Avatars</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" :checked="ui.showMinimap"    @change="ui.toggleMinimap()"    class="accent-accent" />
          <span class="text-white/80">Mini-Map</span>
        </label>
      </div>

      <!-- About -->
      <div class="border-t border-white/10 pt-2 text-white/30 text-xs">
        quickerSTORM · Phase 1 · Open Beta
      </div>
    </div>
  </div>
</template>

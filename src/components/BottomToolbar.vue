<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useGridStore } from '@/stores/gridStore'
import { useRouter } from 'vue-router'

const ui      = useUiStore()
const session = useSessionStore()
const grid    = useGridStore()
const router  = useRouter()

function logout() {
  session.clearSession()
  grid.setLoginState('idle')
  router.push('/landing')
}

// Toolbar button definition — label, icon, action, active flag, tooltip
const tools = [
  { id: 'chat',    icon: '💬', label: 'Chat',      title: 'Nearby Chat',    action: () => ui.toggleChat(),       active: () => ui.showChat },
  { id: 'people',  icon: '👥', label: 'Nearby',    title: 'Nearby Avatars', action: () => ui.toggleAvatarList(), active: () => ui.showAvatarList },
  { id: 'minimap', icon: '◈',  label: 'Mini-Map',  title: 'Mini-Map',       action: () => ui.toggleMinimap(),    active: () => ui.showMinimap },
  { id: 'map',     icon: '🗺', label: 'Map',       title: 'Map (Ctrl+M)',   action: () => ui.toggleMap(),        active: () => ui.showMap },
  { id: 'inv',     icon: '📦', label: 'Inventory', title: 'Inventory',      action: () => ui.toggleInventory(),  active: () => ui.showInventory },
]

// Keyboard shortcuts
function onKeyDown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  if (e.ctrlKey && e.key === 'm') { e.preventDefault(); ui.toggleMap() }
  if (e.ctrlKey && e.shiftKey && e.code === 'Digit4') { e.preventDefault(); ui.toggleDebug() }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="flex items-center gap-1 px-2 h-10 bg-black/80 border-t border-brd shrink-0 select-none">

    <!-- Tool buttons -->
    <button
      v-for="t in tools"
      :key="t.id"
      class="flex flex-col items-center justify-center w-12 h-8 rounded text-[10px] transition-colors"
      :class="t.active() ? 'bg-accent/30 text-accent' : 'text-white/70 hover:bg-white/10 hover:text-white'"
      :title="t.title"
      @click="t.action()"
    >
      <span class="text-base leading-none">{{ t.icon }}</span>
      <span class="leading-none mt-0.5 hidden sm:block">{{ t.label }}</span>
    </button>

    <div class="w-px h-5 bg-white/20 mx-1" />

    <!-- 2D / 3D toggle -->
    <button
      class="flex flex-col items-center justify-center w-12 h-8 rounded text-[10px] text-white/70 hover:bg-white/10 hover:text-white transition-colors"
      :title="ui.mode === '3d' ? 'Switch to 2D view' : 'Switch to 3D view'"
      @click="ui.toggleMode()"
    >
      <span class="text-base leading-none">{{ ui.mode === '3d' ? '2D' : '3D' }}</span>
      <span class="leading-none mt-0.5 hidden sm:block">View</span>
    </button>

    <div class="w-px h-5 bg-white/20 mx-1" />

    <!-- Settings -->
    <button
      class="flex flex-col items-center justify-center w-12 h-8 rounded text-[10px] text-white/70 hover:bg-white/10 hover:text-white transition-colors"
      title="Settings"
      @click="ui.toggleSettings()"
    >
      <span class="text-base leading-none">⚙</span>
      <span class="leading-none mt-0.5 hidden sm:block">Settings</span>
    </button>

    <!-- Debug panel toggle (Ctrl+Shift+4) -->
    <button
      class="flex flex-col items-center justify-center w-12 h-8 rounded text-[10px] transition-colors"
      :class="ui.showDebug ? 'bg-yellow-500/20 text-yellow-400' : 'text-white/40 hover:bg-white/10 hover:text-white'"
      title="Debug Panel (Ctrl+Shift+4)"
      @click="ui.toggleDebug()"
    >
      <span class="text-base leading-none">🔌</span>
      <span class="leading-none mt-0.5 hidden sm:block">Debug</span>
    </button>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Agent ID (truncated) -->
    <span v-if="session.agentId" class="text-white/30 text-[10px] font-mono hidden lg:block mr-2" :title="session.agentId">
      {{ session.agentId.slice(0, 8) }}…
    </span>

    <!-- Logout -->
    <button
      class="px-2 h-7 rounded border border-white/20 text-white/60 text-[10px] hover:border-red-500/60 hover:text-red-400 transition-colors"
      title="Log out and return to login screen"
      @click="logout"
    >
      Logout
    </button>
  </div>
</template>

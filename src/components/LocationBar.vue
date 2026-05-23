<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { useSessionStore } from '@/stores/sessionStore'
import { useUiStore } from '@/stores/uiStore'
import { useGridStore } from '@/stores/gridStore'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'

const session = useSessionStore()
const ui      = useUiStore()
const grid    = useGridStore()
const { connected } = useRealtimeSocket()

// ── Maturity rating ───────────────────────────────────────────────────────
const MATURITY = {
  'PG': { label: 'General',  color: 'text-green-400' },
  'G':  { label: 'General',  color: 'text-green-400' },
  'M':  { label: 'Moderate', color: 'text-yellow-400' },
  'A':  { label: 'Adult',    color: 'text-red-400' },
}
const maturity = computed(() => MATURITY[session.agentAccess] ?? null)

// ── Coordinate display (SL format: X, Y, Z where Z = height) ─────────────
// WHY: OSGrid omits region_name from login XML. Real name arrives via RegionHandshake
// UDP packet decoded server-side and forwarded as S.REGION_INFO. Show interim state.
const region  = computed(() => {
  if (session.regionName) return session.regionName
  if (session.connected)  return 'Entering region…'
  return 'Unknown Region'
})
const coords  = computed(() => {
  const p = ui.cameraPos
  // cameraPos: x=SL_X, y=SL_Z(height), z=SL_Y — display as X, Y, Z
  return `${p.x}, ${p.z}, ${p.y}`
})

// ── Click-to-edit: show hop:// or secondlife:// URL ───────────────────────
const editing   = ref(false)
const editVal   = ref('')
const editInput = ref(null)

// Auto-focus the input when editing starts
watch(editing, async (val) => {
  if (val) {
    await nextTick()
    editInput.value?.focus()
    editInput.value?.select()
  }
})

const hopUrl = computed(() => {
  const r = region.value
  const p = ui.cameraPos
  const x = p.x, y = p.z, z = p.y  // SL coords
  const g = grid.selectedGrid

  if (!g) return `secondlife://${encodeURIComponent(r)}/${x}/${y}/${z}`

  if (g.platform === 'opensim' && g.gatekeeper) {
    // Strip protocol prefix and trailing slash from gatekeeper URL
    const gw = g.gatekeeper.replace(/^https?:\/\//, '').replace(/\/$/, '')
    return `hop://${gw}/${encodeURIComponent(r)}/${x}/${y}/${z}`
  }
  if (g.slurlBase) {
    const base = g.slurlBase.replace(/\/$/, '')
    return `${base}/${encodeURIComponent(r)}/${x}/${y}/${z}`
  }
  return `secondlife://${encodeURIComponent(r)}/${x}/${y}/${z}`
})

function startEdit() {
  editVal.value = hopUrl.value
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

function commitEdit() {
  // For now just close; actual teleport handled in Phase 2
  editing.value = false
  // TODO: parse hop:// or secondlife:// URL and initiate teleport
}

function onEditKeydown(e) {
  if (e.key === 'Enter')  commitEdit()
  if (e.key === 'Escape') cancelEdit()
}
</script>

<template>
  <div class="flex items-center gap-2 px-3 h-8 bg-black/70 border-b border-brd text-xs text-white shrink-0 select-none">

    <!-- Connection status dot -->
    <span :class="connected ? 'text-green-400' : 'text-red-400'" class="text-[10px] shrink-0">
      {{ connected ? '●' : '○' }}
    </span>

    <!-- Location display / edit toggle -->
    <template v-if="!editing">
      <button
        class="flex items-center gap-1 min-w-0 text-left hover:bg-white/10 rounded px-1 -mx-1 transition-colors"
        title="Click to edit / teleport"
        @click="startEdit"
      >
        <!-- Region + coords -->
        <span class="font-medium truncate max-w-[240px]">{{ region }}</span>
        <span class="text-white/60 font-mono shrink-0">({{ coords }})</span>
        <!-- Maturity badge -->
        <span v-if="maturity" :class="['shrink-0 ml-0.5', maturity.color]">
          · {{ maturity.label }}
        </span>
      </button>
    </template>

    <!-- Edit mode: show hop:// URL in an input -->
    <template v-else>
      <input
        ref="editInput"
        v-model="editVal"
        class="flex-1 bg-white/10 border border-accent/50 rounded px-2 py-0.5 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-accent"
        @keydown="onEditKeydown"
        @blur="cancelEdit"
      />
      <span class="text-white/30 text-[10px] shrink-0">Esc cancel · Enter go</span>
    </template>

    <!-- Keyboard hint — right side -->
    <span class="ml-auto text-white/40 text-[10px] hidden md:block shrink-0">
      WASD/↑↓←→ move · A/D turn · Q/E strafe · PgUp/Dn fly · drag to look
    </span>
  </div>
</template>

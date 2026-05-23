<script setup>
import { onMounted, onUnmounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
import { useDebugStore } from '@/stores/debugStore'
import { useSessionStore } from '@/stores/sessionStore'
import { S } from '@shared/protocol.js'

const { on, off } = useRealtimeSocket()
const debug   = useDebugStore()
const session = useSessionStore()
const router  = useRouter()

// WHY: Register handlers at app root so messages are captured regardless of which
// view is currently mounted.

function onDebug(d) {
  debug.push(d.level ?? 'info', d.msg ?? String(d))
}

function onRegionInfo(d) {
  // OSGrid (and many OpenSim grids) omit region_name from login response.
  // The real name arrives via RegionHandshake UDP → S.REGION_INFO from server.
  if (d.name) session.regionName = d.name
}

function onDisconnected(d) {
  // Sim terminated circuit (timeout, kick, teleport, etc.)
  const reason = d?.reason ?? 'Disconnected from simulator'
  debug.push('warn', `Disconnected: ${reason}`)
  session.clearSession()
  router.push('/landing')
}

onMounted(() => {
  on(S.DEBUG, onDebug)
  on(S.REGION_INFO, onRegionInfo)
  on(S.DISCONNECTED, onDisconnected)
})
onUnmounted(() => {
  off(S.DEBUG, onDebug)
  off(S.REGION_INFO, onRegionInfo)
  off(S.DISCONNECTED, onDisconnected)
})
</script>

<template>
  <RouterView />
</template>

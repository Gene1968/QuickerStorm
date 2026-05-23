<script setup>
import { useSessionStore } from '@/stores/sessionStore'
import { useDebugStore } from '@/stores/debugStore'

const session = useSessionStore()
const debug   = useDebugStore()

const COLOR = {
  info:  'text-green-300',
  warn:  'text-yellow-300',
  error: 'text-red-400',
}
</script>

<template>
  <div
    class="absolute left-2 top-10 w-[500px] max-h-[60vh]
           bg-black/95 border border-white/20 rounded-lg shadow-2xl z-50
           flex flex-col overflow-hidden text-xs font-mono"
  >
    <!-- Header -->
    <div class="flex items-center gap-2 px-3 py-1.5 bg-white/5 border-b border-white/10 shrink-0">
      <span class="text-white font-semibold flex-1">🔌 Debug / Connection</span>
      <span class="text-white/30">{{ debug.lines.length }} lines</span>
      <button class="text-white/40 hover:text-white ml-2" @click="debug.clear()">clear</button>
    </div>

    <!-- Session data -->
    <div class="px-3 py-1.5 border-b border-white/10 shrink-0 text-[10px] leading-relaxed">
      <div class="grid grid-cols-[80px_1fr] gap-x-2 text-white/70">
        <span class="text-white/40">AgentID</span>
        <span class="truncate text-cyan-300">{{ session.agentId || '—' }}</span>
        <span class="text-white/40">Region</span>
        <span :class="session.regionName ? 'text-white' : 'text-red-400'">{{ session.regionName || '— (not received)' }}</span>
        <span class="text-white/40">Sim</span>
        <span class="text-white/70">{{ session.simIp || '—' }}:{{ session.simPort || '—' }}</span>
        <span class="text-white/40">Access</span>
        <span class="text-white/70">{{ session.agentAccess || '—' }}</span>
        <span class="text-white/40">Start</span>
        <span class="text-white/70">{{ session.startLocation || '—' }}</span>
        <span class="text-white/40">Connected</span>
        <span :class="session.connected ? 'text-green-400' : 'text-red-400'">{{ session.connected ? 'YES' : 'NO' }}</span>
      </div>
    </div>

    <!-- Log stream -->
    <div class="flex-1 overflow-y-auto px-3 py-1 flex flex-col gap-0.5">
      <div v-if="!debug.lines.length" class="text-white/20 italic py-2">
        No server logs yet — logs captured from connection start.
      </div>
      <div
        v-for="line in debug.lines"
        :key="line.id"
        :class="['leading-snug whitespace-pre-wrap break-all', COLOR[line.level] ?? 'text-white/70']"
      >{{ line.msg }}</div>
    </div>
  </div>
</template>

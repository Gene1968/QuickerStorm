<script setup>
// WorldView — placeholder stub; full Three.js world engine added in Task 15/16
import { useSessionStore } from '@/stores/sessionStore'
const session = useSessionStore()
</script>

<template>
  <div class="min-h-screen bg-bg flex flex-col items-center justify-center text-t1">
    <p class="text-2xl font-bold mb-2">In-world</p>
    <p class="text-t2 text-sm">Agent: {{ session.agentId || 'connecting…' }}</p>
    <p class="text-t2 text-xs mt-1">{{ session.simIp }}:{{ session.simPort }}</p>
  </div>
</template>

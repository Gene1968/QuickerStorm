<script setup>
import { useSessionStore } from '@/stores/sessionStore'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
const session		 = useSessionStore()
const { connected } = useRealtimeSocket()
</script>

<template>
	<div class="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none select-none">
		<span class="text-xs bg-black/50 text-fg px-2 py-0.5 rounded-sm">
			{{ session.regionName || 'Unknown Region' }}
		</span>
		<span class="text-xs" :class="connected ? 'text-green-400' : 'text-red-400'">
			{{ connected ? '● Connected' : '○ Disconnected' }}
		</span>
	</div>
</template>

<script setup>
import { useSessionStore }	from '@/stores/sessionStore'
import { useDebugStore }	from '@/stores/debugStore'
import { useUiStore }		from '@/stores/uiStore'

const session	= useSessionStore()
const debug		= useDebugStore()
const ui		= useUiStore()

const COLOR = {
	info:	'text-green-600',
	warn:	'text-yellow-300',
	error:	'text-red-400',
}
</script>

<template>
	<div
		class="absolute right-[20vw] bottom-2 w-[30vw] max-h-[70vh] bg-card border border-brd rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden text-xs font-mono"
	>
		<!-- Header -->
		<div class="flex items-center gap-2 px-3 py-1.5 bg-card2 border-b border-brd shrink-0">
			<span class="text-t1 font-semibold flex-1">🔌 Debug / Connection</span>
			<span class="text-tm">{{ debug.lines.length }} lines</span>
			<button class="text-tm hover:text-t1 ml-2" @click="debug.clear()">clear</button>
			<button
				class="text-tm hover:text-t1 text-xs leading-none ml-2 shrink-0 transition-colors"
				title="Close (Ctrl+Shift+4)"
				@click="ui.toggleDebug()"
			>✕</button>
		</div>

		<!-- Session data -->
		<div class="px-3 py-1.5 border-b border-brd shrink-0 text-xs leading-relaxed">
			<div class="grid grid-cols-[80px_1fr] gap-x-2 text-t2">
				<span class="text-tm">AgentID</span>
				<span class="truncate text-cyan-400">{{ session.agentId || '—' }}</span>
				<span class="text-tm">Region</span>
				<span :class="session.regionName ? 'text-t1' : 'text-red-400'">{{ session.regionName || '— (not received)' }}</span>
				<span class="text-tm">Sim</span>
				<span class="text-t2">{{ session.simIp || '—' }}:{{ session.simPort || '—' }}</span>
				<span class="text-tm">Access</span>
				<span class="text-t2">{{ session.agentAccess || '—' }}</span>
				<span class="text-tm">Start</span>
				<span class="text-t2">{{ session.startLocation || '—' }}</span>
				<span class="text-tm">Connected</span>
				<span :class="session.connected ? 'text-green-400' : 'text-red-400'">{{ session.connected ? 'YES' : 'NO' }}</span>
			</div>
		</div>

		<!-- Log stream -->
		<div class="flex-1 overflow-y-auto px-3 py-1 flex flex-col gap-0.5">
			<div v-if="!debug.lines.length" class="text-tm italic py-2">
				No server logs yet — logs captured from connection start.
			</div>
			<div
				v-for="line in debug.lines"
				:key="line.id"
				:class="['leading-snug whitespace-pre-wrap break-all', COLOR[line.level] ?? 'text-t2']"
			>{{ line.msg }}</div>
		</div>
	</div>
</template>

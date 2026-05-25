<script setup>
import { useUiStore } from '@/stores/uiStore.js'
import FloaterWindow from '@/components/FloaterWindow.vue'

const ui = useUiStore()

const movementRows = [
	{ keys: 'W / ↑',       desc: 'Move forward' },
	{ keys: 'S / ↓',       desc: 'Move back' },
	{ keys: 'A / ←',       desc: 'Turn left' },
	{ keys: 'D / →',       desc: 'Turn right' },
	{ keys: 'Q',           desc: 'Strafe left' },
	{ keys: 'E',           desc: 'Strafe right' },
	{ keys: 'PgUp',        desc: 'Fly up' },
	{ keys: 'PgDn',        desc: 'Fly down' },
	{ keys: 'Drag',        desc: 'Look around' },
]

const shortcutRows = [
	{ keys: 'Ctrl+M',      desc: 'Toggle map' },
	{ keys: 'Ctrl+P',      desc: 'Preferences' },
	{ keys: 'Shift+Alt+A', desc: 'Toggle mic mute' },
]
</script>

<template>
	<FloaterWindow
		id="movement-help"
		title="Movement &amp; Shortcuts"
		:wrap-style="{ width: '22rem' }"
		:default-pos="{ right: '1rem', top: '3rem' }"
		@close="ui.showMovementHelp = false"
	>
		<div class="p-4 text-xs text-t2 space-y-3">
			<section>
				<h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-tm mb-2">Movement</h3>
				<table class="w-full border-collapse">
					<tbody>
						<tr
							v-for="row in movementRows"
							:key="row.keys"
							class="border-b border-brd last:border-0"
						>
							<td class="py-1 pr-3 font-mono text-accent whitespace-nowrap">{{ row.keys }}</td>
							<td class="py-1 text-t2">{{ row.desc }}</td>
						</tr>
					</tbody>
				</table>
			</section>

			<section>
				<h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-tm mb-2">Shortcuts</h3>
				<table class="w-full border-collapse">
					<tbody>
						<tr
							v-for="row in shortcutRows"
							:key="row.keys"
							class="border-b border-brd last:border-0"
						>
							<td class="py-1 pr-3 font-mono text-accent whitespace-nowrap">{{ row.keys }}</td>
							<td class="py-1 text-t2">{{ row.desc }}</td>
						</tr>
					</tbody>
				</table>
			</section>
		</div>
	</FloaterWindow>
</template>

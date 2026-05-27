<script setup>
import { useUiStore } from '@/stores/uiStore.js'
import FloaterWindow from '@/components/FloaterWindow.vue'

const ui = useUiStore()

const movementRows = [
	{ keys: 'W / ↑',         desc: 'Move forward' },
	{ keys: 'S / ↓',         desc: 'Move back' },
	{ keys: 'A / ←',         desc: 'Turn left' },
	{ keys: 'D / →',         desc: 'Turn right' },
	{ keys: 'E',             desc: 'Jump' },
	{ keys: 'C',             desc: 'Crouch' },
	{ keys: 'F / Home',      desc: 'Fly/fall (toggle)' },
	{ keys: 'Shift+A',       desc: 'Sidestep left' },
	{ keys: 'Shift+D',       desc: 'Sidestep right' },
	{ keys: 'Hold E / PgUp', desc: 'Fly up' },
	{ keys: 'Hold C / PgDn', desc: 'Fly down' },
]

const shortcutRows = [
	{ keys: 'Ctrl+M',       desc: 'Map display (toggle)' },
	{ keys: 'Ctrl+P',       desc: 'Preferences' },
	{ keys: 'Ctrl+R',       desc: 'Always Run (toggle)' },
	{ keys: 'Ctrl+Shift+I', desc: 'Inventory (TO-DO)' },
	{ keys: 'Ctrl+Shift+4', desc: 'Debug Panel' },
	{ keys: 'Ctrl+Alt+R',   desc: 'Rebake avatar textures' },
	{ keys: 'Shift+Alt+A',  desc: 'Mic mute (toggle TO-DO)' },
	{ keys: 'Ctrl+Alt+F1',  desc: 'UI all hide/render (toggle)' },
]

const cameraRows = [
	{ keys: 'Alt+A/← / Alt+D/→ / Alt+Drag lft/rt',          desc: 'Orbit camera left/right' },
	{ keys: 'Alt+W/↑ / Alt+S/↓ / Scroll / Alt+Drag up/dwn', desc: 'Zoom camera in/out' },
	{ keys: 'Alt+E / Alt+C',              desc: 'Orbit camera up/down' },
]

</script>

<template>
	<FloaterWindow
		id="movement-help"
		title="Movement &amp; Shortcuts"
		:wrap-style="{ width: '35rem' }"
		:default-pos="{ left: '28%', top: '5%' }"
		@close="ui.showMovementHelp = false"
	>
		<div class="p-4 text-xs text-t2 space-y-5">
			<div class="flex justify-between gap-4">
				<section>
					<h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-tm mb-2">Movement</h3>
					<table class="w-full border-collapse">
						<tbody>
							<tr
								v-for="row in movementRows"
								:key="row.keys"
								class="border-b border-brd last:border-0"
							>
								<td class="py-1 pr-3 font-mono text-accent text-end whitespace-nowrap">{{ row.keys }}</td>
								<td class="py-1 text-t2">{{ row.desc }}</td>
							</tr>
						</tbody>
					</table>
				</section>
				<section>
					<h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-tm mb-2">Other shortcuts</h3>
					<table class="w-full border-collapse">
						<tbody>
							<tr
								v-for="row in shortcutRows"
								:key="row.keys"
								class="border-b border-brd last:border-0"
							>
								<td class="py-1 pr-3 font-mono text-accent text-end whitespace-nowrap">{{ row.keys }}</td>
								<td class="py-1 text-t2">{{ row.desc }}</td>
							</tr>
						</tbody>
					</table>
				</section>
			</div>

			<section>
				<h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-tm mb-2">Camera view</h3>
				<table class="w-full border-collapse">
					<tbody>
						<tr
							v-for="row in cameraRows"
							:key="row.keys"
							class="border-b border-brd last:border-0"
						>
							<td class="py-1 pr-3 font-mono text-accent text-end whitespace-nowrap">{{ row.keys }}</td>
							<td class="py-1 text-t2">{{ row.desc }}</td>
						</tr>
					</tbody>
				</table>
			</section>
		</div>
	</FloaterWindow>
</template>

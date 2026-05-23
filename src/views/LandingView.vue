<script setup>
import { computed } from 'vue'
import GridSelector from '@/components/GridSelector.vue'
import LoginForm		from '@/components/LoginForm.vue'
import { useTheme }		 from '@/composables/useTheme'
import { useGridStore } from '@/stores/gridStore'

const { isDark, toggle } = useTheme()
const gridStore = useGridStore()

const splashUrl = computed(() => gridStore.selectedGrid?.loginPage ?? null)
</script>

<template>
	<div class="fixed inset-0 overflow-hidden">

		<!-- ── Full-screen splash ─────────────────────────────────────────── -->
		<iframe
			v-if="splashUrl"
			:key="splashUrl"
			:src="splashUrl"
			class="absolute top-0 right-0 border-0 w-[80vw] h-full"
			tabindex="-1"
			aria-hidden="true"
			referrerpolicy="no-referrer"
		/>
		<div
			v-else
			class="absolute inset-0 bg-gradient-to-br from-slate-900 via-bg to-black"
		/>

		<!-- ── Login strip — 1rem from all edges, rounded, dark bg ───────── -->
		<div
			class="absolute inset-x-4 bottom-4 bg-forest/80 w-[18.25vw] min-w-[22rem] rounded-2xl overflow-y-auto"
			style="backdrop-filter: blur(18px); border: 1px solid rgba(255,255,255,0.08);"
		>
			<div class="flex flex-col items-start gap-5 px-5 py-4">

				<!-- Brand + disclaimer -->
				<div class="shrink-0 flex flex-col gap-1 w-full pt-0.5">
					<div class="flex items-center gap-2">
						<h1 class="text-2xl font-bold text-white tracking-tight leading-none">
							quicker<span class="font-black">STORM</span>
						</h1>
						<!-- Spacer pushes toggle to right -->
						<div class="flex-1" />
						<!-- Theme toggle -->
						<button
							class="rounded-full hover:bg-accent3 p-1 text-white/50 hover:text-white text-xl leading-none shrink-0 transition-colors aspect-square"
							@click="toggle"
							:title="isDark ? 'Light mode' : 'Dark mode'"
						>{{ isDark ? '☀' : '🌙' }}</button>
					</div>

					<p class="text-white/45 text-sm leading-snug my-1">
						Web viewer for OpenSimulator &amp; Second Life
					</p>
				</div>

				<!-- Divider -->
				<div class="self-stretch w-px bg-white/10 shrink-0" />

				<!-- Grid + form — constrained width -->
				<div class="flex flex-col gap-3 w-full">
					<div>
						<label class="block text-t1 text-xs uppercase tracking-widest mb-1">Grid</label>
						<GridSelector />
					</div>
					<LoginForm />
				</div>

				<!-- Disclaimer -->
				<div class="w-full mt-5 text-t1 text-xs leading-relaxed">
					<p>
						quickerSTORM is an independent project., not affiliated with or sponsored by Linden Research, Inc.  <em>Second Life®</em> is a registered trademark of Linden Research, Inc.
					</p>
					<p class="mt-2">
						Credentials are transmitted once for grid login only and are never stored.  Session token held in browser memory only.
					</p>
					<p class="mt-3 opacity-60">
						Inspired by Firestorm Viewer &amp; SpeedLight
						<br />Built with Vue 3 · Three.js · Bun · WebRTC
					</p>
				</div>
			</div>
		</div>

	</div>
</template>

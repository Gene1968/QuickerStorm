<script setup>
/**
 * AudioControlsWidget — FS-style top-right audio controls.
 *
 * Mic mute button (disabled when voice not enabled).
 * Sound mute button with chevron — hover opens mixer dropdown.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
	VideoIcon,
	MonitorIcon,
	MusicIcon,
	TvIcon,
	Mic,
	MicOff,
	Volume2,
	VolumeX,
	ChevronDown,
	Settings,
} from '@lucide/vue'
import {
	useAudio,
	isAllAudioMuted,
	toggleAllAudioMute,
} from '@/composables/useAudio.js'
import { useProximityVoice } from '@/composables/useProximityVoice.js'
import { useUiStore } from '@/stores/uiStore.js'

const ui = useUiStore()
const voice = useProximityVoice()
const {
	masterVolume,
	interfaceVolume,
	interfaceMuted,
	ambientVolume,
	soundsVolume,
	musicVolume,
	mediaVolume,
	voiceVolume,
} = useAudio()

// ── Hover dropdown ─────────────────────────────────────────────────
const showDropdown = ref(false)
let hoverTimer = null

function onEnter() {
	clearTimeout(hoverTimer)
	showDropdown.value = true
}

function onLeave() {
	hoverTimer = setTimeout(() => {
		showDropdown.value = false
	}, 150)
}

function openSoundPrefs() {
	showDropdown.value = false
	ui.openPreferencesOnTab('sound')
}

// Slider helpers — volume refs are 0-1; slider shows 0-100
function toSlider(vol) {
	return Math.round(vol * 100)
}
function fromSlider(e, volRef) {
	volRef.value = e.target.valueAsNumber / 100
}

// ── Grid time (Pacific — SL/OpenSim canonical timezone) ────────────────────
const gridTime = ref('')
const gridDate = ref('')
let clockTimer = null

function updateClock() {
	const now = new Date()
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/Los_Angeles',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZoneName: 'short',
	}).formatToParts(now)
	const h  = parts.find(p => p.type === 'hour').value
	const m  = parts.find(p => p.type === 'minute').value
	const tz = parts.find(p => p.type === 'timeZoneName').value
	gridTime.value = `${h}:${m} ${tz}`
	gridDate.value = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/Los_Angeles',
		weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
	}).format(now)
}

onMounted(() => {
	updateClock()
	clockTimer = setInterval(updateClock, 10_000)
})
onUnmounted(() => clearInterval(clockTimer))

// ── FPS + bandwidth meters (FS statusbar parity) ─────────────────────────────
// Fed by useWorldEngine at ~1 Hz via uiStore (fps from real rendered frames, netKbps from inbound
// WS bytes — all sim traffic arrives over that socket). Lag-meter colors: green = comfortable,
// amber = strained, red = struggling (lit shading auto-disables below 20, see useWorldEngine).
const fpsText  = computed(() => ui.fps > 0 ? String(ui.fps) : '--')
const fpsColor = computed(() => ui.fps <= 0 ? 'text-white/40'
	: ui.fps >= 40 ? 'text-green-500' : ui.fps >= 20 ? 'text-yellow-500' : 'text-red-500')
// Bandwidth bar height: 0 → 1 Mbps maps to 0.1 → 0.75rem (container is 1rem; FS-style mini bar).
const kbpsBarStyle = computed(() => {
	const frac = Math.min(1, ui.netKbps / 1000)
	return { height: `${(0.1 + frac * 0.65).toFixed(2)}rem` }
})

// Stub channels — static display only (no routing yet)
const stubChannels = [
	{ label: 'Ambient', vol: ambientVolume },
	{ label: 'Sounds', vol: soundsVolume },
	{ label: 'Music', vol: musicVolume },
	{ label: 'Media', vol: mediaVolume },
	{ label: 'Voice', vol: voiceVolume },
]
</script>

<template>
	<div
		class="relative flex items-center pe-2"
	>
		<div class="flex items-center gap-2 ms-1.5">
			<div
				title="Click to refresh your X$ balance (TO-DO)"
				class="mx-1 text-xs text-white/40"
			>
				?$ 0
			</div>
			<div
				title="Users want this? (TO-DO)"
				class="mx-2 text-xs text-white/40"
			>
				BUY ?$
			</div>
			<div
				:title="gridDate"
				class="me-7 ms-2 text-xs text-white/80"
			>
				{{ gridTime }}
			</div>
			<VideoIcon
				title="Camera presets (TO-DO)"
				class="w-4 h-4 text-white/20"
			/>
			<MonitorIcon
				title="Graphics presets (TO-DO)"
				class="w-4 h-4 text-white/20"
			/>
			<MusicIcon
				title="Start/stop parcel audio stream (TO-DO)"
				class="w-4 h-4 text-white/20"
			/>
			<TvIcon
				title="Start/stop all media (music, video, Web pages) (TO-DO)"
				class="w-4 h-4 text-white/20"
			/>
		</div>

		<!-- Mic mute button -->
		<button
			class="h-7 w-7 flex items-center justify-center rounded-sm hover:bg-white/15 transition-colors"
			:class="voice.isMuted.value ? 'text-red-400' : 'text-white/80'"
			:disabled="!voice.isEnabled.value"
			:style="
				!voice.isEnabled.value
					? { opacity: 0.35, cursor: 'default' }
					: {}
			"
			:title="
				voice.isMuted.value
					? 'Unmute mic (Shift+Alt+A)'
					: 'Mute mic (Shift+Alt+A)'
			"
			@click="voice.isEnabled.value && voice.toggleMute()"
		>
			<MicOff v-if="voice.isMuted.value" :size="15" />
			<Mic v-else :size="15" />
		</button>

		<!-- Sound mute button + chevron -->
		<button
			class="h-7 flex items-center me-2 px-1 rounded-sm hover:bg-white/15 transition-colors"
			:class="isAllAudioMuted ? 'text-red-400' : 'text-white/80'"
			:title="
				isAllAudioMuted ? 'Unmute sound' : 'Mute sound / Sound settings'
			"
			@click="toggleAllAudioMute"
			@mouseenter="onEnter"
			@mouseleave="onLeave"
		>
			<VolumeX v-if="isAllAudioMuted" :size="15" />
			<Volume2 v-else :size="15" />
			<ChevronDown :size="10" class="text-white opacity-60" />
		</button>

		<!-- Hover dropdown mixer -->
		<Transition name="dd">
			<div
				v-if="showDropdown"
				class="absolute right-0 top-full mt-1 w-64 bg-card border border-brd rounded-lg shadow-2xl me-1 p-3 z-[600]"
				@mouseenter="onEnter"
				@mouseleave="onLeave"
			>
				<div class="flex flex-col gap-2">
					<!-- Master row -->
					<div class="flex items-center gap-2">
						<span class="text-xs text-t1 w-20 shrink-0">
							Master
						</span>
						<input
							type="range"
							min="0"
							max="100"
							:value="toSlider(masterVolume)"
							@input="fromSlider($event, masterVolume)"
							class="flex-1 accent-accent h-1"
						/>
						<button
							class="text-xs w-5 h-5 flex items-center justify-center shrink-0 rounded-sm hover:bg-white/10 transition-colors"
							:class="
								isAllAudioMuted ? 'text-red-400' : 'text-t2'
							"
							@click="toggleAllAudioMute"
						>
							<VolumeX v-if="isAllAudioMuted" :size="16" />
							<Volume2 v-else :size="16" />
						</button>
					</div>

					<div class="border-t border-brd my-0.5" />

					<!-- Interface row (wired) -->
					<div class="flex items-center gap-2">
						<span class="text-xs text-t1 w-20 shrink-0">
							Interface
						</span>
						<input
							type="range"
							min="0"
							max="100"
							:value="toSlider(interfaceVolume)"
							@input="fromSlider($event, interfaceVolume)"
							class="flex-1 accent-accent h-1"
						/>
						<button
							class="text-xs w-5 h-5 flex items-center justify-center shrink-0 rounded-sm hover:bg-white/10 transition-colors"
							:class="interfaceMuted ? 'text-red-400' : 'text-t2'"
							@click="interfaceMuted = !interfaceMuted"
						>
							<VolumeX v-if="interfaceMuted" :size="16" />
							<Volume2 v-else :size="16" />
						</button>
					</div>

					<!-- Stub channels -->
					<div
						v-for="ch in stubChannels"
						:key="ch.label"
						class="flex items-center gap-2 opacity-40"
					>
						<span class="text-xs text-t1 w-20 shrink-0">
							{{ ch.label }}
						</span>
						<input
							type="range"
							min="0"
							max="100"
							:value="toSlider(ch.vol.value)"
							disabled
							class="flex-1 h-1"
						/>
						<div class="w-5 h-5 shrink-0" />
					</div>
				</div>

				<!-- Gear → Preferences Sound & Media -->
				<div class="flex justify-end mt-2 pt-2 border-t border-brd">
					<button
						class="flex items-center gap-1 text-xs text-tm hover:text-t1 transition-colors"
						@click="openSoundPrefs"
					>
						<Settings :size="16" />
						Settings
					</button>
				</div>
			</div>
		</Transition>
		<div v-if="ui.showFps" class="flex items-center gap-1">
			<div
				:title="`Frames per second (click for Graphics preferences)`"
				class="w-3 me-2 text-xs text-end cursor-pointer tabular-nums"
				:class="fpsColor"
				@click="ui.openPreferencesOnTab('graphics')"
			>{{ fpsText }}</div>
			<div @click="console.log('to-do: show lag meter floater')" :title="`${ui.netKbps} kbps inbound`" class="flex items-end border border-gray-500 h-full min-h-4"><div class="w-1 bg-green-500" :style="kbpsBarStyle"></div></div>
			<div @click="console.log('to-do: show lag meter floater')" title="Packet loss % (TO-DO — needs SimStats decode)" class="flex items-end border border-gray-500 h-full min-h-4"><div class="w-1 h-[0.40rem] bg-gray-500/60"></div></div>
		</div>
	</div>
</template>

<style scoped>
.dd-enter-active {
	transition:
		opacity 0.12s,
		transform 0.12s;
}
.dd-leave-active {
	transition:
		opacity 0.08s,
		transform 0.08s;
}
.dd-enter-from,
.dd-leave-to {
	opacity: 0;
	transform: translateY(-0.25rem);
}
input[type='range'] {
	width: 5rem;
}
</style>

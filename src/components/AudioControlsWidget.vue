<script setup>
/**
 * AudioControlsWidget — FS-style top-right audio controls.
 *
 * Mic mute button (disabled when voice not enabled).
 * Sound mute button with chevron — hover opens mixer dropdown.
 * Help button → toggleMovementHelp().
 */
import { ref } from 'vue'
import { Mic, MicOff, Volume2, VolumeX, ChevronDown, Settings, HelpCircle } from '@lucide/vue'
import {
	useAudio,
	isAllAudioMuted,
	toggleAllAudioMute,
} from '@/composables/useAudio.js'
import { useProximityVoice } from '@/composables/useProximityVoice.js'
import { useUiStore } from '@/stores/uiStore.js'

const ui    = useUiStore()
const voice = useProximityVoice()
const {
	masterVolume,
	interfaceVolume, interfaceMuted,
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
	hoverTimer = setTimeout(() => { showDropdown.value = false }, 150)
}

function openSoundPrefs() {
	showDropdown.value = false
	ui.openPreferencesOnTab('sound')
}

// Slider helpers — volume refs are 0-1; slider shows 0-100
function toSlider(vol) { return Math.round(vol * 100) }
function fromSlider(e, volRef) { volRef.value = e.target.valueAsNumber / 100 }

// Stub channels — static display only (no routing yet)
const stubChannels = [
	{ label: 'Ambient', vol: ambientVolume },
	{ label: 'Sounds',  vol: soundsVolume  },
	{ label: 'Music',   vol: musicVolume   },
	{ label: 'Media',   vol: mediaVolume   },
	{ label: 'Voice',   vol: voiceVolume   },
]
</script>

<template>
	<div
		class="relative flex items-center gap-1 pe-3"
		@mouseenter="onEnter"
		@mouseleave="onLeave"
	>
		<!-- Mic mute button -->
		<button
			class="h-7 w-7 flex items-center justify-center rounded hover:bg-white/15 transition-colors"
			:class="voice.isMuted.value ? 'text-red-400' : 'text-white/80'"
			:disabled="!voice.isEnabled.value"
			:style="!voice.isEnabled.value ? { opacity: 0.35, cursor: 'default' } : {}"
			:title="voice.isMuted.value ? 'Unmute mic (Shift+Alt+A)' : 'Mute mic (Shift+Alt+A)'"
			@click="voice.isEnabled.value && voice.toggleMute()"
		>
			<MicOff v-if="voice.isMuted.value" :size="15" />
			<Mic    v-else                       :size="15" />
		</button>

		<!-- Sound mute button + chevron -->
		<button
			class="h-7 flex items-center gap-0.5 px-1.5 rounded hover:bg-white/15 transition-colors"
			:class="isAllAudioMuted ? 'text-red-400' : 'text-white/80'"
			:title="isAllAudioMuted ? 'Unmute sound' : 'Mute sound / Sound settings'"
			@click="toggleAllAudioMute"
		>
			<VolumeX v-if="isAllAudioMuted" :size="15" />
			<Volume2 v-else                  :size="15" />
			<ChevronDown :size="10" class="opacity-60" />
		</button>

		<!-- Help button -->
		<button
			class="h-7 w-7 flex items-center justify-center rounded hover:bg-white/15 transition-colors text-white/60 hover:text-white/90"
			title="Movement &amp; shortcuts"
			@click="ui.toggleMovementHelp()"
		>
			<HelpCircle :size="14" />
		</button>

		<!-- Hover dropdown mixer -->
		<Transition name="dd">
			<div
				v-if="showDropdown"
				class="absolute right-0 top-full mt-1 w-56 bg-card border border-brd rounded-lg shadow-2xl p-3 z-[600]"
				@mouseenter="onEnter"
				@mouseleave="onLeave"
			>
				<div class="flex flex-col gap-2">

					<!-- Master row -->
					<div class="flex items-center gap-2">
						<span class="text-xs text-t1 w-20 shrink-0">Master</span>
						<input
							type="range" min="0" max="100"
							:value="toSlider(masterVolume)"
							@input="fromSlider($event, masterVolume)"
							class="flex-1 accent-accent h-1"
						/>
						<button
							class="text-xs w-5 h-5 flex items-center justify-center shrink-0 rounded hover:bg-white/10 transition-colors"
							:class="isAllAudioMuted ? 'text-red-400' : 'text-t2'"
							@click="toggleAllAudioMute"
						>
							<VolumeX v-if="isAllAudioMuted" :size="11" />
							<Volume2 v-else                  :size="11" />
						</button>
					</div>

					<div class="border-t border-brd my-0.5" />

					<!-- Interface row (wired) -->
					<div class="flex items-center gap-2">
						<span class="text-xs text-t1 w-20 shrink-0">Interface</span>
						<input
							type="range" min="0" max="100"
							:value="toSlider(interfaceVolume)"
							@input="fromSlider($event, interfaceVolume)"
							class="flex-1 accent-accent h-1"
						/>
						<button
							class="text-xs w-5 h-5 flex items-center justify-center shrink-0 rounded hover:bg-white/10 transition-colors"
							:class="interfaceMuted ? 'text-red-400' : 'text-t2'"
							@click="interfaceMuted = !interfaceMuted"
						>
							<VolumeX v-if="interfaceMuted" :size="11" />
							<Volume2 v-else                :size="11" />
						</button>
					</div>

					<!-- Stub channels -->
					<div
						v-for="ch in stubChannels"
						:key="ch.label"
						class="flex items-center gap-2 opacity-40"
					>
						<span class="text-xs text-t1 w-20 shrink-0">{{ ch.label }}</span>
						<input
							type="range" min="0" max="100"
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
						<Settings :size="11" />
						Settings
					</button>
				</div>
			</div>
		</Transition>
	</div>
</template>

<style scoped>
.dd-enter-active { transition: opacity 0.12s, transform 0.12s; }
.dd-leave-active { transition: opacity 0.08s, transform 0.08s; }
.dd-enter-from, .dd-leave-to { opacity: 0; transform: translateY(-0.25rem); }
</style>

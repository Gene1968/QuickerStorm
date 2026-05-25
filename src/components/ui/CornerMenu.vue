<script setup>
import { ref, computed, inject } from 'vue'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useOfficeStore } from '@/stores/officeStore.js'
import { useTheme } from '@/composables/useTheme.js'
import { AuthRepo } from '@/api/backend.js'
import { useAudio } from '@/composables/useAudio.js'
import { Settings as Cog6ToothIcon, UserCircle as UserCircleIcon, Map as MapIcon, LogOut as ArrowRightStartOnRectangleIcon, Sun as SunIcon, Moon as MoonIcon, Terminal as CommandLineIcon, Sparkles as SparklesIcon, BarChart2 as PresentationChartBarIcon, HelpCircle as QuestionMarkCircleIcon, Layers3 as Square3Stack3DIcon, Table2 as TableCellsIcon, Smartphone as DevicePhoneMobileIcon } from '@lucide/vue'
// import { BellAlertIcon } from '@lucide/vue'
import WhatsNewModal from '@/components/ui/WhatsNewModal.vue'
import HelpModal from '@/components/ui/HelpModal.vue'

const avatarStore = useAvatarStore()
const officeStore = useOfficeStore()
const { isDark, toggle: toggleTheme } = useTheme()
const { playSound } = useAudio()

const open = ref(false)
const whatsNewOpen = ref(false)
const helpOpen = ref(false)
const myInitials = computed(() => avatarStore.avatarInitials)
const myColor    = computed(() => avatarStore.color)
const myName     = computed(() => avatarStore.displayName)
const myTitle    = computed(() => avatarStore.title)
const isOverhead = computed(() => officeStore.viewMode === 'overhead')
const showFloorplan = computed(() => officeStore.showFloorplan)
const isSimpleView = computed(() => officeStore.simpleView)

const openConsole = inject('openConsole', () => {})

defineEmits(['open-avatar', 'open-settings', 'open-announcement', 'open-metrics', 'open-phone'])

function close() { open.value = false }

function toggleFloorplan() {
	officeStore.toggleFloorplan()
	close()
}

function toggleSimpleView() {
	officeStore.toggleSimpleView()
	close()
}

function openWhatsNew() {
	whatsNewOpen.value = true
	close()
}

function openHelp() {
	helpOpen.value = true
	close()
}

function toggleOverhead() {
	officeStore.toggleViewMode()
	const engine = officeStore.engineRef
	engine?.setOverhead(officeStore.viewMode === 'overhead')
	close()
}

function resetCamera() {
	officeStore.engineRef?.resetCamera()
}

async function signOut() {
	close()
	await AuthRepo.signOut()
	window.location.reload()
}
</script>

<template>
	<!-- HUD buttons top-right -->
	<div class="corner-hud">
		<!-- Floorplan toggle -->
		<!-- <button class="hud-btn" :class="{ active: showFloorplan }" @click="officeStore.toggleFloorplan()" :title="showFloorplan ? 'Hide Floorplan' : 'Show Floorplan'">
			<MapIcon style="width:15px;height:15px" />
			Floorplan
		</button> -->

		<!-- Avatar menu (wrap includes trigger so click-outside ignores trigger clicks) -->
		<div class="avatar-menu-wrap" v-click-outside="close">
			<button
				type="button"
				class="avatar-trigger animated-border"
				:class="{ active: open }"
				:aria-expanded="open"
				@click="open = !open; playSound('pop.mp3', 0.7)"
			>
				<div class="avatar-circle" :style="{ background: myColor }">
					{{ myInitials }}
				</div>
				<div class="avatar-info">
					<div class="av-name">{{ myName }}</div>
					<div class="av-title">{{ myTitle }}</div>
				</div>
				<Cog6ToothIcon style="width:15px;height:15px;color:var(--color-tm)" />
			</button>

			<Transition name="fade">
				<div class="dropdown z-1" v-if="open">
					<div class="dropdown-header">
						<div class="av-circle-lg" :style="{ background: myColor }">{{ myInitials }}</div>
						<div>
							<div class="dh-name">{{ myName }}</div>
							<div class="dh-title">{{ myTitle }}</div>
						</div>
					</div>
					<hr class="dropdown-div" />
					<button class="dd-item" @click="$emit('open-avatar'); close()">
						<UserCircleIcon class="dd-icon" /> Edit your avatar
					</button>
					<button class="dd-item" @click="$emit('open-settings'); close()">
						<Cog6ToothIcon class="dd-icon" /> Settings
					</button>
					<button class="dd-item" @click="openWhatsNew">
						<SparklesIcon class="dd-icon" /> What's new
					</button>
					<button class="dd-item" @click="openHelp">
						<QuestionMarkCircleIcon class="dd-icon" /> Help tips
					</button>
					<button class="dd-item" @click="toggleSimpleView">
						<TableCellsIcon v-if="!isSimpleView" class="dd-icon" /> <Square3Stack3DIcon v-else class="dd-icon" />
						{{ isSimpleView ? '3D graphical view' : 'Simple 2D view' }}
					</button>
					<!-- <button class="dd-item" @click="toggleFloorplan">
						<MapIcon class="dd-icon" /> {{ showFloorplan ? 'Hide' : 'Show' }} floorplan
					</button> -->
					<!-- <button class="dd-item" @click="$emit('open-announcement'); close()">
						<BellAlertIcon class="dd-icon" /> Meeting Announcement
					</button> -->
					<button class="dd-item" @click="$emit('open-metrics'); close()">
						<PresentationChartBarIcon class="dd-icon" /> Metrics / user stats
					</button>
					<button class="dd-item" @click="openConsole(); close()">
						<CommandLineIcon class="dd-icon" /> Debug console
					</button>
					<hr class="dropdown-div" />
					<button class="dd-item danger" @click="signOut">
						<ArrowRightStartOnRectangleIcon  class="dd-icon" /> Sign out
					</button>
				</div>
			</Transition>
		</div>

		<!-- Phone — quick access to Mail, Calendar, Whiteboards, Docs, Tasks -->
		<button class="hud-btn" @click="$emit('open-phone')" title="Open phone (Mail, Calendar, Whiteboards, Docs, Tasks)">
			<DevicePhoneMobileIcon style="width:15px;height:15px" />
			<span>Phone</span>
		</button>

		<!-- Theme toggle -->
		<button class="hud-btn" @click="toggleTheme" :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'">
			<SunIcon v-if="isDark"   style="width:15px;height:15px" />
			<MoonIcon v-else         style="width:15px;height:15px" />
			<span>View</span>
			{{ isDark ? 'day' : 'night' }}
		</button>

		<div v-if="!isSimpleView" class="flex">
			<!-- Reset camera -->
			<button class="hud-btn rounded-full me-n1 p-2" @click="resetCamera" title="Lost? RESET your camera view on self (Esc/Home)">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:15px;height:15px"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke="none" d="M0 0h24v24H0z"/><path d="m21 21-6-6M3.268 12.043A7.02 7.02 0 0 0 9.902 17a7.01 7.01 0 0 0 7.043-6.131 7 7 0 0 0-5.314-7.672A7.02 7.02 0 0 0 3.39 7.6"/><path d="M3 4v4h4"/></g></svg>
			</button>
			<!-- Overhead toggle -->
			<button class="hud-btn" :class="{ active: isOverhead }" @click="toggleOverhead" :title="isOverhead ? 'Switch to POV view' : 'Switch to overhead view'">
				<svg style="width:15px;height:15px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>
				</svg>
				<span>View</span>
				{{ isOverhead ? 'POV' : 'overhead' }}
			</button>
		</div>


		<WhatsNewModal v-if="whatsNewOpen" @close="whatsNewOpen = false" />
		<HelpModal v-if="helpOpen" @close="helpOpen = false" />
	</div>
</template>

<style scoped>
.corner-hud {
	position: fixed;
	top: 0.875rem;
	right: 1rem;
	display: flex;
	flex-wrap: wrap;
	flex-direction: row-reverse;
	align-items: center;
	justify-content: flex-start;
	gap: 0.5rem;
	max-width: calc(100vw - var(--sidebar-w) - 2rem);
	z-index: 70;
}

/* Avatar trigger */
.avatar-trigger {
	display: flex; align-items: center; gap: 0.625rem;
	background: rgba(13, 21, 32, 0.85);
	border: 1px solid var(--color-brd);
	border-radius: 0.5rem;
	padding: 0.375rem 0.625rem;
	cursor: pointer;
	backdrop-filter: blur(8px);
	transition: border-color 0.15s, background 0.15s;
}
.avatar-trigger:hover, .avatar-trigger.active {
	border-color: var(--color-brd2);
	background: rgba(19, 28, 46, 0.92);
}

.avatar-circle {
	width: 1.75rem; height: 1.75rem; border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	font-size: 0.6875rem; font-weight: 700;
	color: rgba(255,255,255,0.9);
	flex-shrink: 0;
}

.avatar-info { text-align: left; }
.av-name { font-size: clamp(0.7rem, 0.7vw, 0.875rem); font-weight: 600; color: var(--color-t1); line-height: 1.3; }
.av-title { font-size: 0.625rem; color: var(--color-tm); line-height: 1.3; }

/* Dropdown */
.avatar-menu-wrap { position: relative; user-select: none; }

.dropdown {
	position: absolute;
	top: calc(100% + 0.125rem);
	right: 0;
	width: clamp(12rem, 14vw, 16rem);
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 0.625rem;
	overflow: hidden;
	box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}

.dropdown-header {
	display: flex; align-items: center; gap: 0.625rem;
	padding: 0.875rem;
	background: var(--color-card2);
}

.av-circle-lg {
	width: 2.375rem; height: 2.375rem; border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	font-size: clamp(0.8rem, 0.85vw, 1rem); font-weight: 700;
	color: rgba(255,255,255,0.9);
	flex-shrink: 0;
}

.dh-name { font-size: clamp(0.75rem, 0.75vw, 0.9375rem); font-weight: 600; color: var(--color-t1); }
.dh-title { font-size: 0.6875rem; color: var(--color-tm); }

.dropdown-div {
	border: none;
	border-top: 1px solid var(--color-brd);
	margin: 0;
}

.dd-item {
	width: 100%; display: flex; align-items: center; gap: 0.625rem;
	padding: 0.625rem 0.875rem; background: none; border: none;
	color: var(--color-t2); font-size: clamp(0.75rem, 0.75vw, 0.9375rem); cursor: pointer;
	transition: background 0.12s, color 0.12s;
	text-align: left;
}
.dd-item:hover { background: rgba(255,255,255,0.05); color: var(--color-t1); }
.dd-item.danger:hover { color: var(--color-red); }
.dd-icon { width: 0.9375rem; height: 0.9375rem; flex-shrink: 0; }

/* ── Light mode (dd-item hover only; avatar-trigger handled in index.css) ── */
:global(html.light) .dd-item:hover { background: rgba(0,100,180,0.07); }
</style>

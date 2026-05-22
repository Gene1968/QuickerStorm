<script setup>
/**
 * ComputerScreen — Windows 98-style desktop overlay.
 * Opened when the user clicks the desk monitor in their personal office.
 * Desktop icons open "windowed" apps: Gmail, Calendar.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { openModal, closeModal } from '@/composables/useModalStack.js'
import GmailApp from '@/components/ui/computer/GmailApp.vue'
import CalendarApp from '@/components/ui/computer/CalendarApp.vue'

const emit = defineEmits(['close'])

const openWindows = ref([]) // ordered list of open window ids
const activeWindow = ref(null)

const desktopIcons = [
	{ id: 'gmail', label: 'Gmail', icon: '&#9993;' },
	{ id: 'calendar', label: 'Calendar', icon: '&#128197;' },
]

const windowComponents = { gmail: GmailApp, calendar: CalendarApp }
const windowTitles = { gmail: 'Gmail - Inbox', calendar: 'Calendar' }

// Clock
const clockText = ref('')
function updateClock () {
	const now = new Date()
	clockText.value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
let clockTimer = null

// ── Window management ─────────────────────────────────────────

function openApp (id) {
	if (!openWindows.value.includes(id)) openWindows.value.push(id)
	activeWindow.value = id
}

function closeWindow (id) {
	openWindows.value = openWindows.value.filter(w => w !== id)
	if (activeWindow.value === id) {
		activeWindow.value = openWindows.value.length ? openWindows.value[openWindows.value.length - 1] : null
	}
}

function focusWindow (id) {
	activeWindow.value = id
}

function minimizeWindow (id) {
	if (activeWindow.value === id) {
		activeWindow.value = openWindows.value.filter(w => w !== id).pop() || null
	}
}

// ── Desktop close (power off) ──────────────────────────────────

function powerOff () {
	closeModal()
	emit('close')
}

function onKeydown (e) {
	if (e.key === 'Escape') {
		e.stopPropagation()
		if (activeWindow.value) {
			closeWindow(activeWindow.value)
		} else {
			powerOff()
		}
	}
}

onMounted(() => {
	openModal()
	updateClock()
	clockTimer = setInterval(updateClock, 30000)
	window.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
	clearInterval(clockTimer)
	window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
	<div class="w98-backdrop" @click.self="powerOff">
		<div class="w98-monitor">
			<!-- CRT bezel -->
			<div class="w98-desktop" @click.self="activeWindow = null">

				<!-- Desktop icons -->
				<div class="w98-icons">
					<div
						v-for="icon in desktopIcons"
						:key="icon.id"
						class="w98-icon"
						@dblclick="openApp(icon.id)"
					>
						<div class="w98-icon-img" v-html="icon.icon"></div>
						<div class="w98-icon-label">{{ icon.label }}</div>
					</div>
				</div>

				<!-- Open windows -->
				<div
					v-for="wid in openWindows"
					:key="wid"
					class="w98-window"
					:class="{ focused: activeWindow === wid }"
					@mousedown="focusWindow(wid)"
				>
					<div class="w98-titlebar" :class="{ active: activeWindow === wid }">
						<span class="w98-titlebar-text">{{ windowTitles[wid] || wid }}</span>
						<div class="w98-titlebar-buttons">
							<button class="w98-tbtn" @click.stop="minimizeWindow(wid)" title="Minimize">_</button>
							<button class="w98-tbtn" disabled>&#9633;</button>
							<button class="w98-tbtn close" @click.stop="closeWindow(wid)" title="Close">&times;</button>
						</div>
					</div>
					<div class="w98-window-body">
						<KeepAlive>
							<component v-if="activeWindow === wid" :is="windowComponents[wid]" />
						</KeepAlive>
					</div>
				</div>

				<!-- Taskbar -->
				<div class="w98-taskbar">
					<button class="w98-start" @click="powerOff">
						<span class="w98-start-logo">&#9632;</span>
						<span class="w98-start-text">Shut Down</span>
					</button>
					<div class="w98-taskbar-divider"></div>
					<div class="w98-taskbar-windows">
						<button
							v-for="wid in openWindows"
							:key="wid"
							class="w98-taskbar-btn"
							:class="{ active: activeWindow === wid }"
							@click="focusWindow(wid)"
						>
							{{ windowTitles[wid] || wid }}
						</button>
					</div>
					<div class="w98-tray">
						<span class="w98-clock">{{ clockText }}</span>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
/* ── Win98 system font ──────────────────────────────────────── */
.w98-backdrop,
.w98-backdrop * {
	font-family: 'MS Sans Serif', 'Tahoma', 'Arial', sans-serif;
	-webkit-font-smoothing: none;
}

/* ── Backdrop + monitor frame ───────────────────────────────── */
.w98-backdrop {
	position: fixed;
	inset: 0;
	z-index: 600;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.75);
}

.w98-monitor {
	width: 92vw;
	height: 90vh;
	max-width: 1440px;
	max-height: 920px;
	border-radius: 14px;
	background: #3a3a3a;
	padding: 12px;
	box-shadow: 0 8px 60px rgba(0,0,0,0.7);
}

/* ── Desktop ────────────────────────────────────────────────── */
.w98-desktop {
	width: 100%;
	height: 100%;
	background: #008080;
	position: relative;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

/* ── Desktop icons ──────────────────────────────────────────── */
.w98-icons {
	padding: 16px;
	display: flex;
	flex-direction: column;
	gap: 8px;
	align-items: flex-start;
	position: relative;
	z-index: 1;
}

.w98-icon {
	display: flex;
	flex-direction: column;
	align-items: center;
	width: 72px;
	cursor: default;
	padding: 4px;
	border: 1px solid transparent;
	user-select: none;
}
.w98-icon:hover {
	background: rgba(255, 255, 255, 0.12);
}
.w98-icon:active,
.w98-icon:focus {
	border: 1px dotted #fff;
}

.w98-icon-img {
	width: 48px;
	height: 48px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 32px;
	margin-bottom: 4px;
	image-rendering: pixelated;
}

.w98-icon-label {
	font-size: 11px;
	color: #fff;
	text-align: center;
	text-shadow: 1px 1px 1px #000;
	word-break: break-word;
	line-height: 1.2;
}

/* ── Window ─────────────────────────────────────────────────── */
.w98-window {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	width: 85%;
	height: 82%;
	display: flex;
	flex-direction: column;
	/* Win98 raised border */
	border: 2px solid;
	border-color: #dfdfdf #808080 #808080 #dfdfdf;
	background: #c0c0c0;
	box-shadow: 1px 1px 0 #000;
	z-index: 10;
}
.w98-window.focused { z-index: 20; }

/* ── Title bar ──────────────────────────────────────────────── */
.w98-titlebar {
	display: flex;
	align-items: center;
	height: 22px;
	padding: 2px 3px;
	background: linear-gradient(90deg, #808080, #a0a0a0);
	user-select: none;
	flex-shrink: 0;
}
.w98-titlebar.active {
	background: linear-gradient(90deg, #000080, #1084d0);
}

.w98-titlebar-text {
	flex: 1;
	font-size: 12px;
	font-weight: bold;
	color: #c0c0c0;
	padding-left: 3px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.w98-titlebar.active .w98-titlebar-text {
	color: #fff;
}

.w98-titlebar-buttons {
	display: flex;
	gap: 2px;
}

.w98-tbtn {
	width: 18px;
	height: 16px;
	font-size: 11px;
	line-height: 1;
	padding: 0;
	cursor: pointer;
	background: #c0c0c0;
	border: 2px solid;
	border-color: #dfdfdf #808080 #808080 #dfdfdf;
	color: #000;
	display: flex;
	align-items: center;
	justify-content: center;
	font-family: inherit;
}
.w98-tbtn:active {
	border-color: #808080 #dfdfdf #dfdfdf #808080;
}
.w98-tbtn:disabled {
	color: #808080;
	cursor: default;
}
.w98-tbtn.close:hover {
	background: #c0c0c0;
}

/* ── Window body ────────────────────────────────────────────── */
.w98-window-body {
	flex: 1;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	border: 2px solid;
	border-color: #808080 #dfdfdf #dfdfdf #808080;
	margin: 2px;
	background: #fff;
}

/* ── Taskbar ────────────────────────────────────────────────── */
.w98-taskbar {
	height: 30px;
	background: #c0c0c0;
	border-top: 2px solid #dfdfdf;
	display: flex;
	align-items: center;
	gap: 0;
	padding: 2px 2px;
	flex-shrink: 0;
	z-index: 50;
	margin-top: auto;
}

.w98-start {
	display: flex;
	align-items: center;
	gap: 4px;
	height: 24px;
	padding: 0 6px;
	font-size: 12px;
	font-weight: bold;
	font-family: inherit;
	cursor: pointer;
	background: #c0c0c0;
	border: 2px solid;
	border-color: #dfdfdf #808080 #808080 #dfdfdf;
	color: #000;
}
.w98-start:active {
	border-color: #808080 #dfdfdf #dfdfdf #808080;
}
.w98-start-logo {
	font-size: 14px;
	color: #000080;
}
.w98-start-text { letter-spacing: 0.3px; }

.w98-taskbar-divider {
	width: 2px;
	height: 22px;
	margin: 0 3px;
	border-left: 1px solid #808080;
	border-right: 1px solid #dfdfdf;
}

.w98-taskbar-windows {
	flex: 1;
	display: flex;
	gap: 2px;
	overflow: hidden;
}

.w98-taskbar-btn {
	height: 24px;
	min-width: 120px;
	max-width: 180px;
	padding: 0 8px;
	font-size: 11px;
	font-family: inherit;
	text-align: left;
	cursor: pointer;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	background: #c0c0c0;
	border: 2px solid;
	border-color: #dfdfdf #808080 #808080 #dfdfdf;
	color: #000;
}
.w98-taskbar-btn.active {
	border-color: #808080 #dfdfdf #dfdfdf #808080;
	background: #b0b0b0;
	font-weight: bold;
}

/* ── System tray ────────────────────────────────────────────── */
.w98-tray {
	display: flex;
	align-items: center;
	height: 24px;
	padding: 0 8px;
	border: 2px solid;
	border-color: #808080 #dfdfdf #dfdfdf #808080;
	margin-left: auto;
}

.w98-clock {
	font-size: 11px;
	color: #000;
}
</style>

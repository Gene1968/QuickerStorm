<script setup>
/**
 * ConferenceHud — shown only while in the conference room.
 *
 * Renders a "Start / Join Meeting" button bar when idle, and a floating
 * Jitsi Meet panel when a meeting is active.  Room name is derived from
 * the current Google Calendar event, falling back to `ava-allhands`.
 */
import { ref, computed, nextTick } from 'vue'
import { useJitsiMeet } from '@/composables/useJitsiMeet.js'
import { useGoogleCalendar } from '@/composables/useGoogleCalendar.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'

const avatarStore   = useAvatarStore()
const presenceStore = usePresenceStore()
const calendar      = useGoogleCalendar()
const jitsi         = useJitsiMeet()

const jaasConfigured = !!import.meta.env.VITE_JAAS_APP_ID

const containerEl  = ref(null)
const showPanel    = ref(false)
const isMaximized  = ref(false)

// Derive the Jitsi room name from the current/next calendar event, or use a
// standing room so every conference-room user always lands in the same call.
const derivedRoom = computed(() => {
	const ev = calendar.currentEvent.value || calendar.nextEvent.value
	if (ev?.id) {
		// Slugify the event ID — keep alphanumerics, prefix with `ava-`
		return 'ava-' + ev.id.replace(/[^a-z0-9]/gi, '').slice(0, 28)
	}
	return 'ava-allhands'
})

const meetingLabel = computed(() => {
	const ev = calendar.currentEvent.value || calendar.nextEvent.value
	return ev?.summary || 'All Hands'
})

async function startMeeting() {
	showPanel.value = true
	await nextTick()
	await jitsi.join({
		room:        derivedRoom.value,
		userId:      String(presenceStore.myUserId || avatarStore.authUserId || 'anon'),
		displayName: avatarStore.displayName || 'Guest',
		avatarUrl:   avatarStore.avatarUrl   || '',
		containerEl: containerEl.value,
	})
}

function leaveMeeting() {
	jitsi.leave()
	showPanel.value   = false
	isMaximized.value = false
}
</script>

<template>
	<!-- Idle state: "Start Meeting" prompt bar -->
	<Transition name="conf-bar">
		<div v-if="!jitsi.isActive.value && !showPanel" class="conf-bar">
			<span class="conf-bar-label">
				{{ calendar.currentEvent.value ? '🔴 Meeting now' : calendar.nextEvent.value ? '🕐 Meeting soon' : '📹 Conference Room' }}
				<span v-if="calendar.currentEvent.value || calendar.nextEvent.value" class="conf-bar-title">
					— {{ meetingLabel }}
				</span>
			</span>
			<button v-if="jaasConfigured" class="conf-btn conf-btn--start" @click="startMeeting">
				Start / Join Meeting
			</button>
			<span v-else class="conf-bar-unconfigured">
				Video meetings require JaaS — see docs/VIDEOCONF_PLAN.md
			</span>
		</div>
	</Transition>

	<!-- Active state: floating Jitsi panel -->
	<Transition name="conf-panel">
		<div v-if="showPanel" class="conf-panel" :class="{ 'conf-panel--maximized': isMaximized }">
			<!-- Panel header -->
			<div class="conf-panel-header">
				<span class="conf-panel-title">
					<span class="conf-live-dot" />
					{{ jitsi.isActive.value ? 'Live' : 'Connecting…' }}
					— {{ meetingLabel }}
				</span>
				<span v-if="jitsi.participantCount.value > 0" class="conf-panel-count">
					{{ jitsi.participantCount.value }} participant{{ jitsi.participantCount.value !== 1 ? 's' : '' }}
				</span>
				<button class="conf-btn conf-btn--maximize" @click="isMaximized = !isMaximized"
					:title="isMaximized ? 'Restore' : 'Maximize'">
					{{ isMaximized ? '⤡' : '⤢' }}
				</button>
				<button class="conf-btn conf-btn--leave" @click="leaveMeeting" title="Leave meeting">
					✕ Leave
				</button>
			</div>
			<!-- Jitsi mounts here -->
			<div ref="containerEl" class="conf-panel-frame" />
		</div>
	</Transition>
</template>

<style scoped>
/* ── Idle bar ──────────────────────────────────────────────────────── */
.conf-bar {
	position: absolute;
	bottom: 7.5rem;
	left: 50%;
	transform: translateX(-50%);
	display: flex;
	align-items: center;
	gap: 0.875rem;
	padding: 0.4rem 0.875rem 0.4rem 1rem;
	background: rgba(8, 18, 32, 0.88);
	border: 1px solid rgba(0, 180, 216, 0.28);
	border-radius: 2rem;
	backdrop-filter: blur(10px);
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
	z-index: 25;
	white-space: nowrap;
	user-select: none;
}

.conf-bar-label {
	font-size: 0.8125rem;
	color: #7aabcc;
}

.conf-bar-title {
	color: #b8d8f0;
	font-weight: 600;
}

.conf-bar-unconfigured {
	font-size: 0.75rem;
	color: #3a5070;
	font-style: italic;
}

/* ── Floating Jitsi panel ─────────────────────────────────────────── */
.conf-panel {
	position: absolute;
	bottom: 4.5rem;
	right: 1rem;
	width: clamp(22rem, 42vw, 48rem);
	border-radius: 0.625rem;
	overflow: hidden;
	box-shadow: 0 0 0 2px #0a1420, 0 0 28px rgba(0, 180, 216, 0.3);
	background: #060e18;
	z-index: 25;
	display: flex;
	flex-direction: column;
}

.conf-panel-header {
	display: flex;
	align-items: center;
	gap: 0.625rem;
	padding: 0.375rem 0.75rem;
	background: #0b1e36;
	border-bottom: 1px solid rgba(0, 180, 216, 0.15);
	min-height: 2.375rem;
}

.conf-panel-title {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	font-size: 0.8125rem;
	font-weight: 600;
	color: #b8d8f0;
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.conf-live-dot {
	display: inline-block;
	width: 0.5rem;
	height: 0.5rem;
	border-radius: 50%;
	background: #f04040;
	box-shadow: 0 0 6px #f04040;
	animation: live-pulse 1.4s ease-in-out infinite;
	flex-shrink: 0;
}

@keyframes live-pulse {
	0%, 100% { opacity: 1; }
	50%       { opacity: 0.35; }
}

.conf-panel-count {
	font-size: 0.75rem;
	color: #507090;
	white-space: nowrap;
}

.conf-panel-frame {
	width: 100%;
	aspect-ratio: 16 / 9;
	background: #000;
}

/* ── Maximized state ─────────────────────────────────────────────── */
.conf-panel--maximized {
	position: fixed;
	inset: 0;
	width: 100%;
	height: 100%;
	bottom: unset;
	right: unset;
	border-radius: 0;
	z-index: 600;
}

.conf-panel--maximized .conf-panel-frame {
	aspect-ratio: unset;
	flex: 1;
	min-height: 0;
}

/* iframes injected by Jitsi need pointer-events */
.conf-panel-frame :deep(iframe) {
	width: 100% !important;
	height: 100% !important;
	border: none;
	pointer-events: all;
}

/* ── Buttons ──────────────────────────────────────────────────────── */
.conf-btn {
	border: 1px solid rgba(255, 255, 255, 0.18);
	border-radius: 1.25rem;
	cursor: pointer;
	font-size: 0.75rem;
	font-weight: 700;
	padding: 0.3rem 0.875rem;
	transition: background 0.15s, color 0.15s;
	white-space: nowrap;
}

.conf-btn--start {
	background: rgba(0, 180, 216, 0.18);
	border-color: rgba(0, 180, 216, 0.35);
	color: #7ad8f8;
}
.conf-btn--start:hover {
	background: rgba(0, 180, 216, 0.35);
	color: #fff;
}

.conf-btn--maximize {
	background: rgba(255, 255, 255, 0.06);
	border-color: rgba(255, 255, 255, 0.15);
	color: #7aabcc;
	margin-left: auto;
	padding: 0.2rem 0.5rem;
	font-size: 0.875rem;
}
.conf-btn--maximize:hover {
	background: rgba(255, 255, 255, 0.14);
	color: #fff;
}

.conf-btn--leave {
	background: rgba(200, 40, 40, 0.18);
	border-color: rgba(200, 40, 40, 0.35);
	color: #f08080;
}
.conf-btn--leave:hover {
	background: rgba(200, 40, 40, 0.38);
	color: #fff;
}

/* ── Transitions ─────────────────────────────────────────────────── */
.conf-bar-enter-active,
.conf-bar-leave-active  { transition: opacity 0.25s, transform 0.25s; }
.conf-bar-enter-from,
.conf-bar-leave-to      { opacity: 0; transform: translateX(-50%) translateY(0.5rem); }

.conf-panel-enter-active,
.conf-panel-leave-active { transition: opacity 0.3s, transform 0.3s; }
.conf-panel-enter-from,
.conf-panel-leave-to     { opacity: 0; transform: translateY(0.75rem); }
</style>

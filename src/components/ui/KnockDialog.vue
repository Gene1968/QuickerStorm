<script setup>
/**
 * KnockDialog — shown when a user tries to enter a room that is locked (private).
 * Listens for 'ava-room-blocked' from the engine (navigation blocked by closed doors).
 * On knock: notifies occupants via voice signaling (if active) AND presence data.
 * On admit: dispatches 'ava-knock-admitted' so the engine can navigate past the lock.
 */
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useProximityVoice, knockSent } from '@/composables/useProximityVoice.js'
import { useOfficeStore } from '@/stores/officeStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { usePresence } from '@/composables/usePresence.js'
import { ALL_ROOMS } from '@/config/officeLayout.js'
import { Lock as LockClosedIcon } from '@lucide/vue'

const voice = useProximityVoice()
const officeStore = useOfficeStore()
const presenceStore = usePresenceStore()
const presence = usePresence()

const KNOCK_TIMEOUT = 30_000
let knockTimer = null

const blockedRoomId = ref(null)
const hasKnocked = ref(false)
const roomName = ref('')

function onRoomBlocked(e) {
	const roomId = e.detail.roomId
	blockedRoomId.value = roomId
	hasKnocked.value = false
	knockSent.value = false
	const room = ALL_ROOMS.find(r => r.id === roomId)
	roomName.value = room?.name || roomId
}

function doKnock() {
	if (!blockedRoomId.value) return
	hasKnocked.value = true

	// Signal server path (instant, if voice is active)
	if (voice.isEnabled.value) {
		voice.knock(blockedRoomId.value)
	}

	// Presence path (always): write knockingAt into our avatarState
	// and force an immediate heartbeat so occupants see it right away
	officeStore.setMyAvatarState({ knockingAt: blockedRoomId.value })
	presence.writeHeartbeat()

	// Start timeout
	clearTimeout(knockTimer)
	knockTimer = setTimeout(() => {
		goBack()
	}, KNOCK_TIMEOUT)
}

function goBack() {
	clearTimeout(knockTimer)
	blockedRoomId.value = null
	hasKnocked.value = false
	knockSent.value = false
	// Clear knock from presence and flush immediately
	officeStore.setMyAvatarState({ knockingAt: null })
	presence.writeHeartbeat()
}

function onAdmitted() {
	clearTimeout(knockTimer)
	const roomId = blockedRoomId.value
	blockedRoomId.value = null
	hasKnocked.value = false
	knockSent.value = false
	officeStore.setMyAvatarState({ knockingAt: null })
	if (roomId) {
		window.dispatchEvent(new CustomEvent('ava-knock-admitted', { detail: { roomId } }))
	}
}

function onDenied() { goBack() }

onMounted(() => {
	window.addEventListener('ava-room-blocked', onRoomBlocked)
	window.addEventListener('ava-knock-denied', onDenied)
})
onUnmounted(() => {
	window.removeEventListener('ava-room-blocked', onRoomBlocked)
	window.removeEventListener('ava-knock-denied', onDenied)
	clearTimeout(knockTimer)
})

// Signal-server admission path: 'admitted' message clears knockPending
import { knockPending } from '@/composables/useProximityVoice.js'
watch(knockPending, (val, oldVal) => {
	if (oldVal && !val && hasKnocked.value && blockedRoomId.value) {
		onAdmitted()
	}
})

// Presence-based admission path: watch for any occupant writing admitKnocker
// with our userId and the room we're trying to enter
watch(() => presenceStore.users, (users) => {
	if (!hasKnocked.value || !blockedRoomId.value) return
	const myId = String(presenceStore.myUserId)
	for (const u of users) {
		const ak = u.avatarState?.admitKnocker
		if (ak && String(ak.userId) === myId && ak.roomId === blockedRoomId.value) {
			onAdmitted()
			return
		}
	}
}, { deep: true })
</script>

<template>
	<Teleport to="body">
		<Transition name="knock-fade">
			<div v-if="blockedRoomId" class="knock-overlay">
				<div class="knock-dialog">
					<div class="knock-icon">
						<LockClosedIcon class="knock-lock-svg" />
					</div>
					<h3 class="knock-title">{{ roomName }} is private</h3>

					<template v-if="!hasKnocked">
						<p class="knock-desc">
							A conversation is in progress. Knock to request entry.
						</p>
						<div class="knock-actions">
							<button class="knock-btn knock-btn--primary" @click="doKnock">
								Knock
							</button>
							<button class="knock-btn knock-btn--secondary" @click="goBack">
								Nevermind
							</button>
						</div>
					</template>

					<template v-else>
						<p class="knock-desc">
							Waiting for someone to let you in...
						</p>
						<div class="knock-spinner"></div>
						<button class="knock-btn knock-btn--secondary mt-2" @click="goBack">
							Cancel
						</button>
					</template>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.knock-overlay {
	position: fixed;
	inset: 0;
	z-index: 300;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.55);
	backdrop-filter: blur(4px);
}

.knock-dialog {
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 1rem;
	padding: 2rem 2.5rem;
	text-align: center;
	max-width: 22rem;
	box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.5);
}

.knock-icon {
	margin-bottom: 1rem;
}

.knock-lock-svg {
	width: 2.5rem;
	height: 2.5rem;
	color: var(--color-red, #ef4444);
}

.knock-title {
	font-size: 1.125rem;
	font-weight: 700;
	color: var(--color-t1);
	margin: 0 0 0.5rem;
}

.knock-desc {
	font-size: 0.8125rem;
	color: var(--color-t2);
	margin: 0 0 1.25rem;
	line-height: 1.5;
}

.knock-actions {
	display: flex;
	gap: 0.75rem;
	justify-content: center;
}

.knock-btn {
	border: none;
	border-radius: 0.5rem;
	font-size: 0.8125rem;
	font-weight: 600;
	padding: 0.5rem 1.25rem;
	cursor: pointer;
	transition: opacity 0.15s, transform 0.1s;
}

.knock-btn:active { transform: scale(0.96); }

.knock-btn--primary {
	background: var(--color-accent);
	color: #fff;
}
.knock-btn--primary:hover { opacity: 0.85; }

.knock-btn--secondary {
	background: var(--color-card2);
	color: var(--color-t2);
	border: 1px solid var(--color-brd2);
}
.knock-btn--secondary:hover { background: rgba(255, 255, 255, 0.06); }

.knock-spinner {
	width: 1.5rem;
	height: 1.5rem;
	border: 2px solid var(--color-brd2);
	border-top-color: var(--color-accent);
	border-radius: 50%;
	animation: knock-spin 0.8s linear infinite;
	margin: 0 auto;
}

@keyframes knock-spin {
	to { transform: rotate(360deg); }
}

.mt-2 { margin-top: 0.75rem; }

/* Transition */
.knock-fade-enter-active, .knock-fade-leave-active {
	transition: opacity 0.2s;
}
.knock-fade-enter-from, .knock-fade-leave-to {
	opacity: 0;
}
</style>

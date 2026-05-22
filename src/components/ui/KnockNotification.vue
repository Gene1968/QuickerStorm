<script setup>
/**
 * KnockNotification — floating toast(s) shown to room occupants when
 * someone knocks on a locked (private) room.
 *
 * Knock detection (two paths, deduplicated):
 *   1. Signal server: pendingKnockers from useProximityVoice (instant, requires voice)
 *   2. Presence poll: users with avatarState.knockingAt === my current room (8s latency)
 */
import { computed, watch, ref, onUnmounted } from 'vue'
import { pendingKnockers } from '@/composables/useProximityVoice.js'
import { useProximityVoice } from '@/composables/useProximityVoice.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useOfficeStore } from '@/stores/officeStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { usePresence } from '@/composables/usePresence.js'
import { useAudio } from '@/composables/useAudio.js'

const voice = useProximityVoice()
const presenceStore = usePresenceStore()
const officeStore = useOfficeStore()
const avatarStore = useAvatarStore()
const presence = usePresence()
const { playChime } = useAudio()

const AUTO_DENY_MS = 30_000
const denyTimers = ref(new Map())  // knockerId → timeout
const admittedIds = ref(new Set()) // track who we've already admitted

// Knocker IDs from signal server are compound "userId_session" — extract the userId part
function parseKnockerId(knockerId) {
	return knockerId?.split('_')[0] ?? knockerId
}

// Detect knockers from presence data: users whose avatarState.knockingAt matches my room
const presenceKnockers = computed(() => {
	const myRoom = officeStore.currentRoomId
	if (!myRoom) return []
	return presenceStore.users
		.filter(u => u.avatarState?.knockingAt === myRoom && String(u.id) !== String(presenceStore.myUserId))
		.map(u => ({
			knockerId: String(u.id),
			name: u.name || u.title || `User ${u.id}`,
			fromPresence: true,
		}))
})

// Merge signal-server knockers + presence knockers (deduplicated)
const knockerInfos = computed(() => {
	const seen = new Set()
	const result = []

	// Signal server knockers (instant)
	for (const knockerId of pendingKnockers.value) {
		const userId = parseKnockerId(knockerId)
		if (admittedIds.value.has(userId)) continue
		seen.add(userId)
		const user = presenceStore.users.find(u => String(u.id) === String(userId))
		result.push({
			knockerId,
			userId,
			name: user?.name || user?.title || `User ${userId}`,
		})
	}

	// Presence-based knockers (fallback)
	for (const pk of presenceKnockers.value) {
		if (seen.has(pk.knockerId) || admittedIds.value.has(pk.knockerId)) continue
		result.push({
			knockerId: pk.knockerId,
			userId: pk.knockerId,
			name: pk.name,
		})
	}

	return result
})

// Play chime when new knockers appear. When the local user is set to "busy",
// auto-decline immediately + toast the busy user; the dialog itself is also
// hidden in the template by the same condition.
const prevKnockerIds = ref(new Set())
watch(knockerInfos, (infos) => {
	for (const info of infos) {
		if (!prevKnockerIds.value.has(info.userId)) {
			if (avatarStore.status === 'busy') {
				deny(info.knockerId)
				window.dispatchEvent(new CustomEvent('ava-toast', {
					detail: { message: `🔕 Auto-declined knock from ${info.name} (you're set to Busy)`, type: 'info' },
				}))
				continue
			}
			playChime()
			// Auto-deny after timeout
			const timer = setTimeout(() => deny(info.knockerId), AUTO_DENY_MS)
			denyTimers.value.set(info.knockerId, timer)
		}
	}
	prevKnockerIds.value = new Set(infos.map(i => i.userId))
}, { deep: true })

function admit(knockerId) {
	const userId = parseKnockerId(knockerId)
	clearTimeout(denyTimers.value.get(knockerId))
	denyTimers.value.delete(knockerId)
	admittedIds.value.add(userId)

	// Signal server path
	if (voice.isEnabled.value) {
		voice.admitKnocker(knockerId)
	}

	// Presence path: write an admit marker that the knocker's KnockDialog can detect.
	// We use a custom event that usePresence can write to the admitted user's row.
	// For now, we dispatch a global event the knocker's client will see on next poll.
	// The knocker watches their own avatarState for an 'admittedTo' field.
	officeStore.setMyAvatarState({
		admitKnocker: { userId, roomId: officeStore.currentRoomId, ts: Date.now() },
	})
	presence.writeHeartbeat()

	// Clear after a bit so it doesn't persist
	setTimeout(() => {
		admittedIds.value.delete(userId)
		officeStore.setMyAvatarState({ admitKnocker: null })
	}, 15_000)
}

function deny(knockerId) {
	clearTimeout(denyTimers.value.get(knockerId))
	denyTimers.value.delete(knockerId)

	if (voice.isEnabled.value) {
		voice.denyKnocker(knockerId)
	}
}

onUnmounted(() => {
	for (const timer of denyTimers.value.values()) clearTimeout(timer)
})
</script>

<template>
	<Teleport to="body">
		<Transition name="kn-fade">
			<div v-if="knockerInfos.length && avatarStore.status !== 'busy'" class="kn-overlay">
				<div class="kn-modal">
					<div class="kn-header">
						<span class="kn-header-icon">🚪</span>
						<span class="kn-header-title">Someone is knocking</span>
					</div>

					<div class="kn-list">
						<div v-for="info in knockerInfos" :key="info.knockerId" class="kn-entry">
							<div class="kn-entry-info">
								<span class="kn-name">{{ info.name }}</span>
								<span class="kn-msg">wants to enter this room</span>
							</div>
							<div class="kn-entry-actions">
								<button class="kn-btn kn-btn--admit" @click="admit(info.knockerId)">Admit</button>
								<button class="kn-btn kn-btn--deny" @click="deny(info.knockerId)">Deny</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.kn-overlay {
	position: fixed;
	inset: 0;
	z-index: 300;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.45);
	backdrop-filter: blur(3px);
}

.kn-modal {
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 1rem;
	padding: 1.5rem 2rem;
	max-width: 24rem;
	min-width: 18rem;
	box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.5);
}

.kn-header {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-bottom: 1rem;
	padding-bottom: 0.75rem;
	border-bottom: 1px solid var(--color-brd2);
}

.kn-header-icon {
	font-size: 1.5rem;
}

.kn-header-title {
	font-size: 1rem;
	font-weight: 700;
	color: var(--color-t1);
}

.kn-list {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.kn-entry {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.625rem 0.75rem;
	background: rgba(239, 68, 68, 0.06);
	border: 1px solid rgba(239, 68, 68, 0.2);
	border-radius: 0.625rem;
}

.kn-entry-info {
	display: flex;
	flex-direction: column;
	gap: 0.125rem;
	min-width: 0;
}

.kn-name {
	font-size: 0.875rem;
	font-weight: 700;
	color: var(--color-t1);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.kn-msg {
	font-size: 0.6875rem;
	color: var(--color-tm);
}

.kn-entry-actions {
	display: flex;
	gap: 0.375rem;
	flex-shrink: 0;
}

.kn-btn {
	border: none;
	border-radius: 0.4375rem;
	font-size: 0.75rem;
	font-weight: 600;
	padding: 0.375rem 0.75rem;
	cursor: pointer;
	transition: opacity 0.15s, transform 0.1s;
}
.kn-btn:active { transform: scale(0.96); }

.kn-btn--admit {
	background: var(--color-accent);
	color: #fff;
}
.kn-btn--admit:hover { opacity: 0.85; }

.kn-btn--deny {
	background: var(--color-card2);
	color: var(--color-t2);
	border: 1px solid var(--color-brd2);
}
.kn-btn--deny:hover { background: rgba(255, 255, 255, 0.06); }

/* Transition */
.kn-fade-enter-active, .kn-fade-leave-active { transition: opacity 0.2s; }
.kn-fade-enter-from, .kn-fade-leave-to { opacity: 0; }
</style>

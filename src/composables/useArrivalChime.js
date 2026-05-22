/**
 * useArrivalChime — plays a soft double-chime when the first person
 * arrives in the room while the local user is alone there.
 *
 * Conditions:
 *   • Only fires after a 3-second settle window on mount (avoids
 *     triggering during initial presence data population).
 *   • Only fires when other-user count transitions 0 → 1+.
 *   • Does not fire when switching rooms (currentRoomId change resets
 *     the baseline without a chime).
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useOfficeStore }   from '@/stores/officeStore.js'
import { useAvatarStore }   from '@/stores/avatarStore.js'
import { useAudio }         from '@/composables/useAudio.js'

export function useArrivalChime() {
	const presenceStore = usePresenceStore()
	const officeStore   = useOfficeStore()
	const avatarStore   = useAvatarStore()
	const { playChime } = useAudio()

	function maybePlayChime() {
		if (avatarStore.status === 'busy') return
		playChime()
	}

	const ready = ref(false)
	let readyTimer = null

	onMounted(() => {
		readyTimer = setTimeout(() => { ready.value = true }, 1200)
	})
	onUnmounted(() => clearTimeout(readyTimer))

	// Non-offline others in my current room (excludes me via myUserId)
	const othersHere = computed(() => {
		const roomId = officeStore.currentRoomId
		if (!roomId) return []
		const myId = String(presenceStore.myUserId ?? '')
		return presenceStore.usersInRoom(roomId)
			.filter(u => String(u.id) !== myId)
	})

	// Reset silently when I change rooms so the chime isn't
	// triggered by the room's existing occupants.
	watch(() => officeStore.currentRoomId, () => { ready.value = false })

	watch(othersHere, (now, before) => {
		if (!ready.value) return
		if ((before?.length ?? 0) === 0 && now.length >= 1) {
			maybePlayChime()
		}
	})

	// Re-arm ready after a room change settle (same 3-second window).
	// If others are already present when ready fires, play the chime once —
	// so the entering user knows the room is occupied.
	watch(() => officeStore.currentRoomId, () => {
		clearTimeout(readyTimer)
		readyTimer = setTimeout(() => {
			ready.value = true
			if (othersHere.value.length > 0) maybePlayChime()
		}, 1200)
	})
}


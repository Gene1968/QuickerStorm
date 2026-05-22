import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * presenceStore — tracks who is in which room.
 * Updated by `usePresence` (poll + heartbeat; Supabase Realtime when configured).
 */
export const usePresenceStore = defineStore('presence', () => {
	// ── State ──────────────────────────────────────────────────────
	/** Array of presence records: { id, name, title, email, roomId, seatId, avatarUrl, color, status, lastSeen, posX, posZ, rotation, avatarState } */
	const users = ref([])
	const myUserId = ref(null)
	const mySeatId = ref(null)
	const pollingActive = ref(false)

	// ── Computed ───────────────────────────────────────────────────
	const onlineUsers = computed(() => users.value.filter(u => u.status !== 'offline'))

	const usersInRoom = computed(() => (roomId) =>
		users.value.filter(u => u.roomId === roomId && u.status !== 'offline')
	)

	const usersInSeat = computed(() => (seatId) =>
		users.value.find(u => u.seatId === seatId && u.status !== 'offline') || null
	)

	const otherUsers = computed(() =>
		users.value.filter(u => u.id !== myUserId.value)
	)

	// ── Actions ────────────────────────────────────────────────────
	function setMyUserId (id) {
		myUserId.value = id
	}

	function setMySeatId (id) {
		mySeatId.value = id
	}

	function upsertUser (record) {
		const idx = users.value.findIndex(u => u.id === record.id)
		if (idx >= 0) {
			users.value[idx] = { ...users.value[idx], ...record }
		} else {
			users.value.push(record)
		}
	}

	function setUsers (records) {
		users.value = records
	}

	function removeUser (id) {
		users.value = users.value.filter(u => u.id !== id)
	}

	function updateMyRoom (roomId) {
		if (!myUserId.value) return
		upsertUser({ id: myUserId.value, roomId, lastSeen: new Date().toISOString() })
	}

	function setPolling (val) {
		pollingActive.value = val
	}

	return {
		users,
		myUserId,
		mySeatId,
		pollingActive,
		onlineUsers,
		usersInRoom,
		usersInSeat,
		otherUsers,
		setMyUserId,
		setMySeatId,
		upsertUser,
		setUsers,
		removeUser,
		updateMyRoom,
		setPolling,
	}
})

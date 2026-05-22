/**
 * usePoseSync — avatar pose (position, rotation, state) sync layer.
 *
 * Two transports work in parallel:
 *  • DB writes (durable backup) — the WS server flushes positions to Supabase
 *    every 30s. Late joiners get positions from the world snapshot.
 *  • WS relay (immediate) — pose changes are sent to the WS server which
 *    relays to room peers. Same-room peers see movement instantly.
 */
import { watch } from 'vue'
import { useOfficeStore } from '@/stores/officeStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { isDisplaced } from '@/composables/usePresence.js'
import { playSound, setSoundBroadcaster } from '@/composables/useAudio.js'
import { ALL_ROOMS } from '@/config/officeLayout.js'

// Set by OfficeCanvas — invoked whenever a peer pose lands.
let _applyPeerPose = null

export function registerPeerPoseHandler(fn) {
	_applyPeerPose = fn
}

// Set by OfficeCanvas — invoked when a peer toggles a fridge door.
let _applyFridge = null

export function registerFridgeHandler(fn) {
	_applyFridge = fn
}

// Active cleanup handles for the watchers below.
let _stopRoomWatch = null
let _stopPoseWatch = null
const _handlerRefs = []

function _on (type, cb) {
	const rtSocket = useRealtimeSocket()
	rtSocket.on(type, cb)
	_handlerRefs.push([type, cb])
}

function _removeAllHandlers () {
	const rtSocket = useRealtimeSocket()
	for (const [type, cb] of _handlerRefs) rtSocket.off(type, cb)
	_handlerRefs.length = 0
}

export function sendRoomSound(filename, volume = 1) {
	const rtSocket = useRealtimeSocket()
	rtSocket.emit('sound', { filename, volume })
}

export function startPoseSync() {
	const rtSocket = useRealtimeSocket()
	setSoundBroadcaster(sendRoomSound)

	const officeStore   = useOfficeStore()
	const presenceStore = usePresenceStore()

	// Register WS handlers for incoming pose and sound from peers
	_on('pose', (data) => {
		if (!data || !data.userId) return
		const myId = presenceStore.myUserId ? String(presenceStore.myUserId) : ''
		if (String(data.userId) === myId) return
		_applyPeerPose?.(data.userId, data.x, data.z, data.r, data.s)
	})

	_on('sound', (data) => {
		if (data?.filename) playSound(data.filename, data.volume)
	})

	_on('fridge', (data) => {
		if (data?.side && data?.action) _applyFridge?.(data.side, data.action)
	})

	// Relay pose/state writes the engine pushes into officeStore.
	// setMyPose fires once per walk-tween completion, so no extra throttling needed.
	_stopPoseWatch = watch(
		() => [
			officeStore.myPosX,
			officeStore.myPosZ,
			officeStore.myRotation,
			officeStore.myAvatarState,
		],
		([x, z, rotation, state]) => {
			if (isDisplaced.value) return
			const myId = presenceStore.myUserId ? String(presenceStore.myUserId) : ''
			if (!myId) return
			let bx = x
			let bz = z
			const seatId = officeStore.currentSeatId
			if (seatId) {
				// Use the layout-derived seat world position — g.position trails the GSAP
				// tween by up to 600 ms after claimSeat fires setMyPose, which would
				// broadcast the pre-tween walk coords and cause peers to see the avatar at
				// the wrong spot until the debounced 'room' event corrects things.
				const roomId = seatId.includes(':') ? seatId.slice(0, seatId.indexOf(':')) : null
				const room = roomId ? ALL_ROOMS.find(r => r.id === roomId) : null
				const seat = room?.seats?.find(s => s.seatId === seatId)
				if (seat) {
					const [rx, rz] = room.pos
					const [sx, , sz] = seat.pos
					bx = rx + sx
					bz = rz + sz
				} else {
					// Generic desk seat (office-N:desk) — no layout entry, fall back to mesh
					const g = officeStore.engineRef?.avatarGroups?.get(myId)
					if (g) { bx = g.position.x; bz = g.position.z }
				}
			}
			rtSocket.emit('pose', { x: bx, z: bz, r: rotation, s: state })
		},
		{ deep: true },
	)
}

export function stopPoseSync() {
	_stopRoomWatch?.(); _stopRoomWatch = null
	_stopPoseWatch?.(); _stopPoseWatch = null
	_removeAllHandlers()
	setSoundBroadcaster(null)
}

// Convenience: write pose into the store. The watcher above handles the relay.
export function broadcastPose(x, z, rotation, state = {}) {
	const officeStore = useOfficeStore()
	officeStore.setMyPose(x, z, rotation)
	if (Object.keys(state).length) officeStore.setMyAvatarState(state)
}

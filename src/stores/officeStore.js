import { defineStore } from 'pinia'
import { ref, computed, markRaw } from 'vue'
import { getRoomById, OFFICES } from '@/config/officeLayout.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { pickMyOfficeDestination } from '@/utils/pickMyOffice.js'

export const useOfficeStore = defineStore('office', () => {
	// ── State ──────────────────────────────────────────────────────
	const currentRoomId = ref('lobby')
	const pendingRoomId = ref(null)   // set at nav start, cleared on arrival
	const currentSeatId = ref(null)
	const previousRoomId = ref(null)
	const isTransitioning = ref(false)
	const viewMode = ref('pov')           // 'pov' | 'overhead'
	const showFloorplan = ref(false)
	// Simple view: replaces 3D canvas with SVG floorplan + HTML room panel.
	// Auto-enabled on small screens (<768px) unless user has an explicit saved pref.
	const _savedSimplePref = localStorage.getItem('ava_simple_view')
	const simpleView = ref(_savedSimplePref !== null ? _savedSimplePref === '1' : false)

	// Door open states: roomId-wall → boolean
	const doorStates = ref({})

	// Navigation engine ref (set by OfficeCanvas after init)
	const engineRef = ref(null)

	// Whether the current user arrived in the current office as a visitor (not the occupant)
	const isVisitingOffice = ref(false)

	// Singlechat: ID of the user we're currently in a face-to-face session with
	const singlechatPeerId = ref(null)

	// My avatar's last-known pose within the current room.
	// Written by the engine after walk animations settle; read by usePresence for heartbeat writes.
	// In Option B (real-time relay), usePoseSync.js will also broadcast these values.
	const myPosX = ref(0)
	const myPosZ = ref(0)
	const myRotation = ref(0)
	// True once the engine has written an authoritative pose for the current room
	// via setMyPose. Reset on room change so syncLocalAvatarFromPresence can honor
	// the persisted DB pose on first spawn / session restore, but skip it afterwards
	// (the DB lags 3 s behind local moves and stale echoes would otherwise tween
	// the avatar back to pre-walk coords whenever a peer broadcast re-fires the
	// users watcher).
	const hasLocalPose = ref(false)
	// Generic state blob — extend as new interaction states are added.
	// e.g. { holding: null | 'coffee-cup', gesture: null }
	const myAvatarState = ref({})

	// ── Computed ───────────────────────────────────────────────────
	const currentRoom = computed(() => getRoomById(currentRoomId.value))
	const pendingRoom = computed(() => pendingRoomId.value ? getRoomById(pendingRoomId.value) : null)
	const previousRoom = computed(() => previousRoomId.value ? getRoomById(previousRoomId.value) : null)
	/** The office the current user is sitting in as occupant (null if visiting or not in an office) */
	// Match generated offices like "office-1" … "office-16" but NOT "office-hall"
	const myCurrentOfficeId = computed(() =>
		/^office-\d+$/.test(currentRoomId.value) && !isVisitingOffice.value
			? currentRoomId.value
			: null,
	)

	// ── Actions ────────────────────────────────────────────────────
	function setCurrentRoom (roomId) {
		if (roomId === currentRoomId.value) return
		previousRoomId.value = currentRoomId.value
		currentRoomId.value = roomId
		// Clear stale pose coords so the old room's world position isn't broadcast
		// into the new room. Peers use random placement until the avatar walks somewhere.
		myPosX.value = 0
		myPosZ.value = 0
		myRotation.value = 0
		// Engine will call setMyPose with the landing position in navigateTo's
		// onComplete; until then, a DB row with the previous room's pose must not
		// be applied to the avatar.
		hasLocalPose.value = false
	}

	function setCurrentSeat (id) {
		currentSeatId.value = id
	}

	function setPendingRoom (id) {
		pendingRoomId.value = id
	}

	function setTransitioning (val) {
		isTransitioning.value = val
	}

	function toggleViewMode () {
		viewMode.value = viewMode.value === 'pov' ? 'overhead' : 'pov'
	}

	function toggleFloorplan () {
		showFloorplan.value = !showFloorplan.value
	}

	function setSimpleView (val) {
		simpleView.value = val
		localStorage.setItem('ava_simple_view', val ? '1' : '0')
	}

	function toggleSimpleView () {
		setSimpleView(!simpleView.value)
	}

	function setDoorState (roomId, wall, isOpen) {
		doorStates.value[`${roomId}-${wall}`] = isOpen
	}

	function isDoorOpen (roomId, wall) {
		return doorStates.value[`${roomId}-${wall}`] ?? false
	}

	function setEngine (engine) {
		// markRaw prevents Vue from walking the Three.js engine's graph looking for
		// reactive triggers — it's a plain object tree with huge internal fan-out.
		engineRef.value = engine ? markRaw(engine) : null
	}

	function navigateTo (roomId, opts = {}) {
		if (engineRef.value?.navigateTo) {
			engineRef.value.navigateTo(roomId, opts)
		}
	}

	function setIsVisitingOffice (val) {
		isVisitingOffice.value = val
	}

	function goToMyOffice () {
		const presence = usePresenceStore()
		const preferred =
			myCurrentOfficeId.value ??
			OFFICES.find((o) => String(o.userId) === String(presence.myUserId))?.id ??
			null
		const chosen = pickMyOfficeDestination(
			OFFICES,
			preferred,
			presence.myUserId,
			presence.users,
		)
		if (chosen) navigateTo(chosen, { bypassLock: true })
	}

	function startSinglechat (peerId) {
		singlechatPeerId.value = peerId
	}

	function endSinglechat () {
		singlechatPeerId.value = null
	}

	function visitUser (user) {
		if (engineRef.value?.visitUser) engineRef.value.visitUser(user)
	}

	function setMyPose (x, z, rotation) {
		myPosX.value = x
		myPosZ.value = z
		myRotation.value = rotation
		hasLocalPose.value = true
	}

	function setMyAvatarState (state) {
		myAvatarState.value = { ...myAvatarState.value, ...state }
	}

	return {
		currentRoomId,
		pendingRoomId,
		currentSeatId,
		previousRoomId,
		isTransitioning,
		isVisitingOffice,
		viewMode,
		showFloorplan,
		simpleView,
		doorStates,
		engineRef,
		currentRoom,
		pendingRoom,
		previousRoom,
		myCurrentOfficeId,
		setCurrentRoom,
		setPendingRoom,
		setCurrentSeat,
		setIsVisitingOffice,
		setTransitioning,
		toggleViewMode,
		toggleFloorplan,
		setSimpleView,
		toggleSimpleView,
		setDoorState,
		isDoorOpen,
		setEngine,
		navigateTo,
		visitUser,
		goToMyOffice,
		singlechatPeerId,
		startSinglechat,
		endSinglechat,
		myPosX,
		myPosZ,
		myRotation,
		hasLocalPose,
		myAvatarState,
		setMyPose,
		setMyAvatarState,
	}
})

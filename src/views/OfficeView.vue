<script setup>
/**
 * OfficeView — the main virutal world experience layout.
 * Orchestrates the Three.js canvas, sidebar, floorplan, voice bar,
 * avatar maker modal, and presence polling.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import OfficeCanvas from '@/components/office/OfficeCanvas.vue'
import SimpleOfficeView from '@/components/office/SimpleOfficeView.vue'
import TheSidebar from '@/components/sidebar/TheSidebar.vue'
import CornerMenu from '@/components/ui/CornerMenu.vue'
import AppGrid from '@/components/ui/AppGrid.vue'
import FloorplanOverlay from '@/components/office/FloorplanOverlay.vue'
import OfficeShelf from '@/components/office/OfficeShelf.vue'
import AvatarMaker from '@/components/avatar/AvatarMaker.vue'
import ProximityVoiceBar from '@/components/ui/ProximityVoiceBar.vue'
import UserPopup from '@/components/ui/UserPopup.vue'
import EmoteRadialMenu from '@/components/ui/EmoteRadialMenu.vue'
import KudosFlyout from '@/components/ui/KudosFlyout.vue'
import DogPopup from '@/components/ui/DogPopup.vue'
import DmFlyout from '@/components/ui/DmFlyout.vue'
import BreakRoomTV from '@/components/ui/BreakRoomTV.vue'
import ConferenceHud from '@/components/office/ConferenceHud.vue'
import AnnouncementBanner from '@/components/ui/AnnouncementBanner.vue'
import CallInviteBanner from '@/components/ui/CallInviteBanner.vue'
import KnockDialog from '@/components/ui/KnockDialog.vue'
import KnockNotification from '@/components/ui/KnockNotification.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import AnnouncementModal from '@/components/ui/AnnouncementModal.vue'
import MagazineModal from '@/components/ui/MagazineModal.vue'
import MetricsView from '@/views/MetricsView.vue'
import SuggestionBoxModal from '@/components/ui/SuggestionBoxModal.vue'
import ArcadeSnakeModal from '@/components/ui/ArcadeSnakeModal.vue'
import ArcadePacmanModal from '@/components/ui/ArcadePacmanModal.vue'
import ArcadeCentipedeModal from '@/components/ui/ArcadeCentipedeModal.vue'
import Connect4Modal from '@/components/ui/Connect4Modal.vue'
import ComputerScreen from '@/components/ui/ComputerScreen.vue'
import TicketModal from '@/components/ui/TicketModal.vue'
import SessionDisplacedModal from '@/components/ui/SessionDisplacedModal.vue'
import ActivityPausedModal from '@/components/ui/ActivityPausedModal.vue'
import WhiteboardOverlay from '@/components/collab/WhiteboardOverlay.vue'
import WhiteboardHistory from '@/components/collab/WhiteboardHistory.vue'
import CollabDocOverlay from '@/components/collab/CollabDocOverlay.vue'
import CollabDocHistory from '@/components/collab/CollabDocHistory.vue'
import RoomCollabBar from '@/components/collab/RoomCollabBar.vue'
import ReactionStream from '@/components/collab/ReactionStream.vue'
import ReactionTray from '@/components/collab/ReactionTray.vue'
import TaskBoardOverlay from '@/components/collab/TaskBoardOverlay.vue'
import TaskBoardHistory from '@/components/collab/TaskBoardHistory.vue'
import PhoneOverlay from '@/components/ui/PhoneOverlay.vue'
import { useRealtimeSocket as _useRealtimeSocket } from '@/composables/useRealtimeSocket.js'

const _ws = _useRealtimeSocket()

import gsap from 'gsap'
import { useOfficeStore } from '@/stores/officeStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useUiStore } from '@/stores/uiStore.js'
import { usePresence, isDisplaced, isPaused, pauseSession, resumeSession } from '@/composables/usePresence.js'
import { useIdleDetector } from '@/composables/useIdleDetector.js'
import { useArrivalChime } from '@/composables/useArrivalChime.js'
// import { useSlack } from '@/composables/useSlack.js'
import { useMessaging } from '@/composables/useMessaging.js'
import { useAudio } from '@/composables/useAudio.js'
import { useVersionCheck } from '@/composables/useVersionCheck.js'
import { useAnnouncements } from '@/composables/useAnnouncements.js'
import { useKudos } from '@/composables/useKudos.js'
import { OFFICES } from '@/config/officeLayout.js'

// ── Auto-detect simple view + sidebar collapse ───────────────────────
// Runs synchronously before child components (TheSidebar) mount,
// so TheSidebar reads the correct initial localStorage values.
{
	const _smallScreen = window.innerWidth < 768
	const _lowTier =
		(navigator.hardwareConcurrency != null && navigator.hardwareConcurrency <= 4) ||
		(navigator.deviceMemory    != null && navigator.deviceMemory    <= 2)

	if (localStorage.getItem('ava_simple_view') === null && (_smallScreen || _lowTier)) {
		// setSimpleView writes localStorage immediately
		useOfficeStore().setSimpleView(true)
	}
	if (localStorage.getItem('ava_sidebar_collapsed') === null && _smallScreen) {
		localStorage.setItem('ava_sidebar_collapsed', '1')
	}
}

const isMyOffice = computed(() => !!officeStore.myCurrentOfficeId)

const officeStore   = useOfficeStore()
const avatarStore   = useAvatarStore()
const presenceStore = usePresenceStore()
const ui            = useUiStore()
const presence = usePresence()
// const slack = useSlack()
const messaging = useMessaging()
const announcements = useAnnouncements()
const kudos = useKudos()
const { playGreet, playSound } = useAudio()
// Auto-away at 30 min idle/hidden; disconnects WS and shows pause modal at 2 h
useIdleDetector(() => presence.writeHeartbeat(), pauseSession)
useArrivalChime()
const { updateAvailable } = useVersionCheck()
function reloadPage () { window.location.reload() }

const officeCanvasRef = ref(null)
const showAvatarMaker = ref(false)
const showMetrics = ref(false)
// showSettings replaced by ui.showPreferences (PreferencesFloater in App.vue)
const showAnnouncementModal = ref(false)
const magazineUrl = ref('')
const showMagazine = ref(false)
const showSuggestionBox = ref(false)
const showArcade = ref(false)
const showArcadePacman = ref(false)
const showArcadeCentipede = ref(false)
const showConnect4 = ref(false)
const showComputer = ref(false)
const showWhiteboard = ref(false)
const whiteboardRoomId = ref('')
const whiteboardDocId = ref('')  // explicit docId (for archived boards)
const showBoardHistory = ref(false)
const boardHistoryItems = ref([])
const boardHistoryLoading = ref(false)
const showCollabDoc = ref(false)
const collabDocRoomId = ref('')
const collabDocId = ref('')  // explicit docId (for archived docs)
const showDocHistory = ref(false)
const docHistoryItems = ref([])
const docHistoryLoading = ref(false)
const showTaskBoard = ref(false)
const taskBoardRoomId = ref('')
const taskBoardDocId = ref('')
const showTaskBoardHistory = ref(false)
const taskBoardHistoryItems = ref([])
const taskBoardHistoryLoading = ref(false)
const showPhone = ref(false)
const showTicket = ref(false)
const myTicket = ref(null)
const nowServing = ref(randomInt(8, 42))

function randomInt (lo, hi) { return Math.floor(Math.random() * (hi - lo + 1)) + lo }

function onTicketPull () {
	myTicket.value = randomInt(180, 999)
	// Now serving is always way below the ticket you just pulled — the gag
	nowServing.value = randomInt(3, Math.max(4, myTicket.value - 120))
	officeStore.engineRef?.setNowServingNumber?.(nowServing.value)
	showTicket.value = true
}
function onNowServingClick () {
	// Re-roll a new low number for fun
	nowServing.value = randomInt(3, myTicket.value ? Math.max(4, myTicket.value - 60) : 60)
	officeStore.engineRef?.setNowServingNumber?.(nowServing.value)
}

// Paint the initial random number on the sign once the engine is ready
watch(() => officeStore.engineRef, (engine) => {
	engine?.setNowServingNumber?.(nowServing.value)
}, { immediate: true })
/** After first-run AvatarMaker save, open Settings so users can connect Slack (etc.). */
const openSettingsAfterFirstAvatarSave = ref(false)

// ── Toast ────────────────────────────────────────────────────────────
const toast = ref(null)   // { message, type }
let toastTimer = null
function onToast (e) {
	clearTimeout(toastTimer)
	toast.value = e.detail
	toastTimer = setTimeout(() => { toast.value = null }, 5000)
}

// ── Email toast (persistent, dismissable) ────────────────────────────
const emailToast = ref(null) // { message }
function onEmailToast (e) {
	emailToast.value = e.detail
	playSound('notification.mp3')
}
function dismissEmailToast () { emailToast.value = null }

// ── Greeting received (fired by usePresence when a peer greets us) ───
function onGreetingReceived (e) {
	const { fromUserId, sameRoom } = e.detail
	playGreet()
	if (!sameRoom) return
	const engine = officeStore.engineRef
	const myId = presenceStore.myUserId
	if (engine && myId) {
		const myGroup = engine.avatarGroups?.get(myId)
		const senderGroup = engine.avatarGroups?.get(fromUserId)
		if (myGroup && senderGroup) {
			const dx = senderGroup.position.x - myGroup.position.x
			const dz = senderGroup.position.z - myGroup.position.z
			gsap.to(myGroup.rotation, {
				y: Math.atan2(dx, dz), duration: 0.38, ease: 'back.out(1.6)',
				onComplete: () => officeStore.setMyPose(myGroup.position.x, myGroup.position.z, myGroup.rotation.y)
			})
			gsap.to(senderGroup.rotation, { y: Math.atan2(-dx, -dz), duration: 0.38, ease: 'back.out(1.6)' })
		}
	}
}

function onIntercomClick () { showAnnouncementModal.value = true }
function onMagazineClick (e) { magazineUrl.value = e.detail.url; showMagazine.value = true }
function onSuggestionBoxClick () { showSuggestionBox.value = true }
function onArcadeClick () { showArcade.value = true }
function onArcadePacmanClick () { showArcadePacman.value = true }
function onArcadeCentipedeClick () { showArcadeCentipede.value = true }
function onConnect4Click () { showConnect4.value = true }
function onMonitorClick (e) {
	if (e.detail?.roomId && e.detail.roomId === officeStore.myCurrentOfficeId) {
		showComputer.value = true
	}
}
function onWhiteboardClick (e) {
	whiteboardRoomId.value = e.detail?.roomId || officeStore.currentRoomId
	whiteboardDocId.value = ''  // use default wb-{roomId}
	showWhiteboard.value = true
}

function openBoardHistory () {
	showBoardHistory.value = true
	boardHistoryLoading.value = true

	function handleResult (data) {
		if (data.action !== 'list-history') return
		_ws.off('ypr', handleResult)
		boardHistoryItems.value = data.ok ? (data.data || []) : []
		boardHistoryLoading.value = false
	}
	_ws.on('ypr', handleResult)
	_ws.emit('yp', { docId: null, action: 'list-history', roomId: officeStore.currentRoomId, type: 'whiteboard' })
}

function openArchivedBoard (archivedDocId) {
	showBoardHistory.value = false
	whiteboardRoomId.value = officeStore.currentRoomId
	whiteboardDocId.value = archivedDocId
	showWhiteboard.value = true
}

function onCollabDocClick (e) {
	collabDocRoomId.value = e.detail?.roomId || officeStore.currentRoomId
	collabDocId.value = ''
	showCollabDoc.value = true
}

function openCollabDoc (overrideDocId) {
	collabDocRoomId.value = officeStore.currentRoomId
	collabDocId.value = overrideDocId || ''
	showCollabDoc.value = true
}

function openDocHistory () {
	showDocHistory.value = true
	docHistoryLoading.value = true

	function handleResult (data) {
		if (data.action !== 'list-history') return
		_ws.off('ypr', handleResult)
		docHistoryItems.value = data.ok ? (data.data || []) : []
		docHistoryLoading.value = false
	}
	_ws.on('ypr', handleResult)
	_ws.emit('yp', { docId: null, action: 'list-history', roomId: officeStore.currentRoomId, type: 'doc' })
}

function openArchivedDoc (archivedDocId) {
	showDocHistory.value = false
	collabDocRoomId.value = officeStore.currentRoomId
	collabDocId.value = archivedDocId
	showCollabDoc.value = true
}

function handleDocOverlayClose (payload) {
	showCollabDoc.value = false
	collabDocId.value = ''
	// If overlay requested reopening a different doc (history), do that next
	if (payload && payload.reopenAs) {
		setTimeout(() => openCollabDoc(payload.reopenAs), 50)
	}
}

function openTaskBoard (overrideDocId) {
	taskBoardRoomId.value = officeStore.currentRoomId
	taskBoardDocId.value = overrideDocId || ''
	showTaskBoard.value = true
}

function openTaskBoardHistory () {
	showTaskBoardHistory.value = true
	taskBoardHistoryLoading.value = true

	function handleResult (data) {
		if (data.action !== 'list-history') return
		_ws.off('ypr', handleResult)
		taskBoardHistoryItems.value = data.ok ? (data.data || []) : []
		taskBoardHistoryLoading.value = false
	}
	_ws.on('ypr', handleResult)
	_ws.emit('yp', { docId: null, action: 'list-history', roomId: officeStore.currentRoomId, type: 'taskboard' })
}

function openArchivedTaskBoard (archivedDocId) {
	showTaskBoardHistory.value = false
	taskBoardRoomId.value = officeStore.currentRoomId
	taskBoardDocId.value = archivedDocId
	showTaskBoard.value = true
}

function handleTaskBoardClose (payload) {
	showTaskBoard.value = false
	taskBoardDocId.value = ''
	if (payload && payload.reopenAs) {
		setTimeout(() => openTaskBoard(payload.reopenAs), 50)
	}
}

/**
 * Open any collab doc by id from anywhere (e.g. the phone overlay). Routes
 * to the matching overlay based on type + populates docId/roomId so the
 * overlay connects to the right server-side doc, regardless of the user's
 * current room.
 */
function handleCollabOpen (e) {
	const detail = e.detail || {}
	const { type, docId, roomId } = detail
	if (!docId || !roomId) return
	if (type === 'whiteboard') {
		whiteboardRoomId.value = roomId
		whiteboardDocId.value = docId
		showWhiteboard.value = true
	} else if (type === 'doc') {
		collabDocRoomId.value = roomId
		collabDocId.value = docId
		showCollabDoc.value = true
	} else if (type === 'taskboard') {
		taskBoardRoomId.value = roomId
		taskBoardDocId.value = docId
		showTaskBoard.value = true
	}
}

function onSessionResumed () {
	setTimeout(() => restorePoseAndFocus(), 600)
	announcements.start()
	kudos.start()
}

function onSessionDisplaced () {
	announcements.stop()
	kudos.stop()
}

function onSessionPaused () {
	announcements.stop()
	kudos.stop()
}

// After reclaiming the session, restore this browser's saved location.
// presenceStore.mySeatId and officeStore.currentSeatId are already cleared by
// usePresence before this fires, so syncLocalAvatarFromPresence won't re-seat us
// at the other device's position when the world snapshot arrives.
function onSessionReclaimed () {
	announcements.start()
	kudos.start()
	const savedRoom = sessionStorage.getItem('ava_last_room')
	const savedSeat = sessionStorage.getItem('ava_last_seat')
	if (savedRoom && savedRoom !== 'lobby') {
		setTimeout(() => officeStore.navigateTo(savedRoom, { ...(savedSeat ? { seatId: savedSeat } : {}), bypassLock: true, skipLandingPoseSave: true }), 300)
		if (!savedSeat) setTimeout(() => restorePoseAndFocus(), 1900)
	} else if (savedSeat) {
		setTimeout(() => officeStore.engineRef?.claimSeat('lobby', savedSeat), 300)
	} else {
		setTimeout(() => restorePoseAndFocus(), 600)
	}
}

onMounted(() => {
	resumeSession()  // clear stale isPaused from HMR or prior mount cycle
	window.addEventListener('ava-toast', onToast)
	window.addEventListener('ava-greeting-received', onGreetingReceived)
	window.addEventListener('ava-intercom-click', onIntercomClick)
	window.addEventListener('ava-magazine-click', onMagazineClick)
	window.addEventListener('ava-suggestion-box-click', onSuggestionBoxClick)
	window.addEventListener('ava-arcade-click', onArcadeClick)
	window.addEventListener('ava-arcade-pacman-click', onArcadePacmanClick)
	window.addEventListener('ava-arcade-centipede-click', onArcadeCentipedeClick)
	window.addEventListener('ava-c4-click', onConnect4Click)
	window.addEventListener('ava-monitor-click', onMonitorClick)
	window.addEventListener('ava-whiteboard-click', onWhiteboardClick)
	window.addEventListener('ava-collab-doc-click', onCollabDocClick)
	window.addEventListener('ava-collab-open', handleCollabOpen)
	window.addEventListener('ava-email-toast', onEmailToast)
	window.addEventListener('ava-ticket-pull', onTicketPull)
	window.addEventListener('ava-now-serving-click', onNowServingClick)
	window.addEventListener('ava-rate-limited', onRateLimited)
	window.addEventListener('ava-session-reclaimed', onSessionReclaimed)
	window.addEventListener('ava-session-resumed', onSessionResumed)
	window.addEventListener('ava-session-displaced', onSessionDisplaced)
	window.addEventListener('ava-session-paused', onSessionPaused)
})
onUnmounted(() => {
	window.removeEventListener('ava-toast', onToast)
	window.removeEventListener('ava-greeting-received', onGreetingReceived)
	window.removeEventListener('ava-intercom-click', onIntercomClick)
	window.removeEventListener('ava-magazine-click', onMagazineClick)
	window.removeEventListener('ava-suggestion-box-click', onSuggestionBoxClick)
	window.removeEventListener('ava-arcade-click', onArcadeClick)
	window.removeEventListener('ava-arcade-pacman-click', onArcadePacmanClick)
	window.removeEventListener('ava-arcade-centipede-click', onArcadeCentipedeClick)
	window.removeEventListener('ava-c4-click', onConnect4Click)
	window.removeEventListener('ava-monitor-click', onMonitorClick)
	window.removeEventListener('ava-whiteboard-click', onWhiteboardClick)
	window.removeEventListener('ava-collab-doc-click', onCollabDocClick)
	window.removeEventListener('ava-collab-open', handleCollabOpen)
	window.removeEventListener('ava-email-toast', onEmailToast)
	window.removeEventListener('ava-ticket-pull', onTicketPull)
	window.removeEventListener('ava-now-serving-click', onNowServingClick)
	window.removeEventListener('ava-rate-limited', onRateLimited)
	window.removeEventListener('ava-session-reclaimed', onSessionReclaimed)
	window.removeEventListener('ava-session-resumed', onSessionResumed)
	window.removeEventListener('ava-session-displaced', onSessionDisplaced)
	window.removeEventListener('ava-session-paused', onSessionPaused)
	clearTimeout(toastTimer)
})

const showRateLimit = ref(false)
const rateLimitMsg = ref('')
function onRateLimited (e) {
	const status = e.detail?.status
	const source = e.detail?.source
	if (source === 'slack' || status === 429) {
		rateLimitMsg.value = 'Slack is rate limiting requests — some messages may be delayed.'
	} else if (status === 503) {
		rateLimitMsg.value = 'SharePoint is temporarily unavailable — some data may be stale.'
	} else {
		rateLimitMsg.value = 'SharePoint is rate limiting requests — some data may be stale.'
	}
	showRateLimit.value = true
}

const showFloorplan = computed(() => officeStore.showFloorplan)
const currentRoom = computed(() => officeStore.currentRoom)
const WHITEBOARD_ROOMS = new Set(['conference', 'meeting-a', 'meeting-b'])
const roomHasWhiteboard = computed(() => WHITEBOARD_ROOMS.has(officeStore.currentRoomId))
const COLLAB_DOC_ROOMS = new Set(['conference', 'meeting-a', 'meeting-b'])
const roomHasCollabDoc = computed(() => COLLAB_DOC_ROOMS.has(officeStore.currentRoomId))
const TASK_BOARD_ROOMS = new Set(['conference', 'meeting-a', 'meeting-b'])
const roomHasTaskBoard = computed(() => TASK_BOARD_ROOMS.has(officeStore.currentRoomId))

// ── Bootstrap ────────────────────────────────────────────────────────
onMounted(async () => {
	// Assign offices to employees (will be populated from presence data)
	assignOfficesToUsers()

	// Start presence polling + Slack sync + native messaging
	presence.start()
	// slack.start()
	messaging.start()

	// Start announcement polling + kudos feed
	announcements.start()
	kudos.start()

	// Show avatar maker on first run; otherwise spawn immediately from local store
	// so the correct custom appearance is used before presence data arrives.
	if (!avatarStore.isSetupDone) {
		showAvatarMaker.value = true
		openSettingsAfterFirstAvatarSave.value = true
	} else {
		spawnLocalAvatar()
		// Restore last room + seat (sessionStorage survives page refresh, not new tabs)
		const savedRoom = sessionStorage.getItem('ava_last_room')
		const savedSeat = sessionStorage.getItem('ava_last_seat')
		if (savedRoom && savedRoom !== 'lobby') {
			setTimeout(() => officeStore.navigateTo(savedRoom, { ...(savedSeat ? { seatId: savedSeat } : {}), bypassLock: true, skipLandingPoseSave: true }), 300)
			// After nav animation settles (~1.5 s), restore position within the room then pan to self
			if (!savedSeat) setTimeout(() => restorePoseAndFocus(), 1900)
		} else if (savedSeat) {
			// Already in lobby — navigateTo short-circuits for same-room, so claim directly
			setTimeout(() => officeStore.engineRef?.claimSeat('lobby', savedSeat), 300)
		} else {
			// Lobby, no seat — restore position and focus camera after engine settles
			setTimeout(() => restorePoseAndFocus(), 600)
		}
	}
})

// HMR stale-state fix: once myUserId arrives from the first presence poll,
// re-confirm the current room so isVisit and OfficeShelf resolve correctly.
// (After hot reload the engine resets to lobby, but the room restore may have
// fired before presence data was ready, leaving isVisitingOffice in the wrong state.)
const _unwatchMyId = watch(() => presenceStore.myUserId, (id) => {
	if (!id) return
	_unwatchMyId()
	const room = sessionStorage.getItem('ava_last_room')
	if (room && room !== 'lobby' && officeStore.currentRoomId === room) {
		// Re-navigate in-place to recompute isVisit now that we know our own ID
		officeStore.navigateTo(room, { forceVisit: false, bypassLock: true })
	}
})

// HMR engine-replacement fix: when useOfficeEngine hot-reloads, it replaces the
// engine ref (prev non-null → new non-null). Re-spawn the avatar and re-navigate
// so the camera ends up where the store says we are.
watch(() => officeStore.engineRef, (engine, prevEngine) => {
	if (!engine || !prevEngine) return  // skip initial registration
	spawnLocalAvatar()
	const savedRoom = sessionStorage.getItem('ava_last_room')
	const savedSeat = sessionStorage.getItem('ava_last_seat')
	if (savedRoom && savedRoom !== 'lobby') {
		setTimeout(() => officeStore.navigateTo(savedRoom, { ...(savedSeat ? { seatId: savedSeat } : {}), skipLandingPoseSave: true }), 400)
		if (!savedSeat) setTimeout(() => restorePoseAndFocus(), 2100)
	} else if (savedSeat) {
		setTimeout(() => engine?.claimSeat('lobby', savedSeat), 400)
	} else {
		setTimeout(() => restorePoseAndFocus(), 700)
	}
})

// Persist current room + seat to sessionStorage so page refresh lands back here.
// My own room change also ends any active singlechat.
// Clear saved pose on room change — position is room-specific.
// Skip clearing when navigating back to the same room (reload/HMR restore) so
// restorePoseAndFocus can still read the coords saved before the page refresh.
watch(() => officeStore.currentRoomId, (roomId) => {
	const prevSavedRoom = sessionStorage.getItem('ava_last_room')
	if (roomId) sessionStorage.setItem('ava_last_room', roomId)
	if (roomId !== prevSavedRoom) {
		sessionStorage.removeItem('ava_last_pos_x')
		sessionStorage.removeItem('ava_last_pos_z')
		sessionStorage.removeItem('ava_last_rotation')
	}
	officeStore.endSinglechat()
})

// Persist the user's position within the current room so it can be restored after
// a page reload. Only saved when not seated (seat restore uses seatId, not coords).
watch(() => officeStore.myPosX, (x) => { if (!officeStore.currentSeatId) sessionStorage.setItem('ava_last_pos_x', String(x)) })
watch(() => officeStore.myPosZ, (z) => { if (!officeStore.currentSeatId) sessionStorage.setItem('ava_last_pos_z', String(z)) })
watch(() => officeStore.myRotation, (r) => { if (!officeStore.currentSeatId) sessionStorage.setItem('ava_last_rotation', String(r)) })

// End singlechat if the peer moves to a different room.
// Watch only the peer's roomId, not the whole users array — a deep watch here fires
// on every position heartbeat (every few seconds per user), which is expensive on slow CPUs.
watch(() => {
	const peerId = officeStore.singlechatPeerId
	if (!peerId) return null
	const peer = presenceStore.users.find(u => String(u.id) === peerId)
	return peer ? peer.roomId : '__missing__'
}, (peerRoomId) => {
	if (!officeStore.singlechatPeerId) return
	if (peerRoomId === '__missing__' || peerRoomId !== officeStore.currentRoomId) {
		officeStore.endSinglechat()
	}
})
watch(() => officeStore.currentSeatId, (seatId) => {
	if (seatId) sessionStorage.setItem('ava_last_seat', seatId)
	else sessionStorage.removeItem('ava_last_seat')
})

// Sync presence users to offices — only quickerSTORM users get a door label
function assignOfficesToUsers () {
	const engine = officeStore.engineRef

	// Clear all office labels first so vacated offices go blank
	OFFICES.forEach(office => {
		office.userId = null
		office.userName = null
		office.userTitle = null
		office.userStatus = 'offline'
		office.userAvatarColor = null
		engine?.updateDoorLabel(office.id, '')
	})

	// Only assign online/non-offline users, sorted by stable numeric ID so the
	// same person always maps to the same slot regardless of join/leave order.
	const active = presenceStore.users
		.filter(u => u.status !== 'offline')
		.sort((a, b) => Number(a.id) - Number(b.id))

	active.forEach((user, i) => {
		if (i >= OFFICES.length) return
		OFFICES[i].userId = user.id
		OFFICES[i].userName = user.name
		OFFICES[i].userTitle = user.title
		OFFICES[i].userStatus = user.status
		OFFICES[i].userAvatarColor = user.color
		engine?.updateDoorLabel(OFFICES[i].id, user.name || '')
	})
}

// Only re-run when user membership or status changes — not on every position heartbeat.
// Deep-watching the full users array fired on every PosX/PosZ update, causing constant
// reshuffling of office slots and breaking the "My Office" computed lookup.
watch(
	() => presenceStore.users.map(u => `${u.id}:${u.status}`).join(','),
	assignOfficesToUsers,
)

function spawnLocalAvatar () {
	const engine = officeStore.engineRef
	if (!engine || !avatarStore.displayName) return
	// Use the list-item ID if presence has already resolved it; otherwise fall back
	// to authUserId. This matches OfficeCanvas.onMounted and onAvatarDone so that
	// re-spawning after engine replacement (HMR / re-navigation) always uses the same
	// key the avatar currently lives under — preventing a ghost at the old authUserId.
	const myId = String(presenceStore.myUserId || avatarStore.authUserId || 'me')
	engine.setMyUserId(myId)
	engine.spawnAvatar({
		id: myId,
		name: avatarStore.displayName,
		color: avatarStore.color,
		status: avatarStore.status,
		roomId: officeStore.currentRoomId || 'lobby',
		avatarUrl: avatarStore.avatarUrl,
	})
	if (avatarStore.avatarUrl?.endsWith('.glb')) {
		engine.loadGLTFAvatar(myId, avatarStore.avatarUrl)
	}
	// Re-apply avatar state in case fetchPresence already restored it before this spawn
	if (officeStore.myAvatarState?.holding) {
		engine.applyAvatarState(myId, officeStore.myAvatarState)
	}
}

// Restore the avatar's saved position within the current room from sessionStorage,
// then smoothly pan the camera to look at the user from behind.
// Called after room navigation has settled so the avatar is already in the right room.
function restorePoseAndFocus () {
	// Saved x/z are for standing only — never snap away from a chair using stale session coords.
	if (officeStore.currentSeatId) return
	// Nav tween blocks panCameraToAvatar — retry until it settles.
	if (officeStore.isTransitioning) {
		setTimeout(restorePoseAndFocus, 200)
		return
	}
	const posX = parseFloat(sessionStorage.getItem('ava_last_pos_x'))
	const posZ = parseFloat(sessionStorage.getItem('ava_last_pos_z'))
	const rot = parseFloat(sessionStorage.getItem('ava_last_rotation'))
	const engine = officeStore.engineRef
	if (!engine) return
	if (!isNaN(posX) && !isNaN(posZ)) {
		// restoreMyPose nudges away from any overlapping peer then pans camera.
		engine.restoreMyPose(posX, posZ, isNaN(rot) ? undefined : rot)
	} else {
		// No saved position — just pan to wherever the avatar landed.
		const myId = String(presenceStore.myUserId || avatarStore.authUserId || 'me')
		engine.panCameraToAvatar?.(myId)
	}
}

function onAvatarDone () {
	showAvatarMaker.value = false
	if (openSettingsAfterFirstAvatarSave.value) {
		openSettingsAfterFirstAvatarSave.value = false
		ui.openPreferences()
	}
	const engine = officeStore.engineRef
	if (engine && avatarStore.displayName) {
		// Use the live list-item ID if presence has resolved it — avoids spawning
		// a duplicate avatar at the old authUserId key after re-keying.
		const myId = String(presenceStore.myUserId || avatarStore.authUserId || 'me')
		engine.setMyUserId(myId)
		engine.spawnAvatar({
			id: myId,
			name: avatarStore.displayName,
			color: avatarStore.color,
			status: avatarStore.status,
			roomId: officeStore.currentRoomId || 'lobby',
			avatarUrl: avatarStore.avatarUrl,
		})
		if (avatarStore.avatarUrl?.endsWith('.glb')) {
			engine.loadGLTFAvatar(myId, avatarStore.avatarUrl)
		}
		// Restore seat/position and held items so avatar rebuild doesn't drop user to room origin.
		const seatId = presenceStore.mySeatId || officeStore.currentSeatId || null
		const roomId = officeStore.currentRoomId || 'lobby'
		if (seatId) {
			const seatRoomId = seatId.includes(':') ? seatId.slice(0, seatId.indexOf(':')) : roomId
			engine.moveAvatarToRoom(myId, seatRoomId, seatId, {})
		} else {
			const posX = parseFloat(sessionStorage.getItem('ava_last_pos_x'))
			const posZ = parseFloat(sessionStorage.getItem('ava_last_pos_z'))
			const rot  = parseFloat(sessionStorage.getItem('ava_last_rotation'))
			if (!isNaN(posX) && !isNaN(posZ)) {
				engine.moveAvatarToRoom(myId, roomId, null, {
					posX,
					posZ,
					rotation: isNaN(rot) ? undefined : rot,
				})
			}
		}
		if (officeStore.myAvatarState) {
			engine.applyAvatarState(myId, officeStore.myAvatarState)
		}
	}
}

// Room transition indicator
const isTransitioning = computed(() => officeStore.isTransitioning)
const roomLabel = computed(() => {
	if (isTransitioning.value && officeStore.pendingRoom) {
		return `Going to: ${officeStore.pendingRoom.name}`
	}
	if (!currentRoom.value?.name) return ''
	const suffix = officeStore.currentSeatId
		? ', seated'
		: officeStore.isVisitingOffice
			? ', visiting'
			: ''
	return `You are in: ${currentRoom.value.name}${suffix}`
})
</script>

<template>
	<!-- flex row: sidebar + canvas -->
	<div class="flex w-screen h-screen overflow-hidden bg-bg">
		<!-- Left sidebar -->
		<TheSidebar @open-avatar="showAvatarMaker = true" @open-settings="ui.openPreferences()" />

		<!-- Main canvas area -->
		<div class="relative flex-1 overflow-hidden" @pointerdown="messaging.activeConversation.value && messaging.closeConversation()">
			<!-- DM flyout (sits at left edge of canvas, next to sidebar) -->
			<DmFlyout />

			<!-- Announcement banner (fixed top-center, shown to all clients on new announcement) -->
			<AnnouncementBanner />
			<CallInviteBanner />
			<KnockDialog />
			<KnockNotification />
			<ConfirmModal />

			<!-- Three.js canvas (hidden in simple view) -->
			<OfficeCanvas v-if="!officeStore.simpleView" ref="officeCanvasRef" />

			<!-- Simple view: SVG floorplan + room panel (replaces canvas) -->
			<SimpleOfficeView v-else />

			<!-- Floorplan overlay (not needed in simple view — the SVG IS the view) -->
			<Transition name="fade">
				<FloorplanOverlay v-if="showFloorplan && !officeStore.simpleView" />
			</Transition>

			<!-- Room name HUD (top center) -->
			<Transition name="fade">
				<div class="room-hud flex align-items-end" v-if="roomLabel">
					<span class="room-hud-text" :class="{ transitioning: isTransitioning }">{{ roomLabel }}<span v-if="isTransitioning" class="room-hud-ellipsis" aria-hidden="true"></span></span>
				</div>
			</Transition>

			<!-- Transition vignette -->
			<Transition name="fade">
				<div class="transition-vignette" v-if="isTransitioning" />
			</Transition>

			<!-- Nine-dot apps launcher (top left of canvas) -->
			<AppGrid class="absolute top-3 left-3" />

			<!-- Corner menu (top right HUD) -->
			<CornerMenu @open-avatar="showAvatarMaker = true" @open-settings="ui.openPreferences()" @open-announcement="showAnnouncementModal = true" @open-metrics="showMetrics = true" @open-phone="showPhone = true" />

			<!-- Break room TV overlay -->
			<BreakRoomTV />

			<!-- Conference room meeting HUD -->
			<ConferenceHud v-if="currentRoom?.id === 'conference'" />

			<!-- Collaborative whiteboard overlay -->
			<WhiteboardOverlay v-if="showWhiteboard" :key="whiteboardDocId || `wb-${whiteboardRoomId}`" :doc-id="whiteboardDocId || `wb-${whiteboardRoomId}`" :room-id="whiteboardRoomId" @close="showWhiteboard = false; whiteboardDocId = ''" />

			<!-- Collaborative doc overlay -->
			<CollabDocOverlay v-if="showCollabDoc" :key="collabDocId || `dc-${collabDocRoomId}`" :doc-id="collabDocId || `dc-${collabDocRoomId}`" :room-id="collabDocRoomId" @close="handleDocOverlayClose" />

			<!-- Task board overlay -->
			<TaskBoardOverlay v-if="showTaskBoard" :key="taskBoardDocId || `tb-${taskBoardRoomId}`" :doc-id="taskBoardDocId || `tb-${taskBoardRoomId}`" :room-id="taskBoardRoomId" @close="handleTaskBoardClose" />

			<!-- Phone overlay (Mail / Calendar / Whiteboards / Docs / Tasks from anywhere) -->
			<PhoneOverlay v-if="showPhone" @close="showPhone = false" />

			<!-- Office app shelf (bottom, only in my office) -->
			<Transition name="shelf-slide">
				<OfficeShelf v-if="isMyOffice" />
			</Transition>

			<!-- Standalone board history modal (accessible without opening whiteboard) -->
			<Transition name="fade">
				<div v-if="showBoardHistory && !showWhiteboard" class="board-history-modal-backdrop" @click.self="showBoardHistory = false">
					<div class="board-history-modal">
						<WhiteboardHistory :boards="boardHistoryItems" :loading="boardHistoryLoading" @open="openArchivedBoard" @close="showBoardHistory = false" />
					</div>
				</div>
			</Transition>

			<!-- Standalone doc history modal -->
			<Transition name="fade">
				<div v-if="showDocHistory && !showCollabDoc" class="board-history-modal-backdrop" @click.self="showDocHistory = false">
					<div class="board-history-modal">
						<CollabDocHistory :docs="docHistoryItems" :loading="docHistoryLoading" @open="openArchivedDoc" @close="showDocHistory = false" />
					</div>
				</div>
			</Transition>

			<!-- Standalone task board history modal -->
			<Transition name="fade">
				<div v-if="showTaskBoardHistory && !showTaskBoard" class="board-history-modal-backdrop" @click.self="showTaskBoardHistory = false">
					<div class="board-history-modal">
						<TaskBoardHistory :boards="taskBoardHistoryItems" :loading="taskBoardHistoryLoading" @open="openArchivedTaskBoard" @close="showTaskBoardHistory = false" />
					</div>
				</div>
			</Transition>

			<!-- Room collaboration toolbar (top-center): whiteboard / doc / task board -->
			<Transition name="fade">
				<RoomCollabBar v-if="(roomHasWhiteboard || roomHasCollabDoc || roomHasTaskBoard) && !showWhiteboard && !showCollabDoc && !showTaskBoard" :room-id="officeStore.currentRoomId" :has-whiteboard="roomHasWhiteboard" :has-collab-doc="roomHasCollabDoc" :has-task-board="roomHasTaskBoard" class="room-collab-bar-anchor" @open-whiteboard="whiteboardRoomId = officeStore.currentRoomId; whiteboardDocId = ''; showWhiteboard = true" @open-whiteboard-history="openBoardHistory" @open-doc="openCollabDoc()" @open-doc-history="openDocHistory" @open-taskboard="openTaskBoard()" @open-taskboard-history="openTaskBoardHistory" />
			</Transition>

			<!-- Reactions: floating bubble stream + bottom-right tray -->
			<ReactionStream />
			<ReactionTray class="reaction-tray-anchor" />

			<!-- Proximity voice bar (bottom) -->
			<ProximityVoiceBar />
		</div>

		<!-- User interaction popup -->
		<UserPopup />

		<!-- Emote radial menu (hold E) -->
		<EmoteRadialMenu />

		<!-- Kudos wall flyout (opens from break-room plaque) -->
		<KudosFlyout />

		<!-- Dog command popup -->
		<DogPopup />

		<!-- Update banner -->
		<Transition name="toast">
			<div v-if="updateAvailable" class="update-banner">
				<span>quickerSTORM has been updated.</span>
				<button class="update-reload" @click="reloadPage">Please reload</button>
			</div>
		</Transition>

		<!-- Rate-limit banner -->
		<Transition name="toast">
			<div v-if="showRateLimit" class="update-banner rate-limit-banner">
				<!-- Note: this banner can perfectly cover the 'updated' build update-banner above, whenever both are shown. Could add a mt-7, but seems reasonable to only show them a single msg. if they need to reload -->
				<span>{{ rateLimitMsg }}</span>
				<button class="update-reload" @click="reloadPage">Reload</button>
				<button class="rate-limit-dismiss" @click="showRateLimit = false" title="Dismiss">✕</button>
			</div>
		</Transition>

		<!-- Toast notifications -->
		<Transition name="toast">
			<div v-if="toast" class="ava-toast" :class="`ava-toast--${toast.type || 'info'}`">
				{{ toast.message }}
			</div>
		</Transition>

		<!-- Email notification toast (persistent until dismissed) -->
		<Transition name="toast">
			<div v-if="emailToast" class="ava-toast ava-toast--email" @click="dismissEmailToast">
				<span class="ava-toast-msg">{{ emailToast.message }}</span>
				<button class="ava-toast-dismiss" @click.stop="dismissEmailToast">&times;</button>
			</div>
		</Transition>

		<!-- Avatar maker modal — root is <Teleport>, which <Transition> can't animate. -->
		<AvatarMaker v-if="showAvatarMaker" @close="showAvatarMaker = false" @done="onAvatarDone" />

		<!-- Preferences rendered in App.vue via ui.showPreferences / Ctrl+P -->

		<!-- Announcement sender modal -->
		<Transition name="modal">
			<AnnouncementModal v-if="showAnnouncementModal" @close="showAnnouncementModal = false" />
		</Transition>

		<!-- Magazine / reading modal -->
		<Transition name="modal">
			<MagazineModal v-if="showMagazine" :url="magazineUrl" @close="showMagazine = false" />
		</Transition>

		<!-- quickerSTORM metrics modal — root is <Teleport>, which <Transition> can't animate. -->
		<MetricsView v-if="showMetrics" @close="showMetrics = false" />

		<!-- Suggestion box modal — root is <Teleport>, which <Transition> can't animate. -->
		<SuggestionBoxModal v-if="showSuggestionBox" @close="showSuggestionBox = false" />

		<!-- Arcade modals — root is <Teleport>, which <Transition> can't animate. -->
		<ArcadeSnakeModal v-if="showArcade" @close="showArcade = false" />
		<ArcadePacmanModal v-if="showArcadePacman" @close="showArcadePacman = false" />
		<KeepAlive><ArcadeCentipedeModal v-if="showArcadeCentipede" @close="showArcadeCentipede = false" /></KeepAlive>
		<Connect4Modal v-if="showConnect4" @close="showConnect4 = false" />

		<!-- Computer screen — personal office monitor click -->
		<ComputerScreen v-if="showComputer" @close="showComputer = false" />

		<!-- Session displaced: another device logged in with this account -->
		<SessionDisplacedModal v-if="isDisplaced" />

		<!-- Activity paused: 2 h idle, WS disconnected -->
		<ActivityPausedModal v-if="isPaused && !isDisplaced" />

		<!-- Ticket pulled modal -->
		<TicketModal v-if="showTicket && myTicket" :ticket-number="myTicket" :now-serving="nowServing" @close="showTicket = false" />
	</div>
</template>

<style scoped>
/* Room label HUD */
.room-hud {
	position: absolute;
	top: 3.75rem;
	left: 50%;
	transform: translateX(-50%);
	pointer-events: none;
	user-select: none;
	z-index: 20;
}

.room-hud-text {
	background-color: rgba(240, 155, 76, 0.85) !important;
	border: 2px solid var(--color-brd);
	border-radius: 1.25rem;
	color: var(--color-side);
	font-size: clamp(0.75rem, 0.75vw, 1.125rem);
	font-weight: 600;
	letter-spacing: 0.08em;
	padding: 0.3125rem 1rem;
	backdrop-filter: blur(8px);
	text-transform: uppercase;
	transition: color 0.2s;
	white-space: nowrap;
}

.room-hud-text.transitioning {
	color: var(--color-accent3);
}

/* Animated ellipsis — three dots that fill in sequentially */
.room-hud-ellipsis::after {
	content: ' .';
	animation: hud-dots 1.2s steps(1, end) infinite;
}

@keyframes hud-dots {
	0% {
		content: ' ·';
	}

	33% {
		content: ' ··';
	}

	66% {
		content: ' ···';
	}

	100% {
		content: ' ·';
	}
}


/* Update banner */
.update-banner {
	position: fixed;
	top: 7rem;
	left: calc(50% + var(--canvas-left) / 2);
	display: flex;
	align-items: center;
	gap: 0.75rem;
	background: rgba(0, 140, 200, 0.92);
	border: 1px solid rgba(255, 255, 255, 0.18);
	border-radius: 2rem;
	padding: 0.5rem 1rem 0.5rem 1.25rem;
	font-size: 0.875rem;
	font-weight: 600;
	color: #fff;
	transform: translateX(-50%);
	z-index: 999;
	backdrop-filter: blur(8px);
	white-space: nowrap;
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.update-reload {
	background: rgba(255, 255, 255, 0.2);
	border: 1px solid rgba(255, 255, 255, 0.35);
	border-radius: 1rem;
	padding: 0.25rem 0.875rem;
	font-size: 0.8125rem;
	font-weight: 700;
	color: #fff;
	cursor: pointer;
	transition: background 0.15s;
}

.update-reload:hover {
	background: rgba(255, 255, 255, 0.35);
}

.rate-limit-banner {
	background: rgba(140, 80, 0, 0.92);
}

.rate-limit-dismiss {
	background: none;
	border: none;
	color: rgba(255, 255, 255, 0.7);
	font-size: 0.875rem;
	cursor: pointer;
	padding: 0.125rem 0.25rem;
	line-height: 1;
}



/* Transition vignette (darkens edges during room change) */
.transition-vignette {
	position: absolute;
	inset: 0;
	background: radial-gradient(ellipse at center, transparent 30%, rgba(4, 8, 14, 0.85) 100%);
	pointer-events: none;
	z-index: 15;
	animation: vignette-in 1.8s ease-in-out;
}

@keyframes vignette-in {
	0% {
		opacity: 0;
	}

	20% {
		opacity: 1;
	}

	80% {
		opacity: 1;
	}

	100% {
		opacity: 0;
	}
}

.shelf-slide-enter-active {
	transition: opacity 0.3s, transform 0.3s;
}

.shelf-slide-leave-active {
	transition: opacity 0.2s, transform 0.2s;
}

.shelf-slide-enter-from,
.shelf-slide-leave-to {
	opacity: 0;
	transform: translateY(100%);
}

/* Toast */
.ava-toast {
	position: fixed;
	bottom: 11rem;
	left: calc(50% + var(--canvas-left) / 2);
	border-radius: 2rem;
	padding: 0.625rem 1.5rem;
	font-size: clamp(0.9375rem, 1vw, 1.0625rem);
	font-weight: 600;
	pointer-events: none;
	white-space: nowrap;
	transform: translateX(-50%);
	z-index: 950;
	backdrop-filter: blur(10px);
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.ava-toast--success {
	background: rgba(20, 60, 30, 0.92);
	border: 1px solid rgba(100, 220, 130, 0.35);
	color: #7effa0;
}

.ava-toast--warn {
	background: rgba(180, 70, 0, 0.92);
	border: 1px solid rgba(255, 255, 255, 0.2);
	color: #fff;
}

.ava-toast--info {
	background: rgba(20, 35, 60, 0.95);
	border: 1px solid rgba(100, 160, 255, 0.25);
	color: #d0e8ff;
}

.ava-toast--email {
	background: rgba(20, 35, 60, 0.95);
	border: 1px solid rgba(100, 160, 255, 0.25);
	color: #d0e8ff;
	pointer-events: auto;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 12px;
	padding-right: 0.75rem;
}

.ava-toast-msg {
	flex: 1;
}

.ava-toast-dismiss {
	background: none;
	border: none;
	color: rgba(255, 255, 255, 0.5);
	font-size: 18px;
	cursor: pointer;
	padding: 0 4px;
	line-height: 1;
}

.ava-toast-dismiss:hover {
	color: #fff;
}

.toast-enter-active {
	transition: opacity 0.2s, transform 0.2s;
}

.toast-leave-active {
	transition: opacity 0.3s, transform 0.3s;
}

.toast-enter-from,
.toast-leave-to {
	opacity: 0;
	transform: translateX(-50%) translateY(0.5rem);
}

.room-collab-bar-anchor {
	position: absolute;
	top: 0.75rem;
	left: 50%;
	transform: translateX(-50%);
	z-index: 60;/* Gene raised this above .rm-labels, under .corner-hud/hud-btns */
}

.reaction-tray-anchor {
	position: absolute;
	bottom: calc(3.25rem + 0.75rem);
	right: 0.75rem;
	z-index: 28;
}

.board-history-modal-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(15, 23, 42, 0.5);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 600;
}

.board-history-modal {
	width: 360px;
	height: 480px;
	border-radius: 12px;
	overflow: hidden;
	box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}
</style>

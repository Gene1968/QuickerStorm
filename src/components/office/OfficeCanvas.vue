<script setup>
/**
 * OfficeCanvas — mounts the Three.js engine into a full-screen div.
 * Provides the public engine API to OfficeView via expose().
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useOfficeEngine } from '@/composables/useOfficeEngine.js'
import { talkingPeers } from '@/composables/useProximityVoice.js'
import { useOfficeStore } from '@/stores/officeStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { OFFICES } from '@/config/officeLayout.js'
import { stripDuplicateOfficeDeskOccupants } from '@/utils/officeDeskDeduplication.js'
import { useGoogleCalendar } from '@/composables/useGoogleCalendar.js'
import { useProjectorScreen } from '@/composables/useProjectorScreen.js'
import { useJitsiMeet } from '@/composables/useJitsiMeet.js'
import { useGmailNotify } from '@/composables/useGmailNotify.js'
import { startPoseSync, stopPoseSync, registerPeerPoseHandler, registerFridgeHandler } from '@/composables/usePoseSync.js'
import { useDeliveryBots } from '@/composables/useDeliveryBots.js'
// Door states now sync via the door_states Supabase table (see usePresence.js)

const officeStore   = useOfficeStore()
const presenceStore = usePresenceStore()
const avatarStore   = useAvatarStore()

const wrapperRef = ref(null)
const engine = useOfficeEngine()
const tooltipX = ref(0)
const tooltipY = ref(0)

function onWrapperMouseMove (e) {
	tooltipX.value = e.clientX
	tooltipY.value = e.clientY
}

onMounted(() => {
	if (!wrapperRef.value) return
	engine.init(wrapperRef.value)
	// Register engine in store so sidebar buttons can navigate
	officeStore.setEngine(engine)
	// If already in the conference room when the engine initialises, attach the
	// projector texture now (the roomId watch fires before init, so mesh is null then).
	if (officeStore.currentRoomId === 'conference' && engine.projectorScreenMesh) {
		projector.applyToMesh(engine.projectorScreenMesh)
		_drawConference()
	}
	// Same for own office
	const myOffice = officeStore.myCurrentOfficeId
	if (myOffice && officeStore.currentRoomId === myOffice) {
		const mesh = engine.officeScreenMeshes?.get(myOffice)
		if (mesh) { officeScreen.applyToMesh(mesh); _drawOffice() }
	}

	registerFridgeHandler((side, action) => engine.applyFridgeDoor(side, action))

	useDeliveryBots().start(engine)

	// Real-time pose relay (Supabase broadcast). When `joinRoomChannel` is absent this no-ops.
	// Peers' broadcasts land here — apply directly to their avatar group so we
	// don't wait for the next presence refetch to see movement.
	registerPeerPoseHandler((peerId, x, z, rotation, state) => {
		const peer = presenceStore.users.find((u) => String(u.id) === String(peerId))
		const storeSeatId = peer?.seatId || null
		// Engine's lastSeatId is set the moment the avatar is placed in a seat
		// (spawnAvatar / moveAvatarToRoom). The store's seatId only arrives after the
		// room event which has a 400 ms debounce — so a pose event that races ahead of
		// the room event would see storeSeatId=null and move the avatar to stale walk
		// coords, causing the peer to appear at the wrong location (or "mid-air").
		// Using the engine value as a fallback closes that window.
		const engineSeatId = engine.avatarGroups?.get(peerId)?.userData?.lastSeatId || null
		const seatId = storeSeatId || engineSeatId
		// Mirror into the store — but do not overwrite PosX/Z while seated: the relay
		// sends officeStore myPosX/Z which can still be doorway coords until the next
		// heartbeat, which made seated peers tween to the door while seatY flickered.
		const patch = { id: String(peerId) }
		if (!seatId) {
			patch.posX = x
			patch.posZ = z
		}
		if (typeof rotation === 'number' && !Number.isNaN(rotation)) patch.rotation = rotation
		if (state && typeof state === 'object') patch.avatarState = state
		presenceStore.upsertUser(patch)

		// Apply the visible bits directly too — the users watcher above only
		// fires on next tick, but movement/holding should land this frame.
		if (engine.avatarGroups?.has(peerId)) {
			const poseRoomId =
				seatId && seatId.includes(':')
					? seatId.slice(0, seatId.indexOf(':'))
					: (peer?.roomId || officeStore.currentRoomId)
			engine.moveAvatarToRoom(peerId, poseRoomId, seatId, {
				posX: seatId ? undefined : x,
				posZ: seatId ? undefined : z,
				rotation,
			})
			if (state && Object.keys(state).length) engine.applyAvatarState(peerId, state)
		}
		// Door states are now synced via the door_states table subscription in usePresence.
	})
	startPoseSync()

	// Re-spawn the local avatar when the engine is re-initialised (e.g. HMR hot reload).
	// On a normal first load OfficeView.onMounted handles this; on HMR only OfficeCanvas
	// re-mounts so OfficeView.onMounted never re-fires.
	if (avatarStore.isSetupDone && avatarStore.displayName) {
		const myId = String(presenceStore.myUserId || avatarStore.authUserId || 'me')
		engine.setMyUserId(myId)
		engine.spawnAvatar({
			id:        myId,
			name:      avatarStore.displayName,
			color:     avatarStore.color,
			status:    avatarStore.status,
			roomId:    officeStore.currentRoomId || 'lobby',
			avatarUrl: avatarStore.avatarUrl,
		})
	}
})

// ── Google Calendar → screens ────────────────────────────────────────
const calendar     = useGoogleCalendar()
const projector    = useProjectorScreen()   // conference room
const officeScreen = useProjectorScreen()   // personal office wall
const jitsi        = useJitsiMeet()

// Start polling immediately (toasts fire from any room)
calendar.startPolling()
const gmailNotify = useGmailNotify()
gmailNotify.startPolling()

// Conference room projector
watch(() => officeStore.currentRoomId, (roomId) => {
	if (roomId === 'conference') {
		if (engine.projectorScreenMesh) {
			projector.applyToMesh(engine.projectorScreenMesh)
			_drawConference()
		}
	} else {
		projector.detachFromMesh()
	}
}, { immediate: true })

// Personal office wall screen — only when in your own office
watch(
	[() => officeStore.currentRoomId, () => officeStore.myCurrentOfficeId],
	([roomId, myOfficeId]) => {
		if (myOfficeId && roomId === myOfficeId) {
			const mesh = engine.officeScreenMeshes?.get(myOfficeId)
			if (mesh) {
				officeScreen.applyToMesh(mesh)
				_drawOffice()
			}
		} else {
			officeScreen.detachFromMesh()
		}
	},
	{ immediate: true },
)

watch(
	[calendar.currentEvent, calendar.nextEvent, calendar.isAuthed],
	() => { _drawConference(); _drawOffice() },
)

watch(
	[jitsi.isActive, jitsi.participantCount],
	() => { _drawConference() },
)

function _drawConference() {
	if (officeStore.currentRoomId !== 'conference') return
	if (engine.projectorScreenMesh && !engine.projectorScreenMesh.material.map) {
		projector.applyToMesh(engine.projectorScreenMesh)
	}
	projector.draw({
		currentEvent:      calendar.currentEvent.value,
		nextEvent:         calendar.nextEvent.value,
		isAuthed:          calendar.isAuthed.value,
		jitsiActive:       jitsi.isActive.value,
		jitsiParticipants: jitsi.participantCount.value,
	})
}

function _drawOffice() {
	const myOfficeId = officeStore.myCurrentOfficeId
	if (!myOfficeId || officeStore.currentRoomId !== myOfficeId) return
	officeScreen.drawOffice({
		events:       calendar.events.value,
		currentEvent: calendar.currentEvent.value,
		nextEvent:    calendar.nextEvent.value,
		isAuthed:     calendar.isAuthed.value,
	})
}

// ── End screens ───────────────────────────────────────────────────────

// Once the list-item ID arrives from presenceStore, sync it to the engine and
// re-key the avatar so room.userId comparisons (isVisit check) use the same ID.
const myEngineId = computed(() => presenceStore.myUserId || String(avatarStore.authUserId || 'me'))

/** Move the local avatar Map entry from a placeholder key to the presence row id (staging / Supabase UUID). */
function _rekeyLocalAvatarIfNeeded (canonicalId) {
	if (!canonicalId || !engine.avatarGroups) return
	const canon = String(canonicalId)
	const candidates = ['me', avatarStore.authUserId ? String(avatarStore.authUserId) : null].filter(Boolean)
	for (const oldId of candidates) {
		if (oldId === canon || !engine.avatarGroups.has(oldId)) continue
		if (engine.avatarGroups.has(canon)) {
			// Prefer the OfficeView-spawned mesh over a duplicate created when myUserId was still null.
			engine.removeAvatar(canon)
		}
		const g = engine.avatarGroups.get(oldId)
		engine.avatarGroups.delete(oldId)
		engine.avatarGroups.set(canon, g)
		g.name = `avatar-${canon}`
	}
}

watch(() => presenceStore.myUserId, (listItemId) => {
	if (!listItemId || !engine.avatarGroups) return
	const oldId = String(avatarStore.authUserId || 'me')
	// Sync engine — isVisit = room.userId !== engine.myUserId; both are now list-item IDs
	engine.setMyUserId(listItemId)
	// Re-key the avatar group so the engine can find it by the new ID
	if (oldId !== listItemId && engine.avatarGroups.has(oldId)) {
		// If a spurious presence-watcher avatar was already spawned at listItemId, remove it
		// from the scene before overwriting the Map entry with our real local avatar.
		if (engine.avatarGroups.has(listItemId)) engine.removeAvatar(listItemId)
		const g = engine.avatarGroups.get(oldId)
		engine.avatarGroups.delete(oldId)
		engine.avatarGroups.set(listItemId, g)
		g.name = `avatar-${listItemId}`
	}
	// Supabase: authUserId is often null — still migrate `me` → UUID so cleanup never prunes us.
	_rekeyLocalAvatarIfNeeded(listItemId)
}, { immediate: true })

/**
 * Keep the local user's mesh aligned with their own presence row (seat + durable pose),
 * same inputs peers use — OfficeView only spawns appearance; it does not refetch seat/pose.
 */
function syncLocalAvatarFromPresence (users, deskStrips) {
	if (!avatarStore.displayName || !engine.avatarGroups) return
	const myId = presenceStore.myUserId
	if (!myId) return

	_rekeyLocalAvatarIfNeeded(String(myId))

	const me = users.find((u) => String(u.id) === String(myId))
	if (!me || me.status === 'offline') return

	const engineKey = String(myId)
	const stripDesk = deskStrips?.has(String(myId))
	// Prefer LOCAL seat state over `me.seatId` from the DB. The DB row trails
	// the heartbeat debounce (~2 s after leaving a chair), and during that
	// window `presenceStore.updateMyRoom` / any poll-driven re-setUsers re-fires
	// this watcher with the stale desk seat still on `me` — the engine would
	// then try to seat us at that desk in the new room, fail the lookup, and
	// fall through to a random `clearRoomPos` spot (the "middle of the office
	// area" teleport), then snap us back to the original desk on the next
	// echo. `presenceStore.mySeatId` is updated synchronously at every
	// sit/stand/navigate, so it's the authoritative local source of truth.
	const effectiveSeat = stripDesk
		? null
		: (presenceStore.mySeatId || officeStore.currentSeatId || null)
	const hasDbPose = me.posX != null && me.posZ != null

	const userPayload = {
		...me,
		id:        engineKey,
		name:      avatarStore.displayName || me.name,
		color:     avatarStore.color || me.color,
		status:    avatarStore.status || me.status,
		avatarUrl: avatarStore.avatarUrl ?? me.avatarUrl,
	}

	engine.setMyUserId(engineKey)
	engine.spawnAvatar(userPayload)
	if (userPayload.avatarUrl?.endsWith('.glb')) {
		engine.loadGLTFAvatar(engineKey, userPayload.avatarUrl)
	}

	if (effectiveSeat) {
		// Derive room from the seat ID prefix (e.g. 'conference' from 'conference:3').
		// me.roomId comes from the DB and can lag the heartbeat write by several seconds;
		// using a stale 'lobby' value here makes moveAvatarToRoom look up the seat in the
		// wrong room, fail, and place the avatar standing in the lobby instead.
		const seatRoomId = effectiveSeat.includes(':')
			? effectiveSeat.slice(0, effectiveSeat.indexOf(':'))
			: me.roomId
		// Local seat updates synchronously on click; `me.seatId` / Rotation trail the
		// heartbeat. Applying the old row's rotation after a seat change kept the
		// previous chair's heading — omit rotation until the DB seat matches us.
		const dbSeatId = me.seatId
		const useDbRotationForSeat =
			dbSeatId && String(dbSeatId) === String(effectiveSeat)
		// Seated rotation (local user): when the presence row's seat matches our local
		// seat, `me.rotation` is the durable value we save to the backend. Prefer it
		// over `officeStore.myRotation` — after reload, `setCurrentRoom` / init can leave
		// `myRotation` at 0 while `hasLocalPose` is already true, which used to overwrite
		// conference / lobby headings. When the row's seat still trails our local sit,
		// `useDbRotationForSeat` is false → pass null so claimSeat / seat default wins
		// until the heartbeat matches (avoids stale heading from the previous chair).
		const rotationForSeat = !useDbRotationForSeat
			? null
			: (typeof me.rotation === 'number' && !Number.isNaN(me.rotation)
				? me.rotation
				: officeStore.myRotation)
		officeStore.setCurrentRoom(seatRoomId)
		engine.moveAvatarToRoom(engineKey, seatRoomId, effectiveSeat, {
			posX:     me.posX,
			posZ:     me.posZ,
			rotation: rotationForSeat,
		})
		// Keep currentSeatId in sync with the visual state. Without this,
		// the avatar appears seated (seatY < 0) but currentSeatId is null —
		// hiding the ", seated" label and letting WASD/nav work while seated.
		if (!officeStore.currentSeatId) {
			officeStore.setCurrentSeat(effectiveSeat)
		}
	} else if (
		hasDbPose &&
		me.roomId === officeStore.currentRoomId &&
		!engine.isLocalMovementActive?.() &&
		!officeStore.hasLocalPose
	) {
		// DB pose is only authoritative until the engine has written its own via
		// setMyPose — after that the DB trails the 3 s pose-write debounce, and
		// a postgres_changes echo (or any peer broadcast that re-fires this deep
		// watcher) would otherwise tween the avatar back to stale pre-walk coords.
		// Applies on first spawn / session restore and after room changes (flag
		// resets in officeStore.setCurrentRoom), then stops once the engine lands.
		engine.moveAvatarToRoom(engineKey, me.roomId, null, {
			posX:     me.posX,
			posZ:     me.posZ,
			rotation: me.rotation,
		})
	}

	// Use local myAvatarState (always current) rather than me.avatarState from the DB,
	// which lags the heartbeat write and would wipe transient state like held items.
	engine.applyAvatarState(engineKey, officeStore.myAvatarState || me.avatarState || {})
}

// Sync presence users to 3D avatars.
// Peers are fully driven here; the local user is skipped in the loop then reconciled
// below so we never prune their placeholder key (`me`) and seat/pose match SharePoint/Supabase.
watch(
	() => presenceStore.users,
	(users) => {
		const myId = presenceStore.myUserId
		// myEngineId covers both the list-item ID (after presence loads) and the
		// authUserId fallback (before it loads), so we never mistake our own
		// avatar for a peer's and never accidentally clean it up.
		const myKey = myEngineId.value
		const myShare = avatarStore.authUserId ? String(avatarStore.authUserId) : null
		const activeIds  = new Set()
		const deskStrips = stripDuplicateOfficeDeskOccupants(users)

		for (const user of users) {
			// Skip own user — our avatar is managed by OfficeView.vue.
			// Three-layer guard:
			//  1. list-item ID (definitive once presence resolves)
			//  2. engine key (covers authUserId fallback before presence resolves)
			//  3. avatar group name (catches the re-keying window where key ≠ listItemId
			//     but the group in the scene is already named for this user)
			if (myId && user.id === myId) continue
			if (user.id === myKey)        continue
			if (engine.avatarGroups?.get(user.id)?.name === `avatar-${myKey}`) continue

			if (user.status === 'offline') {
				// Remove avatar+label if still in scene
				if (engine.avatarGroups?.has(user.id)) engine.removeAvatar(user.id)
				continue  // don't add to activeIds
			}

			// Skip users whose position has never been set by a running engine:
			//  • posX === null  → our heartbeat guard means the engine never wrote coords
			//  • away + 0,0 in lobby → store-default coordinates, engine hasn't placed them yet
			// Both cases cause all affected users to visually stack at lobby origin.
			// They still appear in the sidebar; once their tab is active the engine
			// writes real coords and their avatar spawns at the correct spot.
			// Seated users have an exact named position via seatId — never hide them for missing coords.
			const noPosition   = user.posX == null && user.posZ == null && !user.seatId
			const atDefaultPos = user.status === 'away' && user.posX === 0 && user.posZ === 0 && user.roomId === 'lobby'
			if (noPosition || atDefaultPos) {
				if (engine.avatarGroups?.has(user.id)) engine.removeAvatar(user.id)
				continue
			}

			activeIds.add(user.id)

			const userForDesk = deskStrips.has(String(user.id))
				? { ...user, seatId: null }
				: user

			if (engine.avatarGroups?.has(user.id)) {
				// spawnAvatar handles both cases: rebuilds the mesh if avatarUrl/color
				// changed (e.g. after AvatarMaker save), otherwise just updates the label.
				engine.spawnAvatar(userForDesk)
				// Pass stored pose so standing avatars tween to actual position, not a random spot
				engine.moveAvatarToRoom(user.id, user.roomId, userForDesk.seatId || null, {
								posX:     user.posX,
								posZ:     user.posZ,
								rotation: user.rotation,
				})
				engine.applyAvatarState(user.id, user.avatarState)
			} else {
				engine.spawnAvatar(userForDesk)
				engine.moveAvatarToRoom(user.id, user.roomId, userForDesk.seatId || null, {
								posX:     user.posX,
								posZ:     user.posZ,
								rotation: user.rotation,
				})
				engine.applyAvatarState(user.id, user.avatarState)
				if (user.avatarUrl?.endsWith('.glb')) engine.loadGLTFAvatar(user.id, user.avatarUrl)
			}
		}

		// Remove avatars for users who have dropped off the list entirely.
		// Snapshot keys first so Map mutation inside removeAvatar doesn't affect iteration.
		// Protect the local user by BOTH key AND group name — the avatar may still be
		// stored under the old authUserId key if re-keying hasn't fired yet, so a
		// key-only check would accidentally prune it. On Supabase, `authUserId` is often
		// null and the first spawn uses `me` — protect that too until `_rekeyLocalAvatarIfNeeded` runs.
		if (engine.avatarGroups) {
			const myNames = new Set(
				[myId && `avatar-${myId}`, myKey && `avatar-${myKey}`, myShare && `avatar-${myShare}`, 'avatar-me'].filter(Boolean),
			)
			const protectedIds = new Set([myId, myKey, myShare, 'me'].filter(Boolean))
			for (const id of [...engine.avatarGroups.keys()]) {
				if (protectedIds.has(id)) continue
				const grp = engine.avatarGroups.get(id)
				if (grp && myNames.has(grp.name)) continue  // stale key but still our avatar
				if (!activeIds.has(id)) engine.removeAvatar(id)
			}
		}

		syncLocalAvatarFromPresence(users, deskStrips)

		// Update office door labels — any online user (including current user) whose roomId matches
		for (const office of OFFICES) {
			const occupant = users.find(u => u.roomId === office.id && u.status !== 'offline')
			engine.updateDoorLabel(office.id, occupant?.name || '')
		}
	},
	{ deep: true },
)

// After a room transition, read the avatar's actual landing position and
// write it to officeStore so the next heartbeat broadcasts correct coords.
// Waits 1.4 s — longer than the longest transition animation (≤1.2 s).
watch(() => officeStore.currentRoomId, () => {
	setTimeout(() => {
		if (officeStore.currentSeatId) return   // seated: seatId is authoritative
		const myId = presenceStore.myUserId || myEngineId.value
		const g    = engine.avatarGroups?.get(myId)
		if (g) officeStore.setMyPose(g.position.x, g.position.z, g.rotation.y)
	}, 1400)
})

// Keep local user's 3D label status dot + slack emoji in sync with avatarStore.
// The users watcher skips the local user, so we need a dedicated watcher here.
watch(() => [avatarStore.status, avatarStore.slackStatus], ([status, slackStatus]) => {
	const myId = presenceStore.myUserId || myEngineId.value
	if (!myId) return
	engine.updateAvatarLabel(myId, {
		id:   myId,
		name: avatarStore.displayName,
		status,
		slackStatus,
	})
})

// Drive avatar talking rings from signaling server events
let prevTalking = new Set()
watch(talkingPeers, (current) => {
	// Newly talking
	for (const id of current) {
		if (!prevTalking.has(id)) engine.setAvatarTalking(id, true)
	}
	// Stopped talking
	for (const id of prevTalking) {
		if (!current.has(id)) engine.setAvatarTalking(id, false)
	}
	prevTalking = new Set(current)
})

onUnmounted(() => {
	stopPoseSync()
	calendar.stopPolling()
	useDeliveryBots().stop()
	engine.dispose()
})

defineExpose({ engine })
</script>

<template>
	<div ref="wrapperRef" class="office-canvas-wrapper" @mousemove="onWrapperMouseMove">
		<Teleport to="body">
			<div
				v-if="engine.hoverLabel?.value"
				class="ava-hover-tooltip"
				:style="{ left: `${tooltipX + 14}px`, top: `${tooltipY + 20}px` }"
			>{{ engine.hoverLabel.value }}</div>
		</Teleport>
	</div>
</template>

<style scoped>
.office-canvas-wrapper {
	width: 100%;
	height: 100%;
	position: relative;
	overflow: hidden;
}
</style>

<style>
.ava-hover-tooltip {
	position: fixed;
	background: rgba(0, 0, 0, 0.75);
	border-radius: 4px;
	padding: 0.25rem 0.5rem;
	font-size: 0.75rem;
	color: #fff;
	white-space: nowrap;
	pointer-events: none;
	user-select: none;
	z-index: 500;
}
</style>

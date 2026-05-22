/**
 * usePresence — syncs the quickerSTORM users / presence dataset for all peers and
 * the current user via PresenceRepo (Supabase).
 *
 * Data path:
 *   - PresenceRepo.subscribe() delivers every row change via Postgres Realtime,
 *     which triggers fetchPresence() a few ms later (debounced in the repo).
 *   - fetchPresence() is the authoritative refresh — all locally-derived state
 *     (presenceStore.users, my own row id) is rebuilt from its result.
 *   - The wall-clock POLL_INTERVAL is a safety net for marking peers offline
 *     when their heartbeats stop; without it, a peer who hard-crashes would
 *     never leave the list.
 *   - HEARTBEAT_INTERVAL is how often THIS client pushes its own row.
 *
 * Note: `avatarStore.authUserId` is the Supabase auth UUID — it is NOT the
 * presence row id. `myListItemId` tracks the presence row id (also a UUID,
 * but distinct from the auth id).
 *
 * Field contract (surfaced as PascalCase by the repo for legacy call sites):
 *   Title, Email, AvaEmail, SlackId, RoomId ("roomId" or "roomId:seatId"),
 *   AvatarColor, AvatarUrl, Status, LastSeen, SlackStatus, JobTitle,
 *   Preferences (JSON), PosX, PosZ, Rotation, AvatarState (JSON),
 *   GreetingTarget, PendingInvite (JSON).
 */
import { ref, watch, onUnmounted } from 'vue'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useOfficeStore } from '@/stores/officeStore.js'
import { useUserStore } from '@/stores/userStore.js'
import { useTheme } from '@/composables/useTheme.js'
import { isAllAudioMuted } from '@/composables/useAudio.js'
import { syncPinnedAppsFromStorage } from '@/composables/usePinnedApps.js'
import { useClientStats } from '@/composables/useClientStats.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { PresenceRepo, DoorStateRepo } from '@/api/backend.js'
import { ALL_ROOMS } from '@/config/officeLayout.js'

const HEARTBEAT_INTERVAL = 12_000  // used for grace window calculation
const LS_KEY = 'ava_presence_item_id_sb'

// ── Multi-device session arbitration ────────────────────────────────────────
// Each browser tab gets a unique session ID (sessionStorage persists across
// page refreshes in the same tab but is fresh for every new tab/window).
// When a user opens quickerSTORM on a second device, that device writes its session
// ID into the presence row. The previous device detects the mismatch and pauses.
const MY_SESSION_ID = (() => {
	const key = 'ava_session_id'
	let id = sessionStorage.getItem(key)
	if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id) }
	return id
})()

/** True while this tab has been displaced by a newer login on another device. */
export const isDisplaced = ref(false)

/** True while this tab is intentionally paused after 2 h of inactivity. */
export const isPaused = ref(false)

// Grace window: skip displacement checks until we've written our first heartbeat
// (so the new device doesn't displace itself on startup before claiming the row).
// Also used after reclaim to suppress re-displacement during the claim write.
let _displaceGraceUntil = Date.now() + HEARTBEAT_INTERVAL * 1.5

/** Last sessionId read from our presence row — blocks heartbeats after another device claims. */
let _serverSessionId = null

/**
 * Re-assert this tab as the active device. Called from SessionDisplacedModal.
 * Dispatches an event that the running usePresence instance picks up to send reclaim.
 */
export function reclaimSession () {
	_displaceGraceUntil = Date.now() + HEARTBEAT_INTERVAL
	_serverSessionId = null
	isDisplaced.value = false
	// Signal to the running composable instance to send the reclaim message
	window.dispatchEvent(new CustomEvent('ava-session-reclaim'))
}

// Written once per browser session when the user's presence row is first found.
// Merges this device's hardware snapshot into preferences.devices[deviceId] via RPC.
let _deviceMerged = false

// Reclaim payload queued when the WS is disconnected at reclaim time.
// Sent from the _open handler once the connection reopens.
let _pendingReclaim = null

// Module-level socket reference set by start() so pauseSession/resumeSession
// can disconnect/reconnect without needing a composable call.
let _moduleSocket = null

export function pauseSession () {
	isPaused.value = true
	_moduleSocket?.disconnect()
	window.dispatchEvent(new CustomEvent('ava-session-paused'))
}

export function resumeSession () {
	isPaused.value = false
	_moduleSocket?.connect()
	window.dispatchEvent(new CustomEvent('ava-session-resumed'))
}

// ── Greeting signalling (module-level so it survives re-mounts) ─────────────
// pendingGreeting: written to sender's own presence row; cleared after 20 s
let pendingGreeting = null       // { value: 'targetId:ts', expiry: ms }

// myListItemId is module-level so every usePresence() call (e.g. UserPopup)
// shares the same value that OfficeView's instance resolves via fetchPresence.
const myListItemId = ref(null)

// ── Door state sync (module-level) ──────────────────────────────────────────
// Authoritative door state from Supabase door_states table.
// Map<doorId, { isOpen: boolean, isLocked: boolean }>
const doorStates = new Map()

/**
 * Fetch all door states from Supabase and sync to the 3D engine.
 */
async function fetchDoorStates () {
	try {
		const updated = await DoorStateRepo.fetchAll()
		doorStates.clear()
		for (const [k, v] of updated) doorStates.set(k, v)
		// Push to 3D engine
		try {
			const engine = useOfficeStore().engineRef
			if (engine?.syncDoorStates) engine.syncDoorStates(doorStates)
		} catch { /* engine not ready */ }
	} catch (err) {
		console.warn('[presence] fetchDoorStates failed:', err.message)
	}
}

/**
 * Check if any door of a room is locked.
 * @param {string} roomId
 * @returns {boolean}
 */
export function isRoomLocked (roomId) {
	const room = ALL_ROOMS.find(r => r.id === roomId)
	if (!room?.doors?.length) return false
	return room.doors.some(d => {
		const state = doorStates.get(`${roomId}-${d.wall}`)
		return state && state.isLocked
	})
}

/**
 * Get the authoritative door states map (read-only access for the engine).
 */
export function getDoorStates () { return doorStates }

/** Reactive ref for the current user's pending call-here invite (set by a peer writing to this user's presence row). */
export const myPendingInvite = ref(null)

/**
 * Find the current user's presence row from a list of all rows.
 * On Supabase: tries auth_user_id first (exact UUID), then falls back to email-column
 * match only (no AvaEmail — prevents cross-account collision when multiple Google accounts
 * share the same AvaEmail). On SharePoint: matches by Email or AvaEmail.
 */
function _findMyRow (items, myAuthId, myEmail) {
	if (myAuthId) {
		const emailLc = myEmail?.toLowerCase()
		// Prefer rows where BOTH auth ID and email match — dev rows share auth_user_id
		// with the real account (same Supabase session) but have a @localhost email, so
		// this stops staging from claiming a dev row as its own and fighting over position.
		if (emailLc) {
			const byBoth = items.find(item =>
				item.AuthUserId === myAuthId && item.Email?.toLowerCase() === emailLc
			)
			if (byBoth) return byBoth
		}
		// Auth-only fallback — skip @localhost rows to prevent dev↔staging cross-contamination.
		const byAuth = items.find(item =>
			item.AuthUserId === myAuthId && !item.Email?.includes('@localhost')
		)
		if (byAuth) return byAuth
		// Legacy row: auth_user_id is null — strict email-column match only.
		if (emailLc) return items.find(item => item.Email?.toLowerCase() === emailLc) || null
		return null
	}
	if (myEmail) {
		return items.find(item =>
			item.Email?.toLowerCase() === myEmail.toLowerCase() ||
			item.AvaEmail?.toLowerCase() === myEmail.toLowerCase()
		) || null
	}
	return null
}

export function usePresence () {
	const presenceStore = usePresenceStore()
	const avatarStore = useAvatarStore()
	const officeStore = useOfficeStore()
	const userStore = useUserStore()

	const { isDark, setDark } = useTheme()
	const { clientStats } = useClientStats()

	let pollTimer = null
	let heartbeatTimer = null
	let _unsubscribeRealtime = null
	// Exponential backoff on repeated failures — prevents hammering the backend when it's
	// returning 429/503, and saves battery on flaky networks. Reset to 0 after any success.
	let heartbeatBackoffMs = 0
	const MAX_BACKOFF_MS = 60_000
	let lifecycleGen = 0
	// Per-instance running flag — guards the poll/heartbeat loops so that a different
	// caller's stop() (e.g. UserPopup unmounting) cannot kill OfficeView's loops via
	// the shared presenceStore.pollingActive flag.
	let running = false

	const isSupabase = true // backend is always Supabase now

	// ── localStorage cache helpers ───────────────────────────────────
	// On Supabase (non-dev), key by auth UUID so different Google accounts never share a cached
	// row ID. Dev mode uses email-based keys so the synthetic dev identity stays isolated.
	function _cacheKey () {
		const authId = isSupabase && !devSessionEmail() ? (userStore.user?.authUserId || null) : null
		return authId || null
	}

	function loadCachedId (email) {
		const authKey = _cacheKey()
		const lookupKey = authKey ?? email?.toLowerCase()
		if (!lookupKey) return null
		try {
			const stored = localStorage.getItem(LS_KEY)
			if (!stored) return null
			const map = JSON.parse(stored)
			return map[lookupKey] ?? null
		} catch { return null }
	}

	function saveCachedId (email, id) {
		const authKey = _cacheKey()
		const lookupKey = authKey ?? email?.toLowerCase()
		if (!lookupKey) return
		try {
			const stored = localStorage.getItem(LS_KEY)
			const map = stored ? JSON.parse(stored) : {}
			if (id == null) {
				delete map[lookupKey]
			} else {
				map[lookupKey] = id
			}
			localStorage.setItem(LS_KEY, JSON.stringify(map))
		} catch { /* ignore */ }
	}

	// ── Restore preferences from presence row (new device / fresh install) ─
	async function applyRemotePreferences (prefsJson) {
		if (avatarStore.isSetupDone) return   // local data already exists, trust it
		try {
			const prefs = typeof prefsJson === 'string' ? JSON.parse(prefsJson) : prefsJson
			if (!prefs || !prefs.displayName) return
			await avatarStore.completeSetup({
				displayName: prefs.displayName,
				title: prefs.title || '',
				color: prefs.color || '#00b4d8',
				skinTone: prefs.skinTone || '#C68642',
				hairColor: prefs.hairColor || '#3B2314',
				hairStyle: prefs.hairStyle || 'medium',
				avatarUrl: prefs.avatarUrl || null,
			})
			if (prefs.theme) setDark(prefs.theme === 'dark')
			// Restore pinned apps only if the browser has none saved yet
			if (Array.isArray(prefs.pinnedApps) && prefs.pinnedApps.length) {
				const existing = JSON.parse(localStorage.getItem('ava_pinned_apps') || '[]')
				if (!existing.length) {
					localStorage.setItem('ava_pinned_apps', JSON.stringify(prefs.pinnedApps))
					syncPinnedAppsFromStorage()
				}
			}
		} catch (err) {
			console.warn('[presence] failed to apply remote preferences:', err)
		}
	}

	// ── Device snapshot merge ────────────────────────────────────────
	// Called once per session when the user's row is first found.
	// Uses an atomic RPC so concurrent heartbeats from other devices cannot
	// clobber this entry, and this device cannot erase theirs.
	async function _mergeDeviceSnapshot () {
		try {
			await PresenceRepo.mergeDevice(clientStats.deviceId, {
				displayName: avatarStore.displayName || '',
				deviceLabel: clientStats.deviceLabel,
				browser:     clientStats.browser,
				os:          clientStats.os,
				perfTier:    clientStats.perfTier,
				mobile:      clientStats.mobile,
				screenW:     clientStats.screenW,
				screenH:     clientStats.screenH,
				dpr:         clientStats.dpr,
				cores:       clientStats.cores,
				ramGb:       clientStats.ramGb,
				gpuRenderer: clientStats.gpuRenderer,
				lastSeen:    new Date().toISOString(),
			})
		} catch (err) {
			console.warn('[presence] device snapshot merge failed:', err.message)
		}
	}

	// ── One-time identity resolution from Supabase ─────────────────
	// Reads the users table ONCE on startup to resolve myListItemId,
	// restore preferences, and merge device snapshot. Does NOT call
	// presenceStore.setUsers — the WS world/enter/leave handlers are
	// the sole authority for the live user list.
	async function fetchPresence () {
		if (isDisplaced.value) return
		const gen = lifecycleGen
		try {
			const items = await PresenceRepo.fetchAll()
			if (gen !== lifecycleGen) return

			const myEmail = myUserEmail()
			const myAuthId = isSupabase && !devSessionEmail() ? (userStore.user?.authUserId || null) : null

			// Resolve my own row
			const mineRaw = _findMyRow(items, myAuthId, myEmail)
			if (mineRaw) {
				if (!myListItemId.value) {
					myListItemId.value = mineRaw.Id
					saveCachedId(myEmail, myListItemId.value)
					const mySeatId = mineRaw.RoomId?.includes(':') ? mineRaw.RoomId : null
					presenceStore.setMySeatId(mySeatId)
				}
				if (!presenceStore.myUserId) {
					presenceStore.setMyUserId(String(mineRaw.Id))
				}

				const rowState = (!devSessionEmail() && mineRaw.AvatarState)
					? (() => { try { return JSON.parse(mineRaw.AvatarState) } catch { return {} } })()
					: {}
				if (!devSessionEmail()) {
					_serverSessionId = rowState.sessionId || null
				}

				if (!devSessionEmail() && !isDisplaced.value && Date.now() > _displaceGraceUntil) {
					if (rowState.sessionId && rowState.sessionId !== MY_SESSION_ID) {
						console.info('[presence] session claimed by another device — pausing this tab')
						isDisplaced.value = true
					}
				}
			}

			// Restore identity / preferences from my own row
			if (mineRaw && (myAuthId || myEmail)) {
				const needsAvaEmail = mineRaw.AvaEmail && !avatarStore.avaEmail
				const needsSlackId = mineRaw.SlackId && !avatarStore.slackId
				if (needsAvaEmail || needsSlackId) {
					await avatarStore.setSlackIdentity(
						needsSlackId ? mineRaw.SlackId : null,
						needsAvaEmail ? mineRaw.AvaEmail : null,
					)
				}

				if (mineRaw.Preferences) {
					await applyRemotePreferences(mineRaw.Preferences)
				}

				if (!_deviceMerged && myListItemId.value && !devSessionEmail()) {
					_deviceMerged = true
					_mergeDeviceSnapshot()
				}

				// Restore avatar state (e.g. coffee cup) from presence row on first load
				if (mineRaw.AvatarState && !officeStore.myAvatarState?.holding) {
					try {
						const savedState = JSON.parse(mineRaw.AvatarState)
						if (savedState?.holding === 'coffee' || savedState?.holding === 'water') {
							const elapsed = savedState.heldAt ? Date.now() - savedState.heldAt : Infinity
							if (elapsed >= 60 * 60 * 1000) {
								officeStore.setMyAvatarState({ holding: null, heldAt: null })
							} else {
								officeStore.setMyAvatarState(savedState)
								const myId = presenceStore.myUserId
								if (myId) officeStore.engineRef?.applyAvatarState?.(myId, savedState)
							}
						}
					} catch { /* ignore malformed JSON */ }
				}

				// Call-here invites
				if (mineRaw.PendingInvite) {
					try { myPendingInvite.value = JSON.parse(mineRaw.PendingInvite) }
					catch { myPendingInvite.value = null }
				} else {
					myPendingInvite.value = null
				}
			}

			try {
				officeStore.engineRef?.yieldDuplicateOfficeDeskToVisitor?.()
			} catch (e) {
				console.warn('[presence] duplicate desk reconcile:', e?.message || e)
			}

			// Seed all Supabase users as 'offline' so the sidebar can show them.
			// The WS world snapshot upserts live status on top — this is the
			// baseline that replaced the old polling list.
			if (running) {
				// WHY: a user can own multiple presence rows under one auth_user_id
				// (real + N dev rows). Without this filter, a dev session sees its
				// own real row as an offline "stranger" in the sidebar, and the
				// staging session sees the dev twins. We only seed rows that are
				// either ours (myListItemId) or belong to a different auth user.
				const myAuthIdAny = userStore.user?.authUserId || null
				for (const item of items) {
					if (!item.Title && !item.Email) continue
					if (item.Email?.includes('@localhost')) continue
					if (myAuthIdAny
						&& item.AuthUserId === myAuthIdAny
						&& String(item.Id) !== String(myListItemId.value)) continue
					const existing = presenceStore.users.find(u => u.id === String(item.Id))
					if (existing) continue  // already known (WS world arrived first)
					presenceStore.upsertUser({
						id: String(item.Id),
						authUserId: item.AuthUserId || null,
						name: item.Title || item.Email || '',
						email: item.Email || '',
						avaEmail: item.AvaEmail || '',
						slackId: item.SlackId || '',
						title: item.JobTitle || '',
						roomId: (item.RoomId || 'lobby').split(':')[0],
						seatId: null,
						color: item.AvatarColor || '#4d6080',
						avatarUrl: item.AvatarUrl || null,
						status: 'offline',
						slackStatus: item.SlackStatus || '',
						lastSeen: item.LastSeen || null,
						posX: null,
						posZ: null,
						rotation: null,
						avatarState: (() => { try { return JSON.parse(item.AvatarState || '{}') } catch { return {} } })(),
					})
				}
			}
		} catch (err) {
			console.warn('[presence] identity fetch failed:', err.message)
		}
	}

	/**
	 * In DEV, derive a stable synthetic email from ava_dev_num — the same key that
	 * drives the "Local Dev XX" display name in avatarStore.  One row per browser,
	 * stable across HMR reloads, page refreshes, and build/reload cycles.
	 * Clean up any legacy ava_dev_session key to stop it generating stale rows.
	 */
	function devSessionEmail () {
		// Also treat any localhost origin as a dev session — production builds served locally
		// must not write sessionId to the shared Supabase row or they displace real devices.
		const onLocalhost = typeof window !== 'undefined' &&
			(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
		if (!import.meta.env.DEV && !onLocalhost) return null
		localStorage.removeItem('ava_dev_session')   // remove legacy key
		// ava_dev_num drives the display name ("Local Dev 14") — short, human-readable.
		// ava_dev_uid drives the dev email uniquifier — longer to prevent browser collisions.
		let num = localStorage.getItem('ava_dev_num')
		if (!num) {
			num = String(Math.floor(10 + Math.random() * 90))
			localStorage.setItem('ava_dev_num', num)
		}
		let uid = localStorage.getItem('ava_dev_uid')
		if (!uid) {
			uid = Math.random().toString(36).slice(2, 9)  // ~78 billion combinations
			localStorage.setItem('ava_dev_uid', uid)
		}
		return `devtest.${uid}@localhost`
	}

	function myUserEmail () {
		return devSessionEmail()
			|| userStore.user?.Email
			|| userStore.user?.UserPrincipalName
			|| null
	}

	// ── Upsert my own presence row ───────────────────────────────────
	let _heartbeatInFlight = false
	let _lastHiddenHeartbeatAt = 0
	const HIDDEN_HEARTBEAT_INTERVAL = 60_000  // 60s between heartbeats when tab is hidden

	async function writeHeartbeat () {
		if (isDisplaced.value) return   // another device owns this session — do not write
		if (isPaused.value) return      // activity paused — do not write until resumed
		// Authoritative: another device claimed the row since our last fetch (e.g. race with a hidden tab).
		if (!devSessionEmail() && _serverSessionId && _serverSessionId !== MY_SESSION_ID) {
			console.info('[presence] server session no longer matches this tab — pausing')
			isDisplaced.value = true
			return
		}
		// Hidden tabs still send heartbeats to keep presence alive (prevents
		// premature offline marking), but throttled to every 60s to reduce DB writes.
		// The idle detector will set status to 'away' after 15 min hidden.
		if (typeof document !== 'undefined' && document.hidden) {
			const now = Date.now()
			if (now - _lastHiddenHeartbeatAt < HIDDEN_HEARTBEAT_INTERVAL) return
		}
		if (_heartbeatInFlight) return   // skip — previous write still in flight (prevents 409 Conflict)
		const email = myUserEmail()
		if (!email && !avatarStore.displayName) return   // not yet loaded

		// Before building payload — clear local desk if we lost the duplicate-desk tie-break
		// so this heartbeat writes room-without-seat instead of re-asserting the chair.
		try {
			officeStore.engineRef?.yieldDuplicateOfficeDeskToVisitor?.()
		} catch (e) {
			console.warn('[presence] duplicate desk reconcile (heartbeat):', e?.message || e)
		}

		// Restore cached Id on first call of this session
		if (!myListItemId.value && email) {
			myListItemId.value = loadCachedId(email)
		}

		// fetchPresence() is skipped while hidden, so re-check ownership before writing —
		// otherwise a background tab that never polled the new sessionId can stomp the active device.
		if (typeof document !== 'undefined' && document.hidden
			&& !devSessionEmail() && myListItemId.value
			&& typeof PresenceRepo.fetchAvatarStateSessionId === 'function') {
			try {
				const remote = await PresenceRepo.fetchAvatarStateSessionId(myListItemId.value)
				_serverSessionId = remote || null
				if (_serverSessionId && _serverSessionId !== MY_SESSION_ID) {
					console.info('[presence] hidden tab lost session ownership — pausing')
					isDisplaced.value = true
					return
				}
			} catch (e) {
				console.warn('[presence] session ownership verify failed:', e?.message || e)
			}
		}

		const devEmail = devSessionEmail()
		const devNum = devEmail ? localStorage.getItem('ava_dev_num') : null
		// Greeting field: keep sending while within expiry window, then clear it
		let greetingPayload = {}
		if (pendingGreeting) {
			greetingPayload = { GreetingTarget: Date.now() < pendingGreeting.expiry ? pendingGreeting.value : '' }
			if (Date.now() >= pendingGreeting.expiry) pendingGreeting = null
		}

		// Only write position/room when the 3-D engine has actually placed the user.
		// officeStore defaults (RoomId='lobby', PosX/Z=0) are uninitialized placeholders;
		// omitting them on upsert/MERGE preserves whatever correct values the row already has.
		// This prevents testbots (and any reloading tab) from writing stale defaults over
		// their real last-known location before the engine has finished setting up.
		const engineReady = !!officeStore.engineRef
		const effectiveStatus = avatarStore.status === 'offline' ? 'away' : avatarStore.status
		const payload = {
			Title: avatarStore.displayName || (devNum ? `Local Dev ${devNum}` : '') || email || '',
			Email: email || '',
			// Only write identity fields when we actually have them — MERGE means omitting
			// omitting a field leaves the existing remote value intact; writing '' would blank it.
			...(avatarStore.avaEmail ? { AvaEmail: avatarStore.avaEmail } : {}),
			...(avatarStore.slackId ? { SlackId: avatarStore.slackId } : {}),
			// Omit room/pose until the engine has set real values (see engineReady above).
			// Startup guard: if the engine just mounted and is still at the default 'lobby'
			// with no seat, the session-restore navigateTo hasn't fired yet (it's behind a
			// 300 ms setTimeout). Use sessionStorage to avoid broadcasting a stale lobby
			// write that peers see instantly via realtime before the nav animation completes.
			...(engineReady ? {
				RoomId: (() => {
					const seat = officeStore.currentSeatId
					const room = officeStore.currentRoomId
					if (seat) return seat
					if (room !== 'lobby') return room
					const ssRoom = sessionStorage.getItem('ava_last_room')
					const ssSeat = sessionStorage.getItem('ava_last_seat')
					return ssSeat || ssRoom || room
				})(),
			} : {}),
			Status: effectiveStatus,
			AvatarColor: avatarStore.color,
			AvatarUrl: avatarStore.avatarUrl || '',
			LastSeen: new Date().toISOString(),
			// Pose fields — let peers interpolate to last-known position without waiting for manual movement
			...(engineReady ? {
				PosX: officeStore.myPosX,
				PosZ: officeStore.myPosZ,
				Rotation: officeStore.myRotation,
			} : {}),
			AvatarState: JSON.stringify({
				// Destructure to drop stale sessionId and closedDoors (doors now live in door_states table).
				...(() => { const { sessionId: _sid, closedDoors: _cd, ...rest } = officeStore.myAvatarState || {}; return rest })(),
				soundMuted: isAllAudioMuted.value,
				// sessionId lets other devices detect that a newer login has claimed this row.
				// Omit for localhost / dev sessions so they never displace real staging users.
				...(!devSessionEmail() ? { sessionId: MY_SESSION_ID } : {}),
			}),
			...(avatarStore.slackStatus ? { SlackStatus: avatarStore.slackStatus } : {}),
			...(avatarStore.title ? { JobTitle: avatarStore.title } : {}),
			// For real (non-dev) sessions, Preferences is written separately via the
			// updatePreferencesKeepDevices RPC, which atomically preserves devices entries
			// from other browsers. Dev sessions write Preferences inline (no device tracking).
			...(devSessionEmail() ? {
				Preferences: JSON.stringify({
					theme: isDark.value ? 'dark' : 'light',
					displayName: avatarStore.displayName || '',
					title: avatarStore.title || '',
					color: avatarStore.color,
					skinTone: avatarStore.skinTone,
					hairColor: avatarStore.hairColor,
					hairStyle: avatarStore.hairStyle,
					avatarUrl: avatarStore.avatarUrl || '',
					pinnedApps: JSON.parse(localStorage.getItem('ava_pinned_apps') || '[]'),
					clientStats,
				}),
			} : {}),
			...greetingPayload,
		}

		// Preferences object for real sessions — written via RPC after the main update.
		// No devices key: the RPC reads the server's current devices map and merges atomically.
		const prefsObj = devSessionEmail() ? null : {
			theme: isDark.value ? 'dark' : 'light',
			displayName: avatarStore.displayName || '',
			title: avatarStore.title || '',
			color: avatarStore.color,
			skinTone: avatarStore.skinTone,
			hairColor: avatarStore.hairColor,
			hairStyle: avatarStore.hairStyle,
			avatarUrl: avatarStore.avatarUrl || '',
			pinnedApps: JSON.parse(localStorage.getItem('ava_pinned_apps') || '[]'),
			clientStats,
		}

		if (typeof document !== 'undefined' && document.hidden) {
			_lastHiddenHeartbeatAt = Date.now()
		}

		_heartbeatInFlight = true
		try {
			if (myListItemId.value) {
				// Row already exists — update it
				const res = await PresenceRepo.update(myListItemId.value, payload)
				if (res?.rlsBlocked) {
					// Orphaned row (auth_user_id IS NULL) — claim then retry
					console.info('[presence] claiming orphaned row', myListItemId.value)
					await PresenceRepo.claimOrphanRow(myListItemId.value)
					await PresenceRepo.update(myListItemId.value, payload)
				} else if (res?.status === 404 || res?.status === 409) {
					// 404: deleted row. 409: stale cache points to another account's row (email conflict).
					console.warn(`[presence] cached item ID stale (${res.status}), re-upserting`)
					myListItemId.value = null
					if (email) saveCachedId(email, null)
					await ensureAndWrite(payload, email)
				}
			} else {
				// First write — search for existing row by email, then create if absent
				await ensureAndWrite(payload, email)
			}
			heartbeatBackoffMs = 0
			// First successful write — this session now owns the row; start checking displacement.
			_displaceGraceUntil = 0
			if (!devSessionEmail()) _serverSessionId = MY_SESSION_ID
			// Atomically write preferences for real sessions, preserving devices entries.
			// prefsObj is null for dev/localhost sessions (they write Preferences inline above).
			if (myListItemId.value && prefsObj) {
				PresenceRepo.updatePreferencesKeepDevices(myListItemId.value, prefsObj).catch(e => {
					console.warn('[presence] preferences sync failed:', e.message)
				})
			}
		} catch (err) {
			console.warn('[presence] heartbeat failed:', err.message)
			heartbeatBackoffMs = Math.min(MAX_BACKOFF_MS, Math.max(HEARTBEAT_INTERVAL, (heartbeatBackoffMs || HEARTBEAT_INTERVAL) * 2))
			// Reset so we retry the upsert next time
			myListItemId.value = null
		} finally {
			_heartbeatInFlight = false
		}
	}

	async function ensureAndWrite (payload, email) {
		try {
			// On Supabase (non-dev), match by auth_user_id first — prevents one Google account
			// from finding and overwriting a different account's row that shares AvaEmail.
			// Dev mode uses a synthetic email identity and must not touch the real staging row.
			if (isSupabase && !devSessionEmail() && typeof PresenceRepo.findByAuthUserId === 'function') {
				const authId = userStore.user?.authUserId
				if (authId) {
					const existing = await PresenceRepo.findByAuthUserId(authId)
					if (existing) {
						const res = await PresenceRepo.update(existing.Id, payload)
						if (res?.rlsBlocked) {
							// Orphaned row (auth_user_id IS NULL) — claim it then retry
							console.info('[presence] claiming orphaned row', existing.Id)
							await PresenceRepo.claimOrphanRow(existing.Id)
							await PresenceRepo.update(existing.Id, payload)
						}
						if (res?.status !== 409) {
							// Success (or 404 stale — let writeHeartbeat's next cycle sort it out)
							myListItemId.value = existing.Id
							saveCachedId(email, myListItemId.value)
							presenceStore.setMyUserId(String(myListItemId.value))
							return
						}
						// 409: this row's email conflicts with another row — it's a stale duplicate.
						// The canonical row is the one that already holds our email. Fall through.
					}
				}
			}

			if (email) {
				const existing = await PresenceRepo.findByEmail(email)
				if (existing) {
					const res = await PresenceRepo.update(existing.Id, payload)
					if (res?.rlsBlocked) {
						// Orphaned row (auth_user_id IS NULL) — claim it then retry
						console.info('[presence] claiming orphaned row', existing.Id)
						await PresenceRepo.claimOrphanRow(existing.Id)
						await PresenceRepo.update(existing.Id, payload)
					}
					if (res?.status !== 409) {
						myListItemId.value = existing.Id
						saveCachedId(email, myListItemId.value)
						presenceStore.setMyUserId(String(myListItemId.value))
						return
					}
					// 409 here is unexpected — skip create too; fetchPresence will sort it out
					console.warn('[presence] email-row update also 409 — duplicate rows in DB; fetchPresence will recover')
					return
				}
			}

			// No existing row — create one
			try {
				const created = await PresenceRepo.create(payload)
				if (created?.id) {
					myListItemId.value = created.id
					saveCachedId(email, myListItemId.value)
					presenceStore.setMyUserId(String(myListItemId.value))
				}
			} catch (createErr) {
				if (/duplicate key|unique.*constraint/i.test(createErr.message || '')) {
					// Row exists in the DB but SELECT couldn't see it (e.g. RLS + null auth_user_id
					// on a legacy row). fetchPresence will find and claim it within one poll cycle.
					console.warn('[presence] row exists but not visible to SELECT — fetchPresence will claim it')
				} else {
					throw createErr
				}
			}
		} catch (err) {
			console.warn('[presence] ensureAndWrite failed:', err.message)
		}
	}

	// ── WS presence handlers ────────────────────────────────────────
	const rtSocket = useRealtimeSocket()
	_moduleSocket = rtSocket  // cache for pauseSession/resumeSession
	const _wsHandlerRefs = []

	function _onWs (type, cb) {
		rtSocket.on(type, cb)
		_wsHandlerRefs.push([type, cb])
	}

	function _removeWsHandlers () {
		for (const [type, cb] of _wsHandlerRefs) rtSocket.off(type, cb)
		_wsHandlerRefs.length = 0
	}

	/**
	 * Build the profile payload sent to the WS server on join and profile updates.
	 */
	/**
	 * Get the effective authUserId for the WS server.
	 * On localhost/dev, returns a synthetic ID so dev instances are treated
	 * as separate users and don't displace the real staging session.
	 */
	function _effectiveAuthUserId () {
		const devEmail = devSessionEmail()
		if (devEmail) {
			// Synthetic auth ID for dev — stable per browser (based on ava_dev_uid)
			const uid = localStorage.getItem('ava_dev_uid') || 'dev'
			return `dev-${uid}`
		}
		return userStore.user?.authUserId || null
	}

	function _buildProfile () {
		const email = myUserEmail()
		const devEmail = devSessionEmail()
		return {
			displayName: avatarStore.displayName || '',
			email: email || '',
			avaEmail: devEmail ? '' : (avatarStore.avaEmail || ''),
			slackId: devEmail ? '' : (avatarStore.slackId || ''),
			jobTitle: avatarStore.title || '',
			avatarColor: avatarStore.color,
			avatarUrl: avatarStore.avatarUrl || '',
			status: avatarStore.status === 'offline' ? 'away' : avatarStore.status,
			slackStatus: avatarStore.slackStatus || '',
		}
	}

	/**
	 * Send a presence join to the WS server with full profile data.
	 */
	function _sendPresenceJoin () {
		// Session-restore guard: the 300 ms navigateTo timer in OfficeView may not
		// have fired yet when join is called, leaving officeStore at defaults (lobby,
		// seatId=null, pos=0). Use sessionStorage values — written on every room/seat
		// change and persisted across page refresh — as authoritative fallback so
		// peers immediately see the user in the correct room and seat.
		const ssRoom = sessionStorage.getItem('ava_last_room')
		const ssSeat = sessionStorage.getItem('ava_last_seat')
		const seatId = officeStore.currentSeatId || ssSeat || null
		const roomId = (() => {
			const r = officeStore.currentRoomId
			if (r && r !== 'lobby') return r
			if (seatId) return seatId.split(':')[0] || 'lobby'
			return ssRoom || 'lobby'
		})()
		// Position: prefer live store; fall back to last-saved coords (cleared on seat,
		// so 0 for seated users is fine — seat ID drives placement on the peer side).
		const posX = officeStore.myPosX || Number(sessionStorage.getItem('ava_last_pos_x') || 0)
		const posZ = officeStore.myPosZ || Number(sessionStorage.getItem('ava_last_pos_z') || 0)
		const rotation = officeStore.myRotation || Number(sessionStorage.getItem('ava_last_rotation') || 0)

		const authUserId = _effectiveAuthUserId()
		if (!authUserId) {
			console.warn('[presence] _sendPresenceJoin called without authUserId — skipping')
			return
		}
		rtSocket.emit('join', {
			roomId,
			seatId,
			authUserId,
			presenceRowId: myListItemId.value ? String(myListItemId.value) : null,
			profile: _buildProfile(),
			posX,
			posZ,
			rotation,
			avatarState: officeStore.myAvatarState || {},
			// sessionId lets the server detect same-tab reconnects (e.g. after Chrome
			// suspension) and auto-replace the stale connection instead of showing
			// "Signed in on another device". Always sent — dev sessions need it too
			// (they use the same authUserId across reloads, so without it the server
			// treats every reload as a new device and triggers displacement).
			// NOTE: this is the WS-only session token. The Supabase row sessionId
			// write is separately guarded by !devSessionEmail() in writeHeartbeat.
			sessionId: MY_SESSION_ID,
		})
	}

	/**
	 * Send a profile update to the WS server (when status, avatar, etc. change).
	 */
	function _sendProfileUpdate (fields) {
		rtSocket.emit('profile', fields)
	}

	// ── Lifecycle ────────────────────────────────────────────────────
	function start () {
		if (presenceStore.pollingActive) return
		presenceStore.setPolling(true)
		running = true

		// ── Door state sync via WS ───────────────────────────────────
		fetchDoorStates()
		_onWs('door', (data) => {
			if (!running) return
			// Individual door state update from server
			if (data.doorId) {
				// WHY: always update the in-memory map so isRoomLocked() reflects the
				// latest server state, even before the 3D engine is mounted. Gating
				// the map write on engineRef previously dropped peer locks that
				// arrived during the brief startup window, leaving doors clickable
				// as if they were merely "closed but unlocked".
				doorStates.set(data.doorId, { isOpen: data.isOpen, isLocked: data.isLocked })
				const engine = officeStore.engineRef
				if (engine?.syncDoorStates) engine.syncDoorStates(doorStates)
			}
		})
		_onWs('door_refresh', () => {
			if (!running) return
			fetchDoorStates()
		})

		// WHY: if the engine ref is replaced (HMR, late mount, re-init) after
		// fetchDoorStates already populated the doorStates map, the new engine's
		// door pivots stay at their default (isLocked=false, isOpen=true) until
		// the next 'door' or 'door_refresh' event. Re-pushing the current map
		// whenever the engine attaches keeps lock state visible and click-safe.
		watch(() => officeStore.engineRef, (engine) => {
			if (!running || !engine?.syncDoorStates) return
			engine.syncDoorStates(doorStates)
		})

		// When leaving a room: if we're the last occupant, auto-unlock via WS
		watch(() => officeStore.currentRoomId, (_newRoom, oldRoom) => {
			if (!oldRoom) return
			const someoneElseInRoom = presenceStore.users.some(u =>
				u.status !== 'offline' &&
				u.id !== String(presenceStore.myUserId) &&
				u.roomId === oldRoom
			)
			if (!someoneElseInRoom) {
				DoorStateRepo.autoUnlockRoom(oldRoom).then(() => {
					rtSocket.emit('door', { action: 'auto_unlock', roomId: oldRoom })
				}).catch(err =>
					console.warn('[presence] autoUnlockRoom failed:', err.message)
				)
			}
		})

		// ── WS presence: connect and register handlers ──────────────
		rtSocket.connect()

		// Handle world snapshot — full state from server on connect.
		// Merge rather than replace so the offline baseline from fetchPresence is preserved.
		_onWs('world', (data) => {
			if (!running) return
			const liveUsers = (data.users || []).map(u => ({
				id: String(u.id),
				authUserId: u.authUserId || null,
				name: u.name || u.email || '',
				email: u.email || '',
				avaEmail: u.avaEmail || '',
				slackId: u.slackId || '',
				title: u.title || '',
				roomId: (u.roomId || 'lobby').split(':')[0],
				seatId: u.roomId?.includes(':') ? u.roomId : null,
				color: u.color || '#4d6080',
				avatarUrl: u.avatarUrl || null,
				status: u.status || 'online',
				slackStatus: u.slackStatus || '',
				lastSeen: u.lastSeen || null,
				posX: typeof u.posX === 'number' ? u.posX : null,
				posZ: typeof u.posZ === 'number' ? u.posZ : null,
				rotation: typeof u.rotation === 'number' ? u.rotation : null,
				avatarState: u.avatarState || {},
			}))
			const liveIds = new Set(liveUsers.map(u => u.id))
			// Mark any previously-online user not in this snapshot as offline
			// (handles reconnects where peers left while WS was down)
			for (const u of [...presenceStore.users]) {
				if (!liveIds.has(u.id) && u.status !== 'offline') {
					presenceStore.upsertUser({ ...u, status: 'offline', seatId: null })
				}
			}
			for (const user of liveUsers) {
				presenceStore.upsertUser(user)
			}
		})

		// Handle user entering a room (new connection or room change)
		_onWs('enter', (data) => {
			if (!running) return
			const u = data
			const user = {
				id: String(u.id || u.userId),
				authUserId: u.authUserId || null,
				name: u.name || u.email || '',
				email: u.email || '',
				avaEmail: u.avaEmail || '',
				slackId: u.slackId || '',
				title: u.title || '',
				roomId: (u.roomId || 'lobby').split(':')[0],
				seatId: u.roomId?.includes(':') ? u.roomId : null,
				color: u.color || '#4d6080',
				avatarUrl: u.avatarUrl || null,
				status: u.status || 'online',
				slackStatus: u.slackStatus || '',
				lastSeen: u.lastSeen || null,
				posX: typeof u.posX === 'number' ? u.posX : null,
				posZ: typeof u.posZ === 'number' ? u.posZ : null,
				rotation: typeof u.rotation === 'number' ? u.rotation : null,
				avatarState: u.avatarState || {},
			}
			presenceStore.upsertUser(user)
		})

		// Handle user leaving — mark offline rather than remove so they stay
		// visible in the sidebar's "show offline" list.
		_onWs('leave', (data) => {
			if (!running) return
			const userId = data.userId
			if (!userId) return
			const uid = String(userId)
			const existing = presenceStore.users.find(u => u.id === uid)
			if (existing) {
				presenceStore.upsertUser({ ...existing, status: 'offline', seatId: null })
			} else {
				presenceStore.removeUser(uid)
			}
		})

		// Handle profile updates from other users
		_onWs('profile', (data) => {
			if (!running) return
			const userId = data.userId
			if (!userId) return
			const existing = presenceStore.users.find(u => u.id === String(userId))
			if (!existing) return
			const updated = { ...existing }
			if (data.displayName !== undefined) updated.name = data.displayName
			if (data.status !== undefined) updated.status = data.status
			if (data.avatarColor !== undefined) updated.color = data.avatarColor
			if (data.avatarUrl !== undefined) updated.avatarUrl = data.avatarUrl
			if (data.slackStatus !== undefined) updated.slackStatus = data.slackStatus
			if (data.jobTitle !== undefined) updated.title = data.jobTitle
			presenceStore.upsertUser(updated)
		})

		// Handle incoming greeting — relay from sender's client via WS server
		_onWs('greet', (data) => {
			if (!running) return
			const { fromUserId, sameRoom } = data
			if (!fromUserId) return
			window.dispatchEvent(new CustomEvent('ava-greeting-received', {
				detail: { fromUserId: String(fromUserId), sameRoom: !!sameRoom },
			}))
		})

		// Handle WS open (reconnect only) — re-send presence join, or send a
		// queued reclaim if this reconnect was triggered by reclaimSession().
		_onWs('_open', () => {
			if (!running) return
			if (_pendingReclaim) {
				rtSocket.emit('reclaim', _pendingReclaim)
				_pendingReclaim = null
				return
			}
			// Safety guard: never send join while displaced (e.g. reconnect race).
			if (isDisplaced.value) return
			// Only send join on reconnect (identity already resolved).
			// Use _effectiveAuthUserId() — dev sessions have no userStore.user?.authUserId.
			if (myListItemId.value && _effectiveAuthUserId()) {
				_sendPresenceJoin()
			}
		})

		// Handle displacement — server tells us another session is already active
		_onWs('displaced', () => {
			console.info('[presence] another session is active — showing displacement modal')
			isDisplaced.value = true
		})

		// Handle WS close with session displacement code (from reclaim by other tab)
		_onWs('_close', (ev) => {
			if (ev?.code === 4001) {
				console.info('[presence] session displaced by another device via WS')
				isDisplaced.value = true
			}
		})

		// When this tab is reclaimed, immediately re-assert our session.
		let _wasMutedBeforeDisplace = false
		watch(isDisplaced, (displaced) => {
			if (displaced) {
				_wasMutedBeforeDisplace = isAllAudioMuted.value
				isAllAudioMuted.value = true
				lifecycleGen++
				clearTimeout(pollTimer)
				clearTimeout(heartbeatTimer)
				pollTimer = null
				heartbeatTimer = null
				// Disconnect WS so the stale browser stops auto-reconnecting and
				// re-sending join. Without this, the 1s reconnect backoff races
				// against the active browser and can immediately re-displace it.
				rtSocket.disconnect()
				window.dispatchEvent(new CustomEvent('ava-session-displaced'))
			} else {
				isAllAudioMuted.value = _wasMutedBeforeDisplace
				lifecycleGen++
				// Clear stale seat loaded from the DB at startup. Without this,
				// syncLocalAvatarFromPresence uses the other device's seat as
				// effectiveSeat on the reclaim world snapshot, teleporting this
				// browser to the wrong room and leaving the avatar in a seated pose.
				presenceStore.setMySeatId(null)
				officeStore.setCurrentSeat(null)
				// Signal OfficeView to re-run session restore for this browser's location.
				window.dispatchEvent(new CustomEvent('ava-session-reclaimed'))
				rtSocket.connect()
			}
		})

		// Handle reclaim event from reclaimSession() — send reclaim to server.
		// The WS is disconnected while displaced (disconnect() called in the
		// isDisplaced watcher), so we queue the payload and let _open send it.
		const _onReclaim = () => {
			if (!running) return
			const authUserId = _effectiveAuthUserId()
			if (!authUserId) return
			const payload = {
				roomId: officeStore.currentRoomId || 'lobby',
				seatId: officeStore.currentSeatId || null,
				authUserId,
				presenceRowId: myListItemId.value ? String(myListItemId.value) : null,
				profile: _buildProfile(),
				posX: officeStore.myPosX,
				posZ: officeStore.myPosZ,
				rotation: officeStore.myRotation,
				avatarState: officeStore.myAvatarState || {},
			}
			const rawWs = rtSocket.getRawSocket()
			if (rawWs && rawWs.readyState === WebSocket.OPEN) {
				// WS still open (e.g. displaced via message without close) — send now
				rtSocket.emit('reclaim', payload)
			} else {
				// WS disconnected — queue for _open handler, then reconnect
				_pendingReclaim = payload
				rtSocket.connect()
			}
		}
		window.addEventListener('ava-session-reclaim', _onReclaim)

		// ── Initial Supabase fetch — one-time for identity resolution ──
		// Fetch once to resolve myListItemId, restore preferences, merge device.
		// After this, presence is maintained via WS — no more polling.
		fetchPresence().then(() => {
			writeHeartbeat().then(() => {
				// Now that we have our row ID, send presence join to WS server
				if (running && rtSocket.connected.value) {
					_sendPresenceJoin()
				}
			})
		})

		// ── No polling or heartbeat loops ────────────────────────────
		// The WS server is the authority for real-time presence. The initial
		// fetchPresence + writeHeartbeat above handles identity resolution.
		// The server's 30s flush persists positions to Supabase.
		// Greeting detection and invite handling will move to WS in Phase 3.
		// pollTimer and heartbeatTimer are unused but kept for stop() cleanup.
		// ── Profile change watchers → send via WS ───────────────────
		// Instead of writing heartbeats on every change, send profile updates
		// to the WS server which relays to peers and includes in flush.
		let navDebounce = null
		function debouncedRoomChange () {
			if (isDisplaced.value || isPaused.value) return
			clearTimeout(navDebounce)
			navDebounce = setTimeout(() => {
				if (officeStore.isTransitioning) return
				const roomId = officeStore.currentRoomId
				const seatId = officeStore.currentSeatId || null
				if (roomId) rtSocket.emit('room', { roomId, seatId })
			}, 400)
		}
		watch(() => officeStore.currentRoomId, debouncedRoomChange)
		watch(() => officeStore.currentSeatId, debouncedRoomChange)

		watch(() => avatarStore.status, () => {
			const effectiveStatus = avatarStore.status === 'offline' ? 'away' : avatarStore.status
			_sendProfileUpdate({ status: effectiveStatus })
			// WS broadcast excludes sender — update own presenceStore entry locally
			if (presenceStore.myUserId) {
				const me = presenceStore.users.find(u => u.id === String(presenceStore.myUserId))
				if (me) presenceStore.upsertUser({ ...me, status: effectiveStatus })
			}
		})
		watch(() => avatarStore.avatarUrl, () => {
			_sendProfileUpdate({ avatarUrl: avatarStore.avatarUrl || '' })
		})
		watch(() => avatarStore.color, () => {
			_sendProfileUpdate({ avatarColor: avatarStore.color })
		})
		watch(() => avatarStore.displayName, (newName) => {
			if (newName) _sendProfileUpdate({ displayName: newName })
		})

		// AvatarState changes — sent as pose updates (the server includes avatarState in pose relay)
		watch(() => {
			const s = officeStore.myAvatarState || {}
			const dog = s.dogCmd ? (s.dogCmd.issuedAt || '') : ''
			return `${s.holding || ''}|${s.heldAt || ''}|${s.gesture || ''}|${dog}`
		}, () => {
			let bx = officeStore.myPosX
			let bz = officeStore.myPosZ
			const seatId = officeStore.currentSeatId
			if (seatId) {
				// Use layout-derived world position — g.position trails the GSAP tween
				// and would broadcast walk coords immediately after claimSeat.
				const roomId = seatId.includes(':') ? seatId.slice(0, seatId.indexOf(':')) : null
				const room = roomId ? ALL_ROOMS.find(r => r.id === roomId) : null
				const seat = room?.seats?.find(s => s.seatId === seatId)
				if (seat) {
					const [rx, rz] = room.pos
					const [sx, , sz] = seat.pos
					bx = rx + sx
					bz = rz + sz
				} else {
					const myId = presenceStore.myUserId ? String(presenceStore.myUserId) : ''
					const g = officeStore.engineRef?.avatarGroups?.get(myId)
					if (g) { bx = g.position.x; bz = g.position.z }
				}
			}
			rtSocket.emit('pose', {
				x: bx,
				z: bz,
				r: officeStore.myRotation,
				s: officeStore.myAvatarState,
			})
		})
	}

	/**
	 * Write a greeting to the sender's own presence row so the target user detects it
	 * on their next presence poll (within ~8 s) and fires local sound + rotation.
	 * The GreetingTarget field is kept for 20 s then cleared on the next heartbeat.
	 */
	async function sendGreeting (targetPresenceId) {
		if (isDisplaced.value) return
		const ts = Date.now()
		const value = `${targetPresenceId}:${ts}`
		pendingGreeting = { value, expiry: ts + 20_000 }
		// WS relay — immediate delivery without waiting for Supabase polling
		rtSocket.emit('greet', { targetUserId: String(targetPresenceId) })
		// Supabase write for persistence (kept for 20s then cleared)
		if (myListItemId.value) {
			try {
				await PresenceRepo.writeGreeting(myListItemId.value, value)
			} catch (e) {
				console.warn('[presence] sendGreeting write failed:', e.message)
			}
		}
	}

	function stop () {
		lifecycleGen++
		clearTimeout(pollTimer)
		clearTimeout(heartbeatTimer)
		_removeWsHandlers()
		if (_unsubscribeRealtime) { try { _unsubscribeRealtime() } catch { /* ignore */ } _unsubscribeRealtime = null }
		pollTimer = null
		heartbeatTimer = null
		_pendingReclaim = null
		// Only clear the shared flag if this instance was the one that set it —
		// prevents UserPopup (or any non-start caller) from killing OfficeView's loops.
		if (running) presenceStore.setPolling(false)
		running = false
	}

	onUnmounted(stop)

	return { start, stop, fetchPresence, writeHeartbeat, sendGreeting }
}

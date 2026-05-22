/**
 * Supabase PresenceRepo — reads/writes the public.users presence row for the
 * current session and exposes Realtime subscriptions for all users.
 *
 * Translates between the PascalCase shape used by usePresence.js and the
 * snake_case columns of public.users. JSON columns (preferences, avatar_state,
 * pending_invite) are stored natively as jsonb; the repo accepts either a
 * parsed object or a JSON string on write for backward compatibility.
 *
 * Realtime: subscribe(onChange) hooks Postgres Changes on public.users.
 * The handler invokes onChange() (no payload) so the caller refetches —
 * usePresence's existing fetchPresence() already handles normalization,
 * greeting detection, identity resolution, and offline sweep in one place.
 *
 * Broadcast pose: per-room channel ("room:<id>") for sub-second pose updates
 * that don't hit the DB.
 */
import { supabase } from './client.js'
import { AuthRepo } from './AuthRepo.js'

// SP PascalCase → Postgres snake_case
const SP_TO_DB = {
	Title: 'title',
	Email: 'email',
	AvaEmail: 'ava_email',
	SlackId: 'slack_id',
	JobTitle: 'job_title',
	RoomId: 'room_id',
	AvatarColor: 'avatar_color',
	AvatarUrl: 'avatar_url',
	Status: 'status',
	LastSeen: 'last_seen',
	SlackStatus: 'slack_status',
	Preferences: 'preferences',
	PosX: 'pos_x',
	PosZ: 'pos_z',
	Rotation: 'rotation',
	AvatarState: 'avatar_state',
	GreetingTarget: 'greeting_target',
	PendingInvite: 'pending_invite',
}
const DB_TO_SP = Object.fromEntries(
	Object.entries(SP_TO_DB).map(([sp, db]) => [db, sp])
)
const JSON_COLS = new Set(['preferences', 'avatar_state', 'pending_invite'])

function toDbPayload (spPayload) {
	const out = {}
	for (const [k, v] of Object.entries(spPayload)) {
		const dbKey = SP_TO_DB[k]
		if (!dbKey) continue
		if (JSON_COLS.has(dbKey) && typeof v === 'string') {
			try { out[dbKey] = v ? JSON.parse(v) : null }
			catch { out[dbKey] = v }
		} else if (v === '' && (dbKey === 'greeting_target' || dbKey === 'pending_invite')) {
			out[dbKey] = null
		} else {
			out[dbKey] = v
		}
	}
	return out
}

function toSpRow (row) {
	if (!row) return row
	const out = { Id: row.id, AuthUserId: row.auth_user_id || null }
	for (const [dbKey, val] of Object.entries(row)) {
		const spKey = DB_TO_SP[dbKey]
		if (!spKey) continue
		if (JSON_COLS.has(dbKey) && val != null && typeof val !== 'string') {
			out[spKey] = JSON.stringify(val)
		} else {
			out[spKey] = val
		}
	}
	return out
}

const TABLE = 'users'
const COLUMNS = 'id,auth_user_id,email,ava_email,slack_id,title,job_title,room_id,avatar_color,avatar_url,status,last_seen,slack_status,preferences,pos_x,pos_z,rotation,avatar_state,greeting_target,pending_invite'

export const PresenceRepo = {
	backend: 'supabase',

	async fetchAll () {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb.from(TABLE).select(COLUMNS)
		if (error) throw error
		return (data || []).map(toSpRow)
	},

	async findByEmail (email) {
		if (!email) return null
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb
			.from(TABLE)
			.select('id')
			.ilike('email', email)
			.limit(1)
		if (error) throw error
		const row = data?.[0]
		return row ? { Id: row.id } : null
	},

	async findByAuthUserId (authUserId) {
		if (!authUserId) return null
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb
			.from(TABLE)
			.select('id')
			.eq('auth_user_id', authUserId)
			.not('email', 'ilike', '%@localhost')
			.limit(1)
		if (error) throw error
		const row = data?.[0]
		return row ? { Id: row.id } : null
	},

	/** Lightweight read for multi-device session arbitration (hidden-tab path). */
	async fetchAvatarStateSessionId (rowId) {
		if (!rowId) return null
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb.from(TABLE).select('avatar_state').eq('id', rowId).maybeSingle()
		if (error) throw error
		const raw = data?.avatar_state
		const obj = typeof raw === 'string'
			? (() => { try { return JSON.parse(raw || '{}') } catch { return {} } })()
			: (raw && typeof raw === 'object' ? raw : {})
		return obj?.sessionId || null
	},

	async update (id, payload) {
		await AuthRepo.ready()
		const sb = supabase()
		const dbPayload = toDbPayload(payload)
		// email is the immutable Supabase auth email — set once on create, never updated.
		// Writing it on update causes unique-constraint 409s when stale duplicate rows exist.
		delete dbPayload.email
		const { data, error, status } = await sb.from(TABLE).update(dbPayload).eq('id', id).select('id')
		if (error) {
			if (error.code === 'PGRST116' || /no rows/i.test(error.message || '')) return { status: 404 }
			if (error.code === '23505' || /unique.*constraint|duplicate key/i.test(error.message || '')) return { status: 409 }
			throw error
		}
		// Zero rows modified — either the row was deleted (not found) or RLS is
		// blocking because auth_user_id doesn't match auth.uid() (orphaned row).
		// Distinguish the two so callers can re-create deleted rows rather than
		// trying to claim a row that doesn't exist.
		if (!data?.length) {
			const { data: exists } = await sb.from(TABLE).select('id').eq('id', id).limit(1)
			if (!exists?.length) return { status: 404 }   // row was deleted
			return { status: 0, rlsBlocked: true }         // row exists, RLS blocked
		}
		return { status, ok: status >= 200 && status < 300 }
	},

	/**
	 * Atomically merges one device entry into preferences.devices[deviceId] without
	 * touching any other device's entry or other preferences keys. Requires the
	 * merge_device_snapshot SECURITY DEFINER RPC in Supabase.
	 */
	async mergeDevice (deviceId, deviceData) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('merge_device_snapshot', {
			p_device_id:   deviceId,
			p_device_data: deviceData,
		})
		if (error) throw error
	},

	/**
	 * Writes new preferences while atomically preserving the server's current
	 * preferences.devices map. Prevents concurrent heartbeats from different
	 * browsers/devices clobbering each other's device entries.
	 * Requires the update_preferences_keep_devices SECURITY DEFINER RPC.
	 */
	async updatePreferencesKeepDevices (rowId, prefsObj) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('update_preferences_keep_devices', {
			p_row_id: rowId,
			p_prefs:  prefsObj,
		})
		if (error) throw error
	},

	async claimOrphanRow (id) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('claim_orphan_row', { row_id: id })
		if (error) throw error
	},

	async create (payload) {
		await AuthRepo.ready()
		const sb = supabase()
		const dbPayload = toDbPayload(payload)
		// Set auth_user_id so the RLS UPDATE policy (auth.uid() = auth_user_id) passes.
		// findByAuthUserId now excludes @localhost rows, so staging can never claim a dev row.
		const session = AuthRepo.getSession()
		if (session?.user?.id) {
			dbPayload.auth_user_id = session.user.id
		}
		const { data, error } = await sb
			.from(TABLE)
			.insert(dbPayload)
			.select('id')
			.single()
		if (error) throw error
		return data?.id ? { id: data.id } : null
	},

	async writeInvite (targetUserId, inviteJson) {
		await AuthRepo.ready()
		const sb = supabase()
		const invite = typeof inviteJson === 'string' ? JSON.parse(inviteJson) : inviteJson
		const { error } = await sb.rpc('send_invite', { target_id: targetUserId, invite })
		if (error) throw error
	},

	async clearInvite () {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('clear_invite')
		if (error) throw error
	},

	async writeGreeting (_myId, value) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('set_greeting', { value })
		if (error) throw error
	},

	subscribe (onChange) {
		const sb = supabase()
		const channel = sb
			.channel('presence-users')
			.on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => {
				try { onChange() } catch (e) { console.warn('[supabase/presence] onChange threw:', e) }
			})
			.subscribe()
		return () => { try { sb.removeChannel(channel) } catch { /* ignore */ } }
	},

	// Per-room broadcast channel for sub-second pose updates.
	// Returns { sendPose, leave }. Both publishing and subscribing share one
	// channel — supabase-js requires .subscribe() before .send() will reach
	// other clients, so we can't split them across two channels.
	//
	// Gating .send() on the SUBSCRIBED state keeps every pose frame on the
	// WebSocket. Without the gate, supabase-js silently falls back to the
	// Realtime REST API for any call issued before the channel has joined,
	// which spams the console with a deprecation warning and adds per-frame
	// HTTP latency. Pose updates arrive ~30/s, so dropping the handful that
	// would have fired during the join handshake is imperceptible.
	joinRoomChannel (roomId, onPose, onSound) {
		if (!roomId) return { sendPose () { }, sendSound () { }, leave () { } }
		const sb = supabase()
		let joined = false
		const channel = sb
			.channel(`room:${roomId}`, { config: { broadcast: { self: false } } })
			.on('broadcast', { event: 'pose' }, ({ payload }) => {
				try { onPose(payload) } catch (e) { console.warn('[supabase/pose] handler threw:', e) }
			})
			.on('broadcast', { event: 'play_sound' }, ({ payload }) => {
				try { onSound?.(payload?.filename) } catch { /* ignore */ }
			})
		channel.subscribe((status) => {
			joined = status === 'SUBSCRIBED'
		})
		return {
			sendPose: (payload) => {
				if (!joined) return
				channel.send({ type: 'broadcast', event: 'pose', payload })
			},
			sendSound: (filename) => {
				if (!joined) return
				channel.send({ type: 'broadcast', event: 'play_sound', payload: { filename } })
			},
			leave: () => {
				joined = false
				try { sb.removeChannel(channel) } catch { /* ignore */ }
			},
		}
	},
}

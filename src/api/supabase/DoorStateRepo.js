/**
 * Supabase DoorStateRepo — reads/writes the public.door_states table.
 *
 * Each row represents one door: "roomId-wall" → { is_open, is_locked }.
 * State is authoritative — all clients subscribe via Postgres Realtime
 * and refetch on every change for instant visual sync.
 *
 * Writes go through SECURITY DEFINER RPCs:
 *   set_door_state(door_id, is_open, is_locked) — upsert with occupancy guard
 *   auto_unlock_room(room_prefix) — open+unlock all doors of a room
 */
import { supabase } from './client.js'
import { AuthRepo } from './AuthRepo.js'

const TABLE = 'door_states'

export const DoorStateRepo = {
	/**
	 * Fetch all door states.
	 * @returns {Map<string, { isOpen: boolean, isLocked: boolean }>}
	 */
	async fetchAll () {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb.from(TABLE).select('id, is_open, is_locked')
		if (error) throw error
		const map = new Map()
		for (const row of (data || [])) {
			map.set(row.id, { isOpen: row.is_open, isLocked: row.is_locked })
		}
		return map
	},

	/**
	 * Set a door's state via RPC (upsert with occupancy check for locks).
	 */
	async setDoorState (doorId, isOpen, isLocked) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('set_door_state', {
			door_id: doorId,
			p_is_open: isOpen,
			p_is_locked: isLocked,
		})
		if (error) throw error
	},

	/**
	 * Open + unlock all doors of a room (called when last person leaves).
	 */
	async autoUnlockRoom (roomId) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('auto_unlock_room', { p_room_prefix: roomId })
		if (error) throw error
	},

	/**
	 * Subscribe to door_states changes via Postgres Realtime.
	 * Calls onChange() with no payload — caller refetches.
	 * @returns {Function} unsubscribe
	 */
	subscribe (onChange) {
		const sb = supabase()
		const channel = sb
			.channel('door-states')
			.on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => {
				try { onChange() } catch (e) { console.warn('[DoorStateRepo] onChange threw:', e) }
			})
			.subscribe()
		return () => { try { sb.removeChannel(channel) } catch { /* ignore */ } }
	},
}

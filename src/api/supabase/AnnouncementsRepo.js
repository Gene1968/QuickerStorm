/**
 * Supabase AnnouncementsRepo — same surface as the SP version.
 * Returns SP-shaped items (PascalCase) so useAnnouncements doesn't care.
 */
import { supabase } from './client.js'
import { AuthRepo } from './AuthRepo.js'

const TABLE = 'announcements'

function toSpRow(row) {
	return {
		Id:        row.id,
		Title:     row.title,
		RoomId:    row.room_id,
		RoomName:  row.room_name,
		SentBy:    row.sent_by,
		ExpiresAt: row.expires_at,
		Created:   row.created_at,
	}
}

export const AnnouncementsRepo = {
	backend: 'supabase',

	async listActive() {
		await AuthRepo.ready()
		const sb = supabase()
		const nowIso = new Date().toISOString()
		const { data, error } = await sb
			.from(TABLE)
			.select('id,title,room_id,room_name,sent_by,expires_at,created_at')
			.gt('expires_at', nowIso)
			.order('id', { ascending: false })
			.limit(5)
		if (error) throw error
		return (data || []).map(toSpRow)
	},

	async create({ message, roomId, roomName, sentBy, expiresAt }) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.from(TABLE).insert({
			title:      message,
			room_id:    roomId,
			room_name:  roomName,
			sent_by:    sentBy,
			expires_at: expiresAt,
		})
		if (error) throw error
	},

	subscribe(onChange) {
		const sb = supabase()
		const channel = sb
			.channel('announcements')
			.on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => {
				try { onChange() } catch (e) { console.warn('[supabase/announcements] onChange threw:', e) }
			})
			.subscribe()
		return () => { try { sb.removeChannel(channel) } catch { /* ignore */ } }
	},
}

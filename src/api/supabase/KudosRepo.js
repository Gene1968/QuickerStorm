/**
 * Supabase KudosRepo — short shout-outs between teammates.
 * Returns SP-shaped rows (PascalCase) so consumers stay backend-agnostic.
 */
import { supabase } from './client.js'
import { AuthRepo } from './AuthRepo.js'

const TABLE = 'kudos'

function toSpRow(row) {
	return {
		Id:         row.id,
		FromUserId: row.from_user_id,
		ToUserId:   row.to_user_id,
		Message:    row.message,
		Created:    row.created_at,
	}
}

export const KudosRepo = {
	backend: 'supabase',

	async list({ limit = 50 } = {}) {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb
			.from(TABLE)
			.select('id,from_user_id,to_user_id,message,created_at')
			.order('created_at', { ascending: false })
			.limit(limit)
		if (error) throw error
		return (data || []).map(toSpRow)
	},

	async forUser(userId, { limit = 50 } = {}) {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb
			.from(TABLE)
			.select('id,from_user_id,to_user_id,message,created_at')
			.eq('to_user_id', userId)
			.order('created_at', { ascending: false })
			.limit(limit)
		if (error) throw error
		return (data || []).map(toSpRow)
	},

	async create({ ToUserId, Message }) {
		await AuthRepo.ready()
		const sb = supabase()
		const { data: { user } } = await sb.auth.getUser()
		if (!user?.id) throw new Error('not signed in')
		if (String(user.id) === String(ToUserId)) throw new Error('cannot kudos self')
		const { error } = await sb.from(TABLE).insert({
			from_user_id: user.id,
			to_user_id:   ToUserId,
			message:      Message,
		})
		if (error) throw error
	},

	async remove(id) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.from(TABLE).delete().eq('id', id)
		if (error) throw error
	},

	subscribe(onChange) {
		const sb = supabase()
		const channel = sb
			.channel('kudos')
			.on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, payload => {
				try { onChange(payload) } catch (e) { console.warn('[supabase/kudos] onChange threw:', e) }
			})
			.subscribe()
		return () => { try { sb.removeChannel(channel) } catch { /* ignore */ } }
	},
}

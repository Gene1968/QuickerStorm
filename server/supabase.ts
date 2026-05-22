/**
 * server/supabase.ts — Server-side Supabase client using service role key.
 *
 * Used for:
 *  • Bootstrapping world state on startup (SELECT recent users)
 *  • Periodic flush (batch UPDATE positions, status, last_seen)
 *  • Immediate writes (chat messages, door states)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
	if (_client) return _client

	const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY

	if (!url || !key) {
		throw new Error(
			'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — ' +
			'set these env vars for the server to connect to Supabase'
		)
	}

	console.log(`[supabase] url: ${url?.slice(0, 30)}…  key prefix: ${key?.slice(0, 15)}…`)

	_client = createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
	})
	return _client
}

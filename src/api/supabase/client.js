/**
 * Supabase client singleton.
 *
 * Created lazily so the @supabase/supabase-js bundle is only pulled in when
 * something actually calls supabase(). Reads VITE_SUPABASE_URL and
 * VITE_SUPABASE_PUBLISHABLE_KEY from the active env file.
 *
 * The publishable key is safe in the browser; row-level security on the
 * database enforces who can read/write what.
 */
import { createClient } from '@supabase/supabase-js'

let _client = null

export function supabase() {
	if (_client) return _client

	const url = import.meta.env.VITE_SUPABASE_URL
	const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
		|| import.meta.env.VITE_SUPABASE_ANON_KEY  // legacy name fallback

	if (!url || !key) {
		throw new Error(
			'[supabase] VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set'
		)
	}

	_client = createClient(url, key, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			// AuthRepo.init() manually calls exchangeCodeForSession() when ?code= is
			// present, so automatic URL detection is disabled to prevent the code
			// being consumed twice (double-exchange returns an error and clears the session).
			detectSessionInUrl: false,
			// PKCE returns the auth code as ?code=... (query string). The default
			// implicit flow returns it as #access_token=... (hash fragment), which
			// the app's hash-based router immediately overwrites — so the tokens
			// are lost before supabase-js can read them.
			flowType: 'pkce',
		},
		realtime: {
			params: { eventsPerSecond: 20 },
		},
	})

	return _client
}

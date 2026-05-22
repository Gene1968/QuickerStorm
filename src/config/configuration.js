/**
 * Minimal app config.
 *
 * The only reason this file still exists is that a handful of UI components
 * call ListApi(config.siteUrl, 'listname'). ListApi now routes to Supabase
 * PostgREST and ignores the first argument entirely, so config.siteUrl is
 * effectively a compile-time shim — kept as an empty string so the call
 * signatures don't have to change.
 *
 * listSiteUrl() is retained for the same reason — a couple of orphan
 * components (Metrics.vue, AuthStore.js) still import it but aren't mounted
 * at runtime. Removing the export would break their static analysis; it
 * doesn't need to do anything useful.
 */
export const config = {
	siteUrl: '',
	lists: {
		users:         { listName: 'users' },
		announcements: { listName: 'announcements' },
	},
}

export function listSiteUrl () { return '' }

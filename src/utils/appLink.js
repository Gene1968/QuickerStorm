/**
 * Helpers for SharePoint “apps” list URLs (OfficeShelf, AppGrid).
 *
 * **`appNavigationUrl`:** rewrites `http://` / `https://` to `//` so the browser
 * picks the scheme from the parent page (http on localhost, https on stg/prod).
 */

/** `https://host/path` → `//host/path`. Leaves `mailto:`, `data:`, existing `//`, etc. */
export function appNavigationUrl (url) {
	if (!url || typeof url !== 'string') return url
	const t = url.trim()
	if (t.startsWith('//')) return t
	try {
		const u = new URL(t, window.location.href)
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return t
		return `//${u.host}${u.pathname}${u.search}${u.hash}`
	} catch {
		return url
	}
}

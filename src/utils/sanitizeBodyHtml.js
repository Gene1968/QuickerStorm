/**
 * sanitizeBodyHtml — DOMParser-based sanitizer + wrapper used by both the
 * phone Mail body and the phone Calendar event description iframes.
 *
 * - Strips <script>, <iframe>, <object>, <embed>, <applet>, <noscript>.
 * - Strips inline event handlers (on*).
 * - Neutralizes javascript: URLs.
 * - Wraps the cleaned HTML in a self-contained document with <base target="_blank">
 *   so every link inside opens in a new tab (sandbox needs `allow-popups` for
 *   that to actually take effect).
 */

const SCRIPTABLE_TAGS = ['script', 'iframe', 'object', 'embed', 'applet', 'noscript']

/**
 * Return a sanitized HTML string with no script-execution surfaces.
 * Uses DOMParser so we don't have to worry about regex edge cases (mixed
 * case, attributes with `>` in them, weird whitespace, etc.).
 */
export function sanitizeHtml(html) {
	if (!html) return ''
	let doc
	try {
		doc = new DOMParser().parseFromString(html, 'text/html')
	} catch {
		return ''
	}
	for (const sel of SCRIPTABLE_TAGS) {
		doc.querySelectorAll(sel).forEach(el => el.remove())
	}
	doc.querySelectorAll('*').forEach(el => {
		for (const attr of [...el.attributes]) {
			const name = attr.name.toLowerCase()
			const value = attr.value || ''
			if (name.startsWith('on')) {
				el.removeAttribute(attr.name)
				continue
			}
			if ((name === 'href' || name === 'src' || name === 'action' || name === 'formaction') && /^\s*javascript:/i.test(value)) {
				el.setAttribute(attr.name, '#')
			}
		}
	})
	return doc.body?.innerHTML || ''
}

/**
 * Wrap a sanitized HTML body in a complete document that:
 *  - sets <base target="_blank"> so anchors open in a new tab
 *  - applies a clean phone-friendly stylesheet so the iframe content fits
 *  - does NOT introduce any script-execution surfaces
 *
 * Pair with iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
 * on the iframe element so the popups actually open.
 */
export function wrapAsIframeDoc(bodyHtml, { padding = '0.5rem 0' } = {}) {
	return `<!doctype html><html><head>
<meta charset="utf-8">
<base target="_blank">
<style>
	body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 0.8125rem; line-height: 1.55; color: #0f172a; margin: 0; padding: ${padding}; word-wrap: break-word; }
	p { margin: 0 0 0.5rem; }
	a { color: #2563eb; text-decoration: underline; word-break: break-word; }
	img { max-width: 100%; height: auto; }
	ul, ol { margin: 0 0 0.5rem; padding-left: 1.25rem; }
	li { margin: 0.125rem 0; }
	pre, code { background: #f1f5f9; padding: 0.0625rem 0.25rem; border-radius: 0.1875rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; }
	pre { padding: 0.5rem; overflow-x: auto; }
	blockquote { margin: 0 0 0.5rem; padding: 0.25rem 0.625rem; border-left: 3px solid #cbd5e1; color: #475569; }
	table { border-collapse: collapse; max-width: 100%; }
	td, th { padding: 0.25rem 0.375rem; border: 1px solid #e2e8f0; }
</style></head><body>${bodyHtml}</body></html>`
}

/**
 * Convenience: turn a plain-text blob into HTML with URLs auto-linkified
 * and newlines preserved as <br>. Safe to feed straight into wrapAsIframeDoc.
 */
export function plainTextToHtml(text) {
	if (!text) return ''
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1">$1</a>')
		.replace(/\n/g, '<br>')
}

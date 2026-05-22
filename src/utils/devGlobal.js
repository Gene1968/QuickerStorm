/**
 * Global dev-only logging — import once from main.js; use `dev.log(...)` anywhere without importing.
 * Production builds: all methods are no-ops (Vite inlines import.meta.env.DEV === false).
 */

const noop = () => {}

if (import.meta.env.DEV) {
	globalThis.dev = {
		log: (...args) => console.log(...args),
		warn: (...args) => console.warn(...args),
		error: (...args) => console.error(...args),
		info: (...args) => console.info(...args),
		debug: (...args) => console.debug(...args),
		/** `window.alert`, dev only — not on `console`; use sparingly. */
		alert: (message) => window.alert(message),
	}
} else {
	globalThis.dev = {
		log: noop,
		warn: noop,
		error: noop,
		info: noop,
		debug: noop,
		alert: noop,
	}
}

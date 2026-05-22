/**
 * useVersionCheck — polls version.json every 5 minutes and sets updateAvailable
 * when the deployed build differs from the one currently running.
 * No-ops in dev mode (HMR handles updates there).
 */
import { ref, onUnmounted } from 'vue'

const POLL_MS = 5 * 60 * 1000  // 5 minutes

export function useVersionCheck() {
	const updateAvailable = ref(false)

	if (import.meta.env.DEV) return { updateAvailable }

	// __BUILD_TIME__ is injected by vite.config.js at build time
	const myBuildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null
	if (!myBuildTime) return { updateAvailable }

	async function check() {
		try {
			const res = await fetch(`${import.meta.env.BASE_URL}version.json?_=${Date.now()}`, {
				cache: 'no-store',
			})
			if (!res.ok) return
			const { v } = await res.json()
			if (v && v !== myBuildTime) {
				updateAvailable.value = true
				clearInterval(timer)
			}
		} catch { /* ignore */ }
	}

	// When the tab becomes visible again, re-check for a new build.
	// Never force-reload — the user may be mid-conversation, mid-drag, etc.
	// The banner (driven by updateAvailable) asks them to reload when ready.
	function onVisible() {
		if (document.visibilityState !== 'visible') return
		if (updateAvailable.value) return   // banner is already showing; don't re-check
		check()
	}

	// Check immediately on load, then on every interval and every tab-focus
	check()
	const timer = setInterval(check, POLL_MS)
	document.addEventListener('visibilitychange', onVisible)

	onUnmounted(() => {
		clearInterval(timer)
		document.removeEventListener('visibilitychange', onVisible)
	})

	return { updateAvailable }
}

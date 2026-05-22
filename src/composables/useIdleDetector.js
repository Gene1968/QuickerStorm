/**
 * useIdleDetector — automatically sets the local user's status to 'away'
 * when they appear inactive, and restores it when they return.
 *
 * Two-tier thresholds:
 *   • IDLE_MS / HIDDEN_MS  → away (status change only)
 *   • PAUSE_MS             → paused after 2 h (WS disconnect + modal)
 *
 * Only transitions from 'online'; does not override user-set 'busy' or 'away'.
 * Calls onStatusChange() on every transition so the caller can fire a heartbeat.
 * Calls onPause() when the pause threshold is reached.
 */
import { onMounted, onUnmounted } from 'vue'
import { useAvatarStore } from '@/stores/avatarStore.js'

const IDLE_MS    = 30 * 60 * 1000  // 30 minutes of no input → away
const HIDDEN_MS  = 30 * 60 * 1000  // 30 minutes background → away
const PAUSE_MS   = 2 * 60 * 60 * 1000  // 2 hours of no input or hidden → paused

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']

export function useIdleDetector(onStatusChange, onPause) {
	const avatarStore = useAvatarStore()

	let idleTimer   = null
	let hiddenTimer = null
	let pauseTimer  = null
	let isIdle      = false

	function goIdle() {
		if (isIdle || avatarStore.status !== 'online') return
		isIdle = true
		avatarStore.status = 'away'
		onStatusChange?.()
	}

	function goPaused() {
		goIdle()   // ensure status is away first (no-op if already away)
		onPause?.()
	}

	function goActive() {
		clearTimeout(idleTimer)
		clearTimeout(pauseTimer)
		// Restore 'online' if the idle system set away (isIdle) OR if status is
		// stale-away from a previous session / mount cycle that left isIdle = false.
		if (isIdle || avatarStore.status === 'away') {
			isIdle = false
			avatarStore.status = 'online'
			onStatusChange?.()
		}
		idleTimer  = setTimeout(goIdle,   IDLE_MS)
		pauseTimer = setTimeout(goPaused, PAUSE_MS)
	}

	function onVisibilityChange() {
		if (document.hidden) {
			// Grace periods — brief alt-tabs shouldn't flip status or pause
			hiddenTimer = setTimeout(goIdle,   HIDDEN_MS)
			clearTimeout(pauseTimer)
			pauseTimer  = setTimeout(goPaused, PAUSE_MS)
		} else {
			clearTimeout(hiddenTimer)
			clearTimeout(pauseTimer)
			hiddenTimer = null
			goActive()
		}
	}

	onMounted(() => {
		// Fresh mount = user is present. Clear any stale 'away' or 'offline' from a
		// prior session — 'offline' can persist in localStorage from before the tab closed.
		if (avatarStore.status === 'away' || avatarStore.status === 'offline') {
			avatarStore.status = 'online'
			onStatusChange?.()
		}
		ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, goActive, { passive: true }))
		document.addEventListener('visibilitychange', onVisibilityChange)
		// Start both countdown timers immediately
		idleTimer  = setTimeout(goIdle,   IDLE_MS)
		pauseTimer = setTimeout(goPaused, PAUSE_MS)
		// If the page was loaded into a hidden tab, apply the same grace periods
		if (document.hidden) {
			hiddenTimer = setTimeout(goIdle,   HIDDEN_MS)
			// pauseTimer already set above
		}
	})

	onUnmounted(() => {
		clearTimeout(idleTimer)
		clearTimeout(hiddenTimer)
		clearTimeout(pauseTimer)
		ACTIVITY_EVENTS.forEach(ev => document.removeEventListener(ev, goActive))
		document.removeEventListener('visibilitychange', onVisibilityChange)
	})
}

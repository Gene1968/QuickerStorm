// src/composables/useOfferThrottle.js — rolling-window throttle for auto-opened texture previews.
//
// FS parity (phoenix-firestorm llviewermessage.cpp inventory_offer_handler): when items pour in,
// auto-opening a preview for every offered texture would flood the screen. FS caps auto-opens to
// OFFER_THROTTLE_MAX_COUNT within OFFER_THROTTLE_TIME and, on the first suppressed offer of a
// window, posts ONE chat notice ("Items received too quickly…"). MANUAL double-click opens do NOT
// go through this path, so they always bypass the throttle.
import { useChatStore } from '@/stores/chatStore'

export const OFFER_THROTTLE_TIME = 10000  // ms — rolling window length
export const OFFER_THROTTLE_MAX_COUNT = 5 // auto-opens allowed per window

// Module-level window state (shared across all callers, like FS's static counters).
let windowStart = 0
let windowCount = 0
let noticePostedThisWindow = false

// WHY: injectable clock + chat sink so the unit test can drive time + observe the notice without a
// live pinia store or real wall-clock. Defaults use the app runtime (performance.now / chatStore).
function _defaultNow() {
	return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}
function _defaultPostNotice() {
	useChatStore().addMessage({
		fromName: 'System',
		message: 'Items received too quickly — previews suppressed.',
		chatType: 0,
	})
}

/**
 * checkOfferThrottle — call once per AUTO-open attempt.
 * @returns {boolean} true = allow the auto-open, false = suppress it.
 *
 * Behaviour per window:
 *  • first call, or >OFFER_THROTTLE_TIME since the window opened → reset (count=1) and allow.
 *  • count already at the max → suppress; post ONE chat notice for this window.
 *  • otherwise → count++ and allow.
 *
 * @param {object} [opts]
 * @param {() => number} [opts.now]        clock source (ms); defaults to performance.now.
 * @param {() => void}   [opts.postNotice] system-chat sink for the suppression notice.
 */
export function checkOfferThrottle(opts = {}) {
	const now = (opts.now || _defaultNow)()
	const postNotice = opts.postNotice || _defaultPostNotice

	if (windowStart === 0 || now - windowStart > OFFER_THROTTLE_TIME) {
		// New window.
		windowStart = now
		windowCount = 1
		noticePostedThisWindow = false
		return true
	}
	if (windowCount >= OFFER_THROTTLE_MAX_COUNT) {
		// WHY: only one notice per exhausted window — otherwise a burst of 50 offers posts 50 lines.
		if (!noticePostedThisWindow) {
			noticePostedThisWindow = true
			postNotice()
		}
		return false
	}
	windowCount++
	return true
}

// WHY: test hook — reset module state between cases so windows don't leak across tests.
export function _resetOfferThrottle() {
	windowStart = 0
	windowCount = 0
	noticePostedThisWindow = false
}

// src/composables/useOfferThrottle.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
	checkOfferThrottle,
	_resetOfferThrottle,
	OFFER_THROTTLE_TIME,
	OFFER_THROTTLE_MAX_COUNT,
} from './useOfferThrottle'

describe('checkOfferThrottle', () => {
	let clock
	let notices
	let opts

	beforeEach(() => {
		_resetOfferThrottle()
		clock = 1000
		notices = 0
		opts = {
			now: () => clock,
			postNotice: () => { notices++ },
		}
	})

	it('allows the first MAX_COUNT auto-opens in a window', () => {
		for (let i = 0; i < OFFER_THROTTLE_MAX_COUNT; i++) {
			expect(checkOfferThrottle(opts)).toBe(true)
		}
		expect(notices).toBe(0)
	})

	it('suppresses the 6th (MAX_COUNT+1) auto-open in the same window', () => {
		for (let i = 0; i < OFFER_THROTTLE_MAX_COUNT; i++) checkOfferThrottle(opts)
		expect(checkOfferThrottle(opts)).toBe(false)
		expect(notices).toBe(1)
	})

	it('posts the suppression notice only ONCE per exhausted window', () => {
		for (let i = 0; i < OFFER_THROTTLE_MAX_COUNT; i++) checkOfferThrottle(opts)
		// Several more suppressed attempts within the same window.
		checkOfferThrottle(opts)
		checkOfferThrottle(opts)
		checkOfferThrottle(opts)
		expect(notices).toBe(1)
	})

	it('resets and allows again after the window elapses', () => {
		for (let i = 0; i < OFFER_THROTTLE_MAX_COUNT; i++) checkOfferThrottle(opts)
		expect(checkOfferThrottle(opts)).toBe(false)
		// Advance just past the window.
		clock += OFFER_THROTTLE_TIME + 1
		expect(checkOfferThrottle(opts)).toBe(true)   // new window, count = 1
		// And the notice can fire again in the new exhausted window.
		for (let i = 1; i < OFFER_THROTTLE_MAX_COUNT; i++) checkOfferThrottle(opts)
		expect(checkOfferThrottle(opts)).toBe(false)
		expect(notices).toBe(2)
	})

	it('does NOT reset while still inside the window', () => {
		for (let i = 0; i < OFFER_THROTTLE_MAX_COUNT; i++) checkOfferThrottle(opts)
		clock += OFFER_THROTTLE_TIME - 1   // still inside window
		expect(checkOfferThrottle(opts)).toBe(false)
	})

	it('uses the default clock/notice sink when no opts given', () => {
		// Smoke test: default path must not throw even without a pinia store for the notice, since
		// the first MAX_COUNT calls never post a notice.
		for (let i = 0; i < OFFER_THROTTLE_MAX_COUNT; i++) {
			expect(() => checkOfferThrottle()).not.toThrow()
		}
	})
})

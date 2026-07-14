import { describe, it, expect } from 'vitest'
import {
	pickStalledFetches,
	FETCH_STALL_TIMEOUT_MS, FETCH_MAX_RETRIES,
} from '@/composables/useInventory.js'

// pickStalledFetches(fetchingSince: Map<id,startedAtMs>, retries: Map<id,count>, now, opts)
// → { retry: id[], giveUp: id[] }. Pure; the lost-message watchdog's decision core.

const OPTS = { timeoutMs: FETCH_STALL_TIMEOUT_MS, maxRetries: FETCH_MAX_RETRIES }

describe('pickStalledFetches', () => {
	it('leaves fetches that are still inside the timeout window alone', () => {
		const since = new Map([['a', 0], ['b', 1_000]])
		const { retry, giveUp } = pickStalledFetches(since, new Map(), 5_000, OPTS)
		expect(retry).toEqual([])
		expect(giveUp).toEqual([])
	})

	it('retries a stalled fetch that still has retry budget', () => {
		const since = new Map([['a', 0]])
		// now = timeout exactly → stalled; 0 retries spent, budget remains
		const { retry, giveUp } = pickStalledFetches(since, new Map(), FETCH_STALL_TIMEOUT_MS, OPTS)
		expect(retry).toEqual(['a'])
		expect(giveUp).toEqual([])
	})

	it('gives up on a stalled fetch once retries are exhausted', () => {
		const since = new Map([['a', 0]])
		const retries = new Map([['a', FETCH_MAX_RETRIES]])
		const { retry, giveUp } = pickStalledFetches(since, retries, FETCH_STALL_TIMEOUT_MS + 1, OPTS)
		expect(retry).toEqual([])
		expect(giveUp).toEqual(['a'])
	})

	it('does not race the reply: one ms under the timeout is not stalled', () => {
		const since = new Map([['a', 0]])
		const { retry, giveUp } = pickStalledFetches(since, new Map(), FETCH_STALL_TIMEOUT_MS - 1, OPTS)
		expect(retry).toEqual([])
		expect(giveUp).toEqual([])
	})

	it('partitions a mixed set by age and remaining budget', () => {
		const now = 100_000
		const since = new Map([
			['fresh',  now - 1_000],                     // within window
			['retry1', now - FETCH_STALL_TIMEOUT_MS],    // stalled, budget left
			['dead',   now - FETCH_STALL_TIMEOUT_MS * 3],// stalled, budget exhausted
		])
		const retries = new Map([['retry1', 1], ['dead', FETCH_MAX_RETRIES]])
		const { retry, giveUp } = pickStalledFetches(since, retries, now, OPTS)
		expect(retry).toEqual(['retry1'])
		expect(giveUp).toEqual(['dead'])
	})

	it('is a no-op for an empty in-flight set', () => {
		const { retry, giveUp } = pickStalledFetches(new Map(), new Map(), 999_999, OPTS)
		expect(retry).toEqual([])
		expect(giveUp).toEqual([])
	})

	it('the default timeout sits above the server 25s cap timeout (no duplicate-fetch race)', () => {
		expect(FETCH_STALL_TIMEOUT_MS).toBeGreaterThan(25_000)
	})
})

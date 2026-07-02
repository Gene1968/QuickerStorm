import { describe, it, expect } from 'bun:test'
import { findGhosts, ghostReconcileReady } from './ghostReconcile'

describe('findGhosts', () => {
	it('returns clientCached ids absent from distinctLocalIds', () => {
		const client = new Set([1, 2, 3, 4])
		const distinct = new Set([2, 4])
		expect(findGhosts(client, distinct).sort()).toEqual([1, 3])
	})
	it('returns [] when every cached id is still live', () => {
		expect(findGhosts(new Set([1, 2]), new Set([1, 2, 9]))).toEqual([])
	})
	it('returns [] for a null clientCached', () => {
		expect(findGhosts(null, new Set([1]))).toEqual([])
	})
	it('returns [] for an empty clientCached', () => {
		expect(findGhosts(new Set(), new Set([1]))).toEqual([])
	})
})

describe('ghostReconcileReady', () => {
	const ok = { hasClientCached: true, done: false, msSinceProbe: 4000, msSinceLogin: 6000 }
	it('is ready when all gates pass', () => {
		expect(ghostReconcileReady(ok)).toBe(true)
	})
	it('is not ready without a client cached set', () => {
		expect(ghostReconcileReady({ ...ok, hasClientCached: false })).toBe(false)
	})
	it('is not ready once already done', () => {
		expect(ghostReconcileReady({ ...ok, done: true })).toBe(false)
	})
	it('is not ready while probes still stream (quiet < 3s)', () => {
		expect(ghostReconcileReady({ ...ok, msSinceProbe: 1000 })).toBe(false)
	})
	it('is not ready during the initial flood (login < 5s)', () => {
		expect(ghostReconcileReady({ ...ok, msSinceLogin: 2000 })).toBe(false)
	})
})

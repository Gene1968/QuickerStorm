import { describe, it, expect } from 'vitest'
import { shouldEvictOnKill } from '@/lib/killPolicy'

describe('shouldEvictOnKill', () => {
	it('evicts on a genuine delete (cull false)', () => {
		expect(shouldEvictOnKill({ cull: false, keepCacheEnv: false })).toBe(true)
	})
	it('keeps the descriptor on an interest cull', () => {
		expect(shouldEvictOnKill({ cull: true, keepCacheEnv: false })).toBe(false)
	})
	it('keeps the descriptor when the keep-cache env override is set', () => {
		expect(shouldEvictOnKill({ cull: false, keepCacheEnv: true })).toBe(false)
	})
	it('treats a missing cull flag as a delete (back-compat with old server frames)', () => {
		expect(shouldEvictOnKill({ cull: undefined, keepCacheEnv: false })).toBe(true)
	})
	it('evicts when deleted=true, even with keepCacheEnv (confirmed-dead reconciliation)', () => {
		expect(shouldEvictOnKill({ deleted: true, cull: true, keepCacheEnv: true })).toBe(true)
	})
	it('falls through to existing logic when deleted is absent', () => {
		expect(shouldEvictOnKill({ cull: true, keepCacheEnv: false })).toBe(false)
	})
})

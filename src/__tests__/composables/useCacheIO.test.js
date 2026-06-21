import { describe, it, expect, vi } from 'vitest'
import { useCacheIO } from '@/composables/useCacheIO.js'

describe('useCacheIO fallback', () => {
	it('is dead without a usable Worker and resolves via the provided fallback', async () => {
		const io = useCacheIO()
		io.__killForTest()
		expect(io.isDead()).toBe(true)
		const fallback = vi.fn(async () => 'FELL_BACK')
		const r = await io.request({ op: 'geomStats' }, [], fallback)
		expect(fallback).toHaveBeenCalledTimes(1)
		expect(r).toBe('FELL_BACK')
	})
})

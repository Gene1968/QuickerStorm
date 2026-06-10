import { describe, it, expect } from 'vitest'
import { selectLiveFailed, TEX_FAILED_TTL_MS } from '@/lib/textureCache.js'

describe('selectLiveFailed', () => {
	const now = 1_000_000_000_000
	it('keeps failures within the TTL window', () => {
		const rows = [{ uuid: 'a', ts: now - 1000 }, { uuid: 'b', ts: now - (TEX_FAILED_TTL_MS - 1) }]
		expect(selectLiveFailed(rows, now, TEX_FAILED_TTL_MS).sort()).toEqual(['a', 'b'])
	})
	it('drops failures older than the TTL', () => {
		const rows = [{ uuid: 'old', ts: now - (TEX_FAILED_TTL_MS + 1) }]
		expect(selectLiveFailed(rows, now, TEX_FAILED_TTL_MS)).toEqual([])
	})
	it('ignores malformed rows', () => {
		expect(selectLiveFailed([null, {}, { uuid: 'x' }, { uuid: 'y', ts: now }], now, TEX_FAILED_TTL_MS)).toEqual(['y'])
	})
})

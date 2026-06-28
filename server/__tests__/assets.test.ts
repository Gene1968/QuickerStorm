import { describe, it, expect } from 'bun:test'
import { assetRequestSpec, assetRetryDecision } from '../handlers/assets'

// WHY: the query-key/cap-name mapping is exactly the class of detail that has cost us hours when
// guessed wrong (wrong param name → silent 404). Pin it down with a unit test.
describe('assetRequestSpec', () => {
	it('texture → texture_id, prefers ViewerAsset then GetTexture, transcodes to WebP', () => {
		const s = assetRequestSpec('texture')!
		expect(s.queryKey).toBe('texture_id')
		expect(s.capNames).toEqual(['ViewerAsset', 'GetTexture'])
		expect(s.accept).toBe('image/x-j2c')
		expect(s.transcode).toBe(true)
		expect(s.mime).toBe('image/webp')
	})

	it('mesh → mesh_id, ViewerAsset/GetMesh2/GetMesh, no transcode', () => {
		const s = assetRequestSpec('mesh')!
		expect(s.queryKey).toBe('mesh_id')
		expect(s.capNames).toEqual(['ViewerAsset', 'GetMesh2', 'GetMesh'])
		expect(s.transcode).toBe(false)
	})

	it('sound → sound_id via ViewerAsset, no transcode', () => {
		const s = assetRequestSpec('sound')!
		expect(s.queryKey).toBe('sound_id')
		expect(s.capNames).toEqual(['ViewerAsset'])
		expect(s.transcode).toBe(false)
	})

	it('unknown asset type → null', () => {
		expect(assetRequestSpec('nonsense')).toBe(null)
	})
})

// WHY (R2): this grid serves 100+ permanently-missing assets. The retry policy must never retry a
// 404 (it will never appear) but MUST retry transient failures a bounded number of times. Backoff is
// [250, 750] → 2 retries, so attempts 0 and 1 have budget, attempt 2 does not.
describe('assetRetryDecision', () => {
	it('404 → dead on every attempt, never retried', () => {
		expect(assetRetryDecision({ kind: 'status', status: 404 }, 0)).toBe('dead')
		expect(assetRetryDecision({ kind: 'status', status: 404 }, 1)).toBe('dead')
		expect(assetRetryDecision({ kind: 'status', status: 404 }, 5)).toBe('dead')
	})

	it('network error → retry while budget remains, then fail', () => {
		expect(assetRetryDecision({ kind: 'network' }, 0)).toBe('retry')
		expect(assetRetryDecision({ kind: 'network' }, 1)).toBe('retry')
		expect(assetRetryDecision({ kind: 'network' }, 2)).toBe('fail')
	})

	it('5xx → retry while budget remains, then fail', () => {
		expect(assetRetryDecision({ kind: 'status', status: 500 }, 0)).toBe('retry')
		expect(assetRetryDecision({ kind: 'status', status: 503 }, 1)).toBe('retry')
		expect(assetRetryDecision({ kind: 'status', status: 502 }, 2)).toBe('fail')
	})

	it('non-transient 4xx (401/403/410) → fail immediately, not dead, not retried', () => {
		expect(assetRetryDecision({ kind: 'status', status: 401 }, 0)).toBe('fail')
		expect(assetRetryDecision({ kind: 'status', status: 403 }, 0)).toBe('fail')
		expect(assetRetryDecision({ kind: 'status', status: 410 }, 0)).toBe('fail')
	})
})

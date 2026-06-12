import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { pickWorkerIndex, decodeInPool, getPoolStats } from '../lib/j2cPool'

// Real SL terrain texture codestream — exercises the actual decode path end-to-end, not a mock.
// Lives in fixtures/ since the runtime copy was replaced by .webp (terrain texturing, 17b14d4).
// join(import.meta.dir, …) resolves relative to this file regardless of cwd.
const fixture = readFileSync(join(import.meta.dir, 'fixtures/terrain-dirt.j2c'))

describe('pickWorkerIndex', () => {
	it('returns 0 for empty input (never indexes out of range)', () => {
		expect(pickWorkerIndex([])).toBe(0)
	})
	it('returns the index of the least-busy worker', () => {
		expect(pickWorkerIndex([3, 1, 2])).toBe(1)
		expect(pickWorkerIndex([0, 5, 9])).toBe(0)
		expect(pickWorkerIndex([4, 4, 0])).toBe(2)
	})
	it('returns the first index on ties', () => {
		expect(pickWorkerIndex([2, 2, 2])).toBe(0)
		expect(pickWorkerIndex([1, 1, 0, 0])).toBe(2)
	})
})

describe('decodeInPool', () => {
	it('decodes a J2C codestream to a valid WebP (via pool or inline fallback)', async () => {
		const r = await decodeInPool(fixture)
		// WHY container-magic check (not a magick round-trip): the decode may have run in a worker
		// thread, so this process's ImageMagick instance is not necessarily initialized here.
		expect(r.image.subarray(0, 4).toString('latin1')).toBe('RIFF')
		expect(r.image.subarray(8, 12).toString('latin1')).toBe('WEBP')
		expect(r.width).toBe(128)
		expect(r.height).toBe(128)
		expect(r.srcWidth).toBe(128)
		expect(r.srcHeight).toBe(128)
		expect(r.hasAlpha).toBe(false)
	})

	it('rejects with the underlying decode error for a non-J2C buffer', async () => {
		await expect(decodeInPool(Buffer.from('not a codestream'))).rejects.toThrow()
	})

	it('reports pool stats without throwing', () => {
		const s = getPoolStats()
		expect(typeof s.workers).toBe('number')
		expect(typeof s.inflight).toBe('number')
		expect(typeof s.degraded).toBe('boolean')
	})
})

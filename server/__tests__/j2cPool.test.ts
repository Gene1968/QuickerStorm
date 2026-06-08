import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decode as decodePng } from 'fast-png'
import { pickWorkerIndex, decodeInPool, getPoolStats } from '../lib/j2cPool'

// Real SL terrain texture codestream staged in the repo — exercise the actual decode path end-to-end,
// not a mock. join(import.meta.dir, …) resolves relative to this file regardless of cwd.
const fixture = readFileSync(join(import.meta.dir, '../../src/assets/img/terrain-dirt.j2c'))

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
	it('decodes a J2C codestream to a valid PNG (via pool or inline fallback)', async () => {
		const r = await decodeInPool(fixture)
		const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		expect(r.png.subarray(0, 8).equals(sig)).toBe(true)
		const img = decodePng(r.png)
		expect(img.width).toBe(128)
		expect(img.height).toBe(128)
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

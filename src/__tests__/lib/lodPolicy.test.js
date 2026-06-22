import { describe, it, expect } from 'bun:test'
import { selectLod } from '@/lib/lodPolicy.js'

describe('selectLod', () => {
	it('returns HIGH(0) for a near/large object', () => {
		expect(selectLod(2, 4)).toBe(0)        // s = (2/4)*1.125 = 0.56 >= 0.012
		expect(selectLod(1, 40)).toBe(0)       // s = 0.0281 >= 0.012 → still high (nearby stays high)
	})
	it('steps down through medium/low/lowest as distance grows', () => {
		expect(selectLod(1, 100)).toBe(1)      // s = 0.01125 → medium
		expect(selectLod(1, 300)).toBe(2)      // s = 0.00375 → low
		expect(selectLod(1, 800)).toBe(3)      // s = 0.00141 → lowest
	})
	it('lodFactor scales the switch distance (higher factor = keep detail farther)', () => {
		expect(selectLod(1, 100, 2.0)).toBe(0) // s = 0.0225 → high (vs medium at 1.125)
		expect(selectLod(1, 100)).toBe(1)      // s = 0.01125 → medium at default factor
	})
	it('guards bad inputs → HIGH', () => {
		expect(selectLod(0, 10)).toBe(0)
		expect(selectLod(1, 0)).toBe(0)
		expect(selectLod(1, -5)).toBe(0)
	})
	it('hysteresis: holds current LOD until clearly past the boundary', () => {
		expect(selectLod(1, 100)).toBe(1)              // s = 0.01125 (just under 0.012) → medium
		expect(selectLod(1, 100, 1.125, 0)).toBe(0)    // currently high → hold (within margin)
		expect(selectLod(1, 130, 1.125, 0)).toBe(1)    // s = 0.00865, well past → switch to medium
	})
})

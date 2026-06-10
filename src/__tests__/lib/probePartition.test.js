import { describe, it, expect } from 'bun:test'
import { partitionProbes } from '@/lib/probePartition.js'

describe('partitionProbes', () => {
	it('hit when crc matches, miss when absent or differs', () => {
		const crcMap = new Map([[101, 5555], [202, 6666]])
		const probes = [
			{ localId: 101, crc: 5555 },  // hit
			{ localId: 202, crc: 9999 },  // mismatch → miss
			{ localId: 303, crc: 1 },     // absent → miss
		]
		expect(partitionProbes(probes, crcMap)).toEqual({ hits: [101], misses: [202, 303] })
	})

	it('empty crcMap → all miss', () => {
		const probes = [{ localId: 1, crc: 2 }, { localId: 3, crc: 4 }]
		expect(partitionProbes(probes, new Map())).toEqual({ hits: [], misses: [1, 3] })
	})

	it('probe missing crc → miss', () => {
		const crcMap = new Map([[1, 0]])
		expect(partitionProbes([{ localId: 1 }], crcMap)).toEqual({ hits: [], misses: [1] })
	})

	it('null/undefined probes → empty result', () => {
		expect(partitionProbes(undefined, new Map())).toEqual({ hits: [], misses: [] })
	})
})

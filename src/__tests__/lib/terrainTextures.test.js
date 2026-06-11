import { test, expect } from 'bun:test'
import { resolveTerrainSlot, DEFAULT_TERRAIN_UUIDS, FALLBACK_TERRAIN_URL } from '@/lib/terrainTextures.js'
import { bilerpCorners, layerWeights } from '@/lib/terrainTextures.js'

test('resolveTerrainSlot maps every known default UUID to its exact bundled url', () => {
	for (const [uuid, expectedUrl] of Object.entries(DEFAULT_TERRAIN_UUIDS)) {
		const r = resolveTerrainSlot(uuid)
		expect(r.kind).toBe('default')
		expect(r.url).toBe(expectedUrl)
	}
})

test('resolveTerrainSlot treats an unknown UUID as custom', () => {
	const r = resolveTerrainSlot('00000000-1111-2222-3333-444444444444')
	expect(r.kind).toBe('custom')
	expect(r.uuid).toBe('00000000-1111-2222-3333-444444444444')
})

test('resolveTerrainSlot falls back gracefully for empty string, null, and undefined', () => {
	for (const input of ['', null, undefined]) {
		const r = resolveTerrainSlot(input)
		expect(r.kind).toBe('default')
		expect(r.url).toBe(FALLBACK_TERRAIN_URL)
	}
})

test('bilerpCorners returns the right corner at the corners', () => {
	const c = [10, 20, 30, 40] // [00,01,10,11] = [x][y]
	expect(bilerpCorners(c, 0, 0)).toBeCloseTo(10) // x=0,y=0
	expect(bilerpCorners(c, 0, 1)).toBeCloseTo(20) // x=0,y=1
	expect(bilerpCorners(c, 1, 0)).toBeCloseTo(30) // x=1,y=0
	expect(bilerpCorners(c, 1, 1)).toBeCloseTo(40) // x=1,y=1
})

test('bilerpCorners interpolates the center', () => {
	expect(bilerpCorners([0, 0, 0, 100], 0.5, 0.5)).toBeCloseTo(25)
	// all four corners contribute → mean of the corners at the center
	expect(bilerpCorners([10, 20, 30, 40], 0.5, 0.5)).toBeCloseTo(25)
})

test('layerWeights sums to ~1 and picks the right dominant layer', () => {
	const low  = layerWeights(0,   0, 100, 0)
	const high = layerWeights(100, 0, 100, 0)
	const sum = a => a.reduce((s, v) => s + v, 0)
	expect(sum(low)).toBeCloseTo(1)
	expect(sum(high)).toBeCloseTo(1)
	expect(low[0]).toBeGreaterThan(low[3])
	expect(high[3]).toBeGreaterThan(high[0])
})

test('layerWeights clamps below start and above start+range', () => {
	const below = layerWeights(-50, 0, 100, 0)
	const above = layerWeights(999, 0, 100, 0)
	expect(below[0]).toBeCloseTo(1)
	expect(above[3]).toBeCloseTo(1)
})

test('layerWeights blends adjacent layers mid-band', () => {
	const w = layerWeights(50, 0, 100, 0) // e=0.5 → p=1.5 → layers 1&2
	expect(w[1]).toBeGreaterThan(0)
	expect(w[2]).toBeGreaterThan(0)
	expect(w[0]).toBeCloseTo(0)
	expect(w[3]).toBeCloseTo(0)
})

test('layerWeights guards range=0 without div-by-zero', () => {
	const w = layerWeights(10, 0, 0, 0)
	const sum = w.reduce((s, v) => s + v, 0)
	expect(w.length).toBe(4)
	expect(sum).toBeCloseTo(1)
	expect(w.every(Number.isFinite)).toBe(true)
})

test('layerWeights keeps weights valid when noise pushes e past 0..1', () => {
	const hi = layerWeights(100, 0, 100, 0.5)   // e = 1 + 0.5 → clamps to 1
	const lo = layerWeights(0,   0, 100, -0.5)   // e = 0 - 0.5 → clamps to 0
	expect(hi[3]).toBeCloseTo(1)
	expect(lo[0]).toBeCloseTo(1)
	expect(hi.reduce((s, v) => s + v, 0)).toBeCloseTo(1)
	expect(lo.reduce((s, v) => s + v, 0)).toBeCloseTo(1)
})

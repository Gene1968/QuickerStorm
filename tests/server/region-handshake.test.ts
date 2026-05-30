import { describe, it, expect } from 'vitest'
import { decodeRegionHandshake, uuidToBytes } from '../../server/lib/lludp-codec'

// Build a RegionInfo block in wire order. dataOffset = 0 for the test.
function buildHandshake(opts: {
	simName?: string
	waterHeight?: number
	detail?: string[]
	startHeight?: number[]
	heightRange?: number[]
	regionId?: string
	truncateAfterName?: boolean
}): Buffer {
	const name = opts.simName ?? 'Test Region'
	const parts: Buffer[] = []
	const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v, 0); return b }
	const f32 = (v: number) => { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b }
	const u8  = (v: number) => Buffer.from([v])

	parts.push(u32(0))               // RegionFlags
	parts.push(u8(13))               // SimAccess (PG)
	const nameBuf = Buffer.from(name, 'utf8')
	parts.push(u8(nameBuf.length), nameBuf)  // SimName Var1
	if (opts.truncateAfterName) return Buffer.concat(parts)

	parts.push(uuidToBytes('11111111-1111-1111-1111-111111111111'))  // SimOwner
	parts.push(u8(0))                                                 // IsEstateManager
	parts.push(f32(opts.waterHeight ?? 20))                           // WaterHeight
	parts.push(f32(0))                                                // BillableFactor
	parts.push(uuidToBytes('22222222-2222-2222-2222-222222222222'))  // CacheID
	for (let i = 0; i < 4; i++) parts.push(Buffer.alloc(16))          // TerrainBase0..3 (null)
	const detail = opts.detail ?? ['33333333-3333-3333-3333-333333333333', '', '', '']
	for (let i = 0; i < 4; i++) parts.push(uuidToBytes(detail[i] || '00000000-0000-0000-0000-000000000000'))
	const sh = opts.startHeight ?? [10, 11, 12, 13]
	for (let i = 0; i < 4; i++) parts.push(f32(sh[i]))
	const hr = opts.heightRange ?? [1, 2, 3, 4]
	for (let i = 0; i < 4; i++) parts.push(f32(hr[i]))
	parts.push(uuidToBytes(opts.regionId ?? '44444444-4444-4444-4444-444444444444'))  // RegionInfo2.RegionID
	return Buffer.concat(parts)
}

describe('decodeRegionHandshake', () => {
	it('parses water height, terrain detail textures, and corner blend heights', () => {
		const buf = buildHandshake({
			simName: 'Sandbox',
			waterHeight: 25.5,
			detail: [
				'aaaaaaaa-0000-0000-0000-000000000001',
				'aaaaaaaa-0000-0000-0000-000000000002',
				'aaaaaaaa-0000-0000-0000-000000000003',
				'aaaaaaaa-0000-0000-0000-000000000004',
			],
			startHeight: [10, 20, 30, 40],
			heightRange: [2, 4, 6, 8],
			regionId: '99999999-0000-0000-0000-000000000009',
		})
		const r = decodeRegionHandshake(buf, 0)
		expect(r.simName).toBe('Sandbox')
		expect(r.simAccess).toBe(13)
		expect(r.waterHeight).toBeCloseTo(25.5, 3)
		expect(r.terrainDetail[0]).toBe('aaaaaaaa-0000-0000-0000-000000000001')
		expect(r.terrainDetail[3]).toBe('aaaaaaaa-0000-0000-0000-000000000004')
		expect(r.terrainStartHeight).toEqual([10, 20, 30, 40])
		expect(r.terrainHeightRange).toEqual([2, 4, 6, 8])
		expect(r.regionId).toBe('99999999-0000-0000-0000-000000000009')
	})

	it('returns SL-default water height and empty textures when packet is truncated', () => {
		const buf = buildHandshake({ simName: 'OldSim', truncateAfterName: true })
		const r = decodeRegionHandshake(buf, 0)
		expect(r.simName).toBe('OldSim')
		expect(r.waterHeight).toBe(20)
		expect(r.terrainDetail).toEqual(['', '', '', ''])
		expect(r.regionId).toBe('')
	})
})

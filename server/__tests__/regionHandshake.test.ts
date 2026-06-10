import { describe, it, expect } from 'bun:test'
import { decodeRegionHandshake } from '../lib/lludp-codec'

// Body layout per decodeRegionHandshake: RegionFlags U32 | SimAccess U8 | SimName V1 |
// SimOwner UUID | IsEstateManager U8 | WaterHeight F32 | BillableFactor F32 | CacheID UUID |
// TerrainBase 4×16 | TerrainDetail 4×16 | StartHeight 4×F32 | HeightRange 4×F32 | RegionID UUID
function buildBody(): Buffer {
	const parts: Buffer[] = []
	parts.push(Buffer.alloc(4))                            // RegionFlags
	parts.push(Buffer.from([13]))                          // SimAccess (PG)
	const name = Buffer.from('Test Region\0', 'utf8')
	parts.push(Buffer.from([name.length]), name)           // SimName V1
	parts.push(Buffer.alloc(16))                           // SimOwner
	parts.push(Buffer.from([0]))                           // IsEstateManager
	const wh = Buffer.alloc(4); wh.writeFloatLE(20, 0)
	parts.push(wh)                                         // WaterHeight
	parts.push(Buffer.alloc(4))                            // BillableFactor
	parts.push(Buffer.from('00112233445566778899aabbccddeeff', 'hex')) // CacheID
	parts.push(Buffer.alloc(64))                           // TerrainBase0..3 (legacy)
	parts.push(Buffer.alloc(64))                           // TerrainDetail0..3
	parts.push(Buffer.alloc(16))                           // StartHeight 4×F32
	parts.push(Buffer.alloc(16))                           // HeightRange 4×F32
	parts.push(Buffer.from('ffeeddccbbaa99887766554433221100', 'hex')) // RegionInfo2.RegionID
	return Buffer.concat(parts)
}

describe('decodeRegionHandshake', () => {
	it('extracts CacheID — the sim-run marker that invalidates the client object cache on region restart', () => {
		const rh = decodeRegionHandshake(buildBody(), 0)
		expect(rh.simName).toBe('Test Region')
		expect(rh.cacheId).toBe('00112233-4455-6677-8899-aabbccddeeff')
		expect(rh.regionId).toBe('ffeeddcc-bbaa-9988-7766-554433221100')
	})
})

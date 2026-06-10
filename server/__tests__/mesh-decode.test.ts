import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseSculptExtraParam } from '../lib/lludp-codec'
import { parseMeshHeader, decodeMeshLOD } from '../lib/meshDecode'

const meshAsset = readFileSync(join(import.meta.dir, 'fixtures/mesh-asset.bin'))

describe('parseSculptExtraParam', () => {
	const U = (h: string) => Buffer.from(h.replace(/-/g, ''), 'hex')
	it('reads sculpt UUID + type; flags mesh when type&7==5', () => {
		const uuid = '11223344-5566-7788-99aa-bbccddeeff00'
		const buf = Buffer.concat([U(uuid), Buffer.from([0x05])])   // type 5 = mesh
		expect(parseSculptExtraParam(buf, 0, buf.length)).toEqual({ uuid, sculptType: 5 })
	})
	it('returns null for too-short data', () => {
		expect(parseSculptExtraParam(Buffer.from([1, 2, 3]), 0, 3)).toBe(null)
	})
})

describe('parseMeshHeader', () => {
	it('parses the LLSD-binary header into LOD offset/size + headerSize', () => {
		const h = parseMeshHeader(meshAsset)
		expect(h.headerSize).toBeGreaterThan(0)
		const lod = h.lods.high ?? h.lods.medium ?? h.lods.low ?? h.lods.lowest
		expect(lod).toBeDefined()
		expect(lod!.size).toBeGreaterThan(0)
		expect(h.headerSize + lod!.offset + lod!.size).toBeLessThanOrEqual(meshAsset.length)
	})
})

describe('decodeMeshLOD', () => {
	it('decodes the best LOD into submeshes with valid geometry', () => {
		const h = parseMeshHeader(meshAsset)
		const lod = h.lods.high ?? h.lods.medium ?? h.lods.low ?? h.lods.lowest
		const subs = decodeMeshLOD(meshAsset, h.headerSize, lod!)
		expect(subs.length).toBeGreaterThan(0)
		for (const s of subs) {
			expect(s.positions.length).toBeGreaterThan(0)
			expect(s.positions.length % 3).toBe(0)
			expect(s.indices.length % 3).toBe(0)
			const vtx = s.positions.length / 3
			for (const i of s.indices) expect(i).toBeLessThan(vtx)
			for (const p of s.positions) expect(Number.isFinite(p)).toBe(true)
		}
	})
})

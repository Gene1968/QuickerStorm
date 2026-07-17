import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { deflateSync } from 'zlib'
import { parseSculptExtraParam } from '../lib/lludp-codec'
import { parseMeshHeader, decodeMeshLOD, decodeSkinBlock } from '../lib/meshDecode'

const meshAsset = readFileSync(join(import.meta.dir, 'fixtures/mesh-asset.bin'))

// Minimal LLSD-binary encoder (mirrors the readBin markers in ../lib/llsd.ts) for building a synthetic
// skin block — the captured mesh-asset.bin fixture is a static prim mesh with no rig, so we hand-roll one.
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const llReal = (n: number) => { const b = Buffer.alloc(9); b[0] = 0x72 /* 'r' */; b.writeDoubleBE(n, 1); return b }
const llInt = (n: number) => { const b = Buffer.alloc(5); b[0] = 0x69 /* 'i' */; b.writeInt32BE(n, 1); return b }
const llStr = (s: string) => Buffer.concat([Buffer.from([0x73 /* 's' */]), u32(Buffer.byteLength(s)), Buffer.from(s, 'utf8')])
const llBool = (v: boolean) => Buffer.from([v ? 0x31 : 0x30])
const llArr = (elems: Buffer[]) => Buffer.concat([Buffer.from([0x5b /* '[' */]), u32(elems.length), ...elems, Buffer.from([0x5d /* ']' */])])
const llBin = (b: Buffer) => Buffer.concat([Buffer.from([0x62 /* 'b' */]), u32(b.length), b])
const llRealArr = (ns: number[]) => llArr(ns.map(llReal))
const llMap = (entries: [string, Buffer][]) => Buffer.concat([
	Buffer.from([0x7b /* '{' */]), u32(entries.length),
	...entries.flatMap(([k, v]) => [Buffer.from([0x6b /* 'k' */]), u32(Buffer.byteLength(k)), Buffer.from(k, 'utf8'), v]),
	Buffer.from([0x7d /* '}' */]),
])

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

describe('skin block', () => {
	// bind_shape_matrix is stored row-major; a non-identity value (scale 2 + translate) proves we keep order.
	const bsm = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0.5, 1.5, 2.5, 1]
	const ibm = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
	const skinDeflated = deflateSync(llMap([
		['joint_names', llArr([llStr('mPelvis'), llStr('mTorso')])],
		['bind_shape_matrix', llRealArr(bsm)],
		['inverse_bind_matrix', llArr([llRealArr(ibm), llRealArr(ibm)])],
		['pelvis_offset', llReal(1.25)],
		['lock_scale_if_joint_position', llBool(true)],
	]))

	it('parseMeshHeader surfaces the skin ref when present, undefined when absent', () => {
		expect(parseMeshHeader(meshAsset).skin).toBeUndefined()   // fixture is a static prim mesh
		const hdr = llMap([
			['high_lod', llMap([['offset', llInt(0)], ['size', llInt(4)]])],
			['skin', llMap([['offset', llInt(4)], ['size', llInt(skinDeflated.length)]])],
		])
		const h = parseMeshHeader(hdr)
		expect(h.skin).toBeDefined()
		expect(h.skin!.offset).toBe(4)
		expect(h.skin!.size).toBe(skinDeflated.length)
	})

	it('decodeSkinBlock extracts joint names + row-major bind-shape matrix', () => {
		const si = decodeSkinBlock(skinDeflated, 0, { offset: 0, size: skinDeflated.length })
		expect(si).not.toBeNull()
		expect(si!.jointNames).toEqual(['mPelvis', 'mTorso'])
		expect(si!.bindShapeMatrix).toEqual(bsm)
		expect(si!.inverseBindMatrix.length).toBe(2)
		expect(si!.pelvisOffset).toBeCloseTo(1.25)
		expect(si!.lockScaleIfJointPosition).toBe(true)
	})

	it('decodeSkinBlock returns null on non-inflatable / non-map data', () => {
		expect(decodeSkinBlock(Buffer.from([1, 2, 3]), 0, { offset: 0, size: 3 })).toBeNull()
		const notAMap = deflateSync(llRealArr([1, 2, 3]))   // inflates to an array, not a map
		expect(decodeSkinBlock(notAMap, 0, { offset: 0, size: notAMap.length })).toBeNull()
	})

	it('decodeMeshLOD parses per-vertex Weights (u8 idx + u16le weight, 0xFF terminator, renormalized)', () => {
		// 2 vertices. v0: joint3@0.75 + joint5@0.25 then 0xFF (< 4 influences). v1: joint7@1.0 then 0xFF.
		// 0.75×65535=49151=0xBFFF→LE FF BF; 0.25×65535=16383=0x3FFF→LE FF 3F; 1.0×65535=65535→LE FF FF.
		const weights = Buffer.from([0x03, 0xFF, 0xBF, 0x05, 0xFF, 0x3F, 0xFF, 0x07, 0xFF, 0xFF, 0xFF])
		const submesh = llMap([
			['Position', llBin(Buffer.alloc(12))],      // 2 verts × 6 bytes (U16 x,y,z) → vCount=2
			['Normal', llBin(Buffer.alloc(12))],
			['TexCoord0', llBin(Buffer.alloc(8))],       // 2 verts × 4 bytes
			['TriangleList', llBin(Buffer.alloc(6))],    // 3 indices × U16
			['Weights', llBin(weights)],
		])
		const lod = deflateSync(llArr([submesh]))
		const subs = decodeMeshLOD(lod, 0, { offset: 0, size: lod.length })
		expect(subs.length).toBe(1)
		const s = subs[0]
		expect(Array.from(s.jointIndices!.slice(0, 8))).toEqual([3, 5, 0, 0, 7, 0, 0, 0])
		expect(s.jointWeights![0]).toBeCloseTo(0.75, 3)
		expect(s.jointWeights![1]).toBeCloseTo(0.25, 3)
		expect(s.jointWeights![4]).toBeCloseTo(1.0, 3)   // v1: renormalized single influence
	})
})

import { describe, it, expect } from 'bun:test'
import { deflateSync } from 'zlib'
import { encodeLLSDBinaryUuidArray, parseLLSDBinary } from '../lib/llsd'
import { buildRenderMaterialsPostBody, decodeRenderMaterialsResponse } from '../handlers/materials'

// RenderMaterials cap wire format (OpenSim MaterialsModule.cs RenderMaterialsPostCap):
//   request:  LLSD-XML { Zipped: <binary> } where binary = zlib(LLSD-BINARY array of 16-byte binaries)
//   response: LLSD-XML { Zipped: <binary> } where binary = zlib(LLSD-BINARY array of {ID, Material})
// Our previous request zipped LLSD-XML instead → DeserializeLLSDBinary threw server-side → 400/empty.

const PALM_MAT_ID = '11223344-5566-7788-99aa-bbccddeeff00'
const NORM_UUID   = '26d0526f-4a9f-459c-ac28-b3493c964a80'

// ── tiny LLSD-Binary writers for synthesizing an OpenSim response ──────────
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const bInt  = (n: number) => Buffer.concat([Buffer.from('i'), u32(n)])
const bUuid = (u: string) => Buffer.concat([Buffer.from('u'), Buffer.from(u.replace(/-/g, ''), 'hex')])
const bBin  = (data: Buffer) => Buffer.concat([Buffer.from('b'), u32(data.length), data])
const bKey  = (k: string) => Buffer.concat([Buffer.from('k'), u32(k.length), Buffer.from(k)])
const bMap  = (entries: Array<[string, Buffer]>) =>
	Buffer.concat([Buffer.from('{'), u32(entries.length), ...entries.flatMap(([k, v]) => [bKey(k), v]), Buffer.from('}')])
const bArr  = (items: Buffer[]) => Buffer.concat([Buffer.from('['), u32(items.length), ...items, Buffer.from(']')])
const wrapXml = (zipped: Buffer) =>
	`<?xml version="1.0"?><llsd><map><key>Zipped</key><binary>${zipped.toString('base64')}</binary></map></llsd>`

describe('encodeLLSDBinaryUuidArray', () => {
	it('emits [ count, then b/16/raw-uuid-bytes per id, then ]', () => {
		const out = encodeLLSDBinaryUuidArray([PALM_MAT_ID])
		expect(out[0]).toBe(0x5b)                       // '['
		expect(out.readUInt32BE(1)).toBe(1)
		expect(out[5]).toBe(0x62)                       // 'b'
		expect(out.readUInt32BE(6)).toBe(16)
		expect(out.subarray(10, 26).toString('hex')).toBe(PALM_MAT_ID.replace(/-/g, ''))
		expect(out[26]).toBe(0x5d)                      // ']'
		expect(out.length).toBe(27)
	})

	it('round-trips through our own LLSD-Binary parser', () => {
		const ids = [PALM_MAT_ID, NORM_UUID]
		const arr = parseLLSDBinary(encodeLLSDBinaryUuidArray(ids)).value as Buffer[]
		expect(arr.length).toBe(2)
		expect(arr.map(b => b.toString('hex'))).toEqual(ids.map(u => u.replace(/-/g, '')))
	})
})

describe('buildRenderMaterialsPostBody', () => {
	it('wraps the zlib LLSD-Binary id array in an LLSD-XML Zipped map', () => {
		const body = buildRenderMaterialsPostBody([PALM_MAT_ID])
		const b64 = body.match(/<binary[^>]*>([^<]+)<\/binary>/)?.[1] ?? ''
		expect(b64.length).toBeGreaterThan(0)
		const inflated = require('zlib').inflateSync(Buffer.from(b64, 'base64'))
		expect(inflated[0]).toBe(0x5b)                  // zipped payload is LLSD-BINARY, not XML
	})
})

describe('decodeRenderMaterialsResponse', () => {
	it("decodes OpenSim's literal empty response constant to {}", () => {
		// Verbatim GetPutEmptyResponseBytes from MaterialsModule.cs:74 — real fixture.
		const xml = '<llsd><map><key>Zipped</key><binary>eNqLZgCCWAAChQC5</binary></map></llsd>'
		expect(decodeRenderMaterialsResponse(xml)).toEqual({})
	})

	it('decodes a material entry (palm-frond shape: MASK cutoff 127, gloss 51)', () => {
		// Mirrors FaceMaterial.toOSD(): ID as 16-byte binary, Material map with uuid/int fields.
		const entry = bMap([
			['ID', bBin(Buffer.from(PALM_MAT_ID.replace(/-/g, ''), 'hex'))],
			['Material', bMap([
				['NormMap', bUuid(NORM_UUID)],
				['SpecMap', bUuid('00000000-0000-0000-0000-000000000000')],
				['SpecExp', bInt(51)],
				['EnvIntensity', bInt(0)],
				['DiffuseAlphaMode', bInt(2)],
				['AlphaMaskCutoff', bInt(127)],
			])],
		])
		const mats = decodeRenderMaterialsResponse(wrapXml(deflateSync(bArr([entry]))))
		expect(Object.keys(mats)).toEqual([PALM_MAT_ID])
		const m = mats[PALM_MAT_ID] as any
		expect(m.normMap).toBe(NORM_UUID)
		expect(m.specExp).toBe(51)
		expect(m.alphaMode).toBe(2)
		expect(m.alphaCutoff).toBe(127)
	})
})

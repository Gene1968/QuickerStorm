import { describe, it, expect } from 'bun:test'
import { decodeObjectUpdate } from '../lib/lludp-codec'

// Real packet captured live 2026-06-10 via QS_WATCH_LOCALIDS forensics: a full ObjectUpdate for a
// 1-prim mesh ("Scifi Glass Roof or solar panels 1p", localId 667281752) whose Sculpt/Mesh
// ExtraParam (type 0x30, meshId fab4e592…, sculptType 5) was silently LOST in decode.
//
// ROOT CAUSE: the tail walk skipped `Data` as Variable1, but message_template.msg says
//   { Data  Variable 2 }
// For the common empty case (00 00) the stray second zero byte was swallowed by the empty Text
// length — an accidental realignment that masked the bug on almost every object. This packet's
// tail content breaks the accident: the walk landed on garbage at ExtraParams and dropped the
// meshId, turning the mesh into a torus (its carrier shape pathCurve=32/profileCurve=0).
//
// Buffer is the expanded (un-zerocoded) wire packet exactly as decodeObjectUpdate receives it;
// body starts at dataOffset 7.
const ROOF_PACKET_HEX =
	'c000000045000c00ab060000ae0600ffff0158e9c52700c9ff52947f1e492e84294e753f58d1cb0420791f0903' +
	'02c02121412ddfc1402993223e3c7f8a1643cd4c35432428c5410000000000000000000000000000000000000000' +
	'000000003c1daf3e0000000000000000000000000000000000000000000000003c090210200000000000649600' +
	'0000000000000000000000006c6b6e0026d0526f4a9f459cac28b3493c964a8001f9d948244e0a4b4e85235974' +
	'f779503500ff0000000100000000006985183f00fffe003f01d104293f00000000000000000000c00100000200' +
	'0000748f52abea3859d0ef261ee94cc1f43a010a498913baef36e880fae04aa6c1183000000000000000000000' +
	'0000001801300011000000fab4e592ce3942f0805a752622689a740500000000000000000000000000000000' +
	'0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'

describe('full ObjectUpdate: Data field is Variable2 (roof fixture)', () => {
	const objs = decodeObjectUpdate(Buffer.from(ROOF_PACKET_HEX, 'hex'), 7)

	it('decodes exactly one object — the roof', () => {
		expect(objs.length).toBe(1)
		expect(objs[0].localId).toBe(667281752)
		expect(objs[0].pcode).toBe(9)
	})

	it('extracts meshId + sculptType from the Sculpt ExtraParam (was lost to the Var1 misread)', () => {
		const o = objs[0]
		expect(o.meshId).toBe('fab4e592-ce39-42f0-805a-752622689a74')
		expect(o.sculptType).toBe(5)
	})

	it('keeps the rest of the decode intact', () => {
		const o = objs[0]
		expect(o.defaultTexture).toBe('26d0526f-4a9f-459c-ac28-b3493c964a80')
		expect(o.faceTextures?.[0]).toBe('f9d94824-4e0a-4b4e-8523-5974f7795035')
		expect(o.scale[0]).toBeCloseTo(10.07, 1)
		expect(o.scale[1]).toBeCloseTo(6.06, 1)
	})
})

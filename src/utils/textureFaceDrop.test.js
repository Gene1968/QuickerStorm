import { describe, it, expect } from 'vitest'
import { faceCountFor, composeFaceTable, canModifyForTexture } from '@/utils/textureFaceDrop'

const AGENT   = '11111111-1111-1111-1111-111111111111'
const OTHER   = '22222222-2222-2222-2222-222222222222'
const TEX_A   = '33333333-3333-3333-3333-333333333333'
const TEX_B   = '44444444-4444-4444-4444-444444444444'
const PERM_MODIFY = 0x4000

// Clean-box shape (primFaceMap.js BOX_FACE_MAP path): pathCurve 16, profileCurve 1, no cut/hollow.
const BOX_SHAPE = { pathCurve: 16, profileCurve: 1, profileHollow: 0, pathBegin: 0, pathEnd: 0, profileBegin: 0, profileEnd: 0 }
const CYL_SHAPE = { pathCurve: 16, profileCurve: 0, profileHollow: 0, pathBegin: 0, pathEnd: 0, profileBegin: 0, profileEnd: 0 }
// A cut/hollow prim (torus-like) — primFaceMap returns null for this.
const UNMAPPABLE_SHAPE = { pathCurve: 16, profileCurve: 1, profileHollow: 4000, pathBegin: 0, pathEnd: 0, profileBegin: 0, profileEnd: 0 }

describe('faceCountFor', () => {
	it('box prim → 6, even with zero recorded overrides', () => {
		expect(faceCountFor({ shape: BOX_SHAPE })).toBe(6)
	})
	it('cylinder prim → 3', () => {
		expect(faceCountFor({ shape: CYL_SHAPE })).toBe(3)
	})
	it('unmappable prim shape (no meshId) → 0 (refuse, cannot safely determine count)', () => {
		expect(faceCountFor({ shape: UNMAPPABLE_SHAPE })).toBe(0)
	})
	it('mesh with per-face overrides → 1 + highest overridden index', () => {
		expect(faceCountFor({ meshId: 'm1', shape: UNMAPPABLE_SHAPE, faceTextures: [TEX_A, null, TEX_B] })).toBe(3)
	})
	it('mesh with overrides split across different TE arrays → still finds the max', () => {
		expect(faceCountFor({ meshId: 'm1', faceColors: [null, null, [1, 1, 1, 1]], faceRotation: [0.5] })).toBe(3)
	})
	it('mesh with NO recorded overrides at all → 0 (refuse rather than guess)', () => {
		expect(faceCountFor({ meshId: 'm1' })).toBe(0)
	})
	it('no object → 0', () => {
		expect(faceCountFor(null)).toBe(0)
	})
})

describe('composeFaceTable', () => {
	it('every face falls back to the object default when no per-face override exists', () => {
		const obj = {
			defaultTexture: TEX_A, defaultColor: [1, 0, 0, 1],
			defaultRepeats: [2, 3], defaultOffset: [0.1, 0.2], defaultRotation: 1.5,
			defaultBump: 0, defaultShiny: 1, defaultFullbright: false,
			defaultMediaFlags: 0, defaultTexGen: 0, defaultGlow: 0, defaultMaterialId: undefined,
		}
		const faces = composeFaceTable(obj, 3)
		expect(faces).toHaveLength(3)
		for (const f of faces) {
			expect(f.textureId).toBe(TEX_A)
			expect(f.color).toEqual([1, 0, 0, 1])
			expect(f.repeatU).toBe(2); expect(f.repeatV).toBe(3)
			expect(f.offsetU).toBe(0.1); expect(f.offsetV).toBe(0.2)
			expect(f.rotation).toBe(1.5)
			expect(f.shiny).toBe(1)
		}
	})
	it('a per-face override wins over the default for that face only', () => {
		const obj = {
			defaultTexture: TEX_A, faceTextures: [null, TEX_B, null],
			defaultColor: [1, 1, 1, 1],
		}
		const faces = composeFaceTable(obj, 3)
		expect(faces[0].textureId).toBe(TEX_A)
		expect(faces[1].textureId).toBe(TEX_B)
		expect(faces[2].textureId).toBe(TEX_A)
	})
	it('per-face UV pair overrides both U and V together', () => {
		const obj = { defaultRepeats: [1, 1], faceRepeats: [[2, 4]] }
		const faces = composeFaceTable(obj, 1)
		expect(faces[0].repeatU).toBe(2)
		expect(faces[0].repeatV).toBe(4)
	})
})

describe('canModifyForTexture', () => {
	it('owner unknown (ObjectProperties not arrived) → allow', () => {
		expect(canModifyForTexture({}, AGENT)).toBe(true)
		expect(canModifyForTexture({ ownerId: '00000000-0000-0000-0000-000000000000' }, AGENT)).toBe(true)
	})
	it('we own it, ownerMask has MODIFY → allow', () => {
		expect(canModifyForTexture({ ownerId: AGENT, ownerMask: PERM_MODIFY }, AGENT)).toBe(true)
	})
	it('we own it, ownerMask lacks MODIFY → refuse', () => {
		expect(canModifyForTexture({ ownerId: AGENT, ownerMask: 0 }, AGENT)).toBe(false)
	})
	it('we own it, ownerMask not yet known → allow', () => {
		expect(canModifyForTexture({ ownerId: AGENT }, AGENT)).toBe(true)
	})
	it('someone else owns it, everyoneMask has MODIFY → allow (public-build parcel)', () => {
		expect(canModifyForTexture({ ownerId: OTHER, everyoneMask: PERM_MODIFY }, AGENT)).toBe(true)
	})
	it('someone else owns it, everyoneMask lacks MODIFY → refuse', () => {
		expect(canModifyForTexture({ ownerId: OTHER, everyoneMask: 0 }, AGENT)).toBe(false)
	})
})

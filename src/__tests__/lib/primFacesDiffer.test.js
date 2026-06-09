import { describe, it, expect } from 'bun:test'
import { primFacesDiffer } from '@/lib/primFaceMap.js'

const REAL_A = '11111111-1111-1111-1111-111111111111'
const REAL_B = '22222222-2222-2222-2222-222222222222'
const BLANK  = '5748decc-f629-461c-9a36-a35a221fe21f'  // SL Blank texture (treated as no-tex)

describe('primFacesDiffer', () => {
	it('two distinct real textures → true', () => {
		expect(primFacesDiffer({ defaultTexture: REAL_A, faceTextures: [REAL_B] })).toBe(true)
	})
	it('same texture everywhere → false', () => {
		expect(primFacesDiffer({ defaultTexture: REAL_A, faceTextures: [REAL_A, REAL_A] })).toBe(false)
	})
	it('blank + nulls are not counted as distinct textures', () => {
		expect(primFacesDiffer({ defaultTexture: REAL_A, faceTextures: [BLANK, null] })).toBe(false)
	})
	it('two distinct tints → true', () => {
		expect(primFacesDiffer({
			defaultColor: [1, 1, 1, 1],
			faceColors: [[1, 0, 0, 1], null],
		})).toBe(true)
	})
	it('uniform tint + uniform tex → false', () => {
		expect(primFacesDiffer({ defaultColor: [1, 1, 1, 1], faceColors: [[1, 1, 1, 1]] })).toBe(false)
	})
	it('empty object → false', () => {
		expect(primFacesDiffer({})).toBe(false)
	})
})

import { describe, it, expect } from 'bun:test'
import { readField, writeField, sizeOfField } from './fields.ts'
import type { FieldDef } from './types.ts'

function roundtrip(def: FieldDef, value: unknown) {
	const size = sizeOfField(def, value)
	const buf = Buffer.alloc(size)
	const end = writeField(buf, 0, def, value)
	expect(end).toBe(size)
	const { value: out, next } = readField(buf, 0, def)
	expect(next).toBe(size)
	return out
}

describe('field primitives', () => {
	it('U8/U16/U32 round-trip little-endian', () => {
		expect(roundtrip({ name: 'a', type: 'U8' }, 200)).toBe(200)
		expect(roundtrip({ name: 'a', type: 'U16' }, 0xBEEF)).toBe(0xBEEF)
		expect(roundtrip({ name: 'a', type: 'U32' }, 0xDEADBEEF)).toBe(0xDEADBEEF)
	})
	it('S8/S16/S32 handle negatives', () => {
		expect(roundtrip({ name: 'a', type: 'S8' }, -5)).toBe(-5)
		expect(roundtrip({ name: 'a', type: 'S16' }, -1234)).toBe(-1234)
		expect(roundtrip({ name: 'a', type: 'S32' }, -123456)).toBe(-123456)
	})
	it('U64/S64 round-trip as bigint', () => {
		expect(roundtrip({ name: 'a', type: 'U64' }, 1234567890123n)).toBe(1234567890123n)
		expect(roundtrip({ name: 'a', type: 'S64' }, -1234567890123n)).toBe(-1234567890123n)
	})
	it('F32/F64 round-trip within precision', () => {
		expect(roundtrip({ name: 'a', type: 'F32' }, 1.5)).toBeCloseTo(1.5, 5)
		expect(roundtrip({ name: 'a', type: 'F64' }, Math.PI)).toBeCloseTo(Math.PI, 12)
	})
	it('BOOL round-trips', () => {
		expect(roundtrip({ name: 'a', type: 'BOOL' }, true)).toBe(true)
		expect(roundtrip({ name: 'a', type: 'BOOL' }, false)).toBe(false)
	})
	it('LLUUID round-trips', () => {
		const u = '11223344-5566-7788-99aa-bbccddeeff00'
		expect(roundtrip({ name: 'a', type: 'LLUUID' }, u)).toBe(u)
	})
	it('LLVector3 / LLVector3d / LLVector4 round-trip', () => {
		expect((roundtrip({ name: 'a', type: 'LLVector3' }, [1, 2, 3]) as number[]).map(Math.round)).toEqual([1, 2, 3])
		expect((roundtrip({ name: 'a', type: 'LLVector3d' }, [1.5, 2.5, 3.5]) as number[])).toEqual([1.5, 2.5, 3.5])
		expect((roundtrip({ name: 'a', type: 'LLVector4' }, [1, 2, 3, 4]) as number[]).map(Math.round)).toEqual([1, 2, 3, 4])
	})
	it('LLQuaternion round-trips 3 floats (w derived on wire)', () => {
		const out = roundtrip({ name: 'a', type: 'LLQuaternion' }, [0.1, 0.2, 0.3]) as number[]
		expect(out.length).toBe(3)
		expect(out[0]).toBeCloseTo(0.1, 5)
	})
	it('IPPORT round-trips U16', () => {
		expect(roundtrip({ name: 'a', type: 'IPPORT' }, 12345)).toBe(12345)
	})
	it('Variable 1 round-trips a buffer with 1-byte length', () => {
		const payload = Buffer.from([1, 2, 3, 4])
		const out = roundtrip({ name: 'a', type: 'Variable', size: 1 }, payload) as Buffer
		expect([...out]).toEqual([1, 2, 3, 4])
	})
	it('Variable 2 round-trips with 2-byte length (>255 bytes)', () => {
		const payload = Buffer.from(new Array(300).fill(7))
		const out = roundtrip({ name: 'a', type: 'Variable', size: 2 }, payload) as Buffer
		expect(out.length).toBe(300)
	})
	it('Fixed N round-trips raw bytes', () => {
		const payload = Buffer.from([9, 8, 7, 6])
		const out = roundtrip({ name: 'a', type: 'Fixed', size: 4 }, payload) as Buffer
		expect([...out]).toEqual([9, 8, 7, 6])
	})
})

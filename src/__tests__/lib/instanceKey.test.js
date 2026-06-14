// src/__tests__/lib/instanceKey.test.js
import { describe, it, expect } from 'vitest'
import { materialKey, uvKey } from '@/lib/instanceKey.js'

describe('materialKey', () => {
	it('is deterministic for equal descriptors', () => {
		const a = { texId: 'abc', uvKey: '', blend: false, alpha: false, fullbright: true, lit: false, pbr: false }
		const b = { ...a }
		expect(materialKey(a)).toBe(materialKey(b))
	})

	it('ignores color (same key regardless of tint)', () => {
		const base = { texId: 'abc', uvKey: '' }
		expect(materialKey({ ...base, color: '#fff' })).toBe(materialKey({ ...base, color: '#f00' }))
	})

	it('differs when a material-determining field differs', () => {
		const base = { texId: 'abc', uvKey: '' }
		expect(materialKey({ ...base, fullbright: true })).not.toBe(materialKey({ ...base, fullbright: false }))
		expect(materialKey({ ...base, texId: 'xyz' })).not.toBe(materialKey(base))
	})
})

describe('uvKey', () => {
	it('returns empty string for identity transform', () => {
		expect(uvKey(null)).toBe('')
	})
	it('encodes repeat/offset/rotation', () => {
		expect(uvKey({ rep: [2, 2], ofs: [0, 0], rot: 0 })).toBe('2,2,0,0,0')
	})
})
